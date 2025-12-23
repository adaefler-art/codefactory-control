import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/auth/jwt-verify';
import { getStageFromHostname, hasStageAccess, getGroupsClaimKey } from './lib/auth/stage-enforcement';

// Environment configuration for cookies and redirects
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_ACCESS_COOKIE = process.env.AFU9_ACCESS_COOKIE || 'afu9_access';
const AFU9_REFRESH_COOKIE = process.env.AFU9_REFRESH_COOKIE || 'afu9_refresh';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || '/login';
const AFU9_DEBUG_AUTH = (process.env.AFU9_DEBUG_AUTH || '').toLowerCase() === 'true' || process.env.AFU9_DEBUG_AUTH === '1';
const AFU9_COOKIE_DOMAIN = process.env.AFU9_COOKIE_DOMAIN;
const AFU9_COOKIE_SAMESITE_ENV = (process.env.AFU9_COOKIE_SAMESITE || 'lax').toLowerCase();

const cookieSameSite: 'lax' | 'strict' | 'none' =
  AFU9_COOKIE_SAMESITE_ENV === 'none' || AFU9_COOKIE_SAMESITE_ENV === 'strict'
    ? (AFU9_COOKIE_SAMESITE_ENV as 'none' | 'strict')
    : 'lax';

const cookieSecure = process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: 0,
    path: '/',
    ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
  });
}

/**
 * Middleware to protect routes and verify authentication
 * 
 * Enhanced with:
 * - Fail-closed JWT verification
 * - API vs UI route differentiation (401 JSON vs redirect)
 * - Downstream context propagation via x-afu9-* headers
 * - Environment variable driven configuration
 */
export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = [
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/build-metadata',
    '/api/health',
    '/api/ready',
    '/auth/refresh',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/favicon.ico',
    '/_next',
    '/public',
  ];

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));
  
  if (isPublicRoute) {
    return NextResponse.next();
  }

  // Determine if this is an API route (for differentiated error handling)
  const isApiRoute = pathname.startsWith('/api/');

  // Extract JWT tokens from cookies
  const idToken = request.cookies.get(AFU9_AUTH_COOKIE)?.value;
  const accessToken = request.cookies.get(AFU9_ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(AFU9_REFRESH_COOKIE)?.value;

  const redirectToRefresh = () => {
    const original = request.nextUrl.pathname + request.nextUrl.search;
    const url = new URL('/auth/refresh', request.url);
    url.searchParams.set('redirectTo', original);
    const response = NextResponse.redirect(url);
    if (AFU9_DEBUG_AUTH) {
      response.headers.set('x-afu9-auth-debug', '1');
      response.headers.set('x-afu9-auth-via', 'refresh');
    }
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    return response;
  };

  // If we have no usable JWT (id/access) but do have a refresh cookie,
  // redirect UI navigation through the refresh endpoint to mint new tokens.
  // (Cognito refresh tokens are typically opaque and cannot be verified in middleware.)
  if (!idToken && !accessToken && refreshToken) {
    if (AFU9_DEBUG_AUTH) {
      const cookieNames = typeof (request.cookies as any).getAll === 'function'
        ? (request.cookies as any).getAll().map((c: any) => c.name)
        : [];
      console.log('[MIDDLEWARE][DEBUG] Refresh-only cookies present; redirecting to /auth/refresh', {
        pathname,
        hostname,
        isApiRoute,
        cookieNames,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }

    if (isApiRoute) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required (refresh token present)' },
        { status: 401 }
      );
    }

    return redirectToRefresh();
  }

  // Fail closed: no auth material present
  if (!idToken && !accessToken) {
    console.log('[MIDDLEWARE] No authentication token found');
    if (AFU9_DEBUG_AUTH) {
      const cookieNames = typeof (request.cookies as any).getAll === 'function'
        ? (request.cookies as any).getAll().map((c: any) => c.name)
        : [];
      console.log('[MIDDLEWARE][DEBUG] No tokens present', {
        pathname,
        hostname,
        isApiRoute,
        cookieNames,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    } else {
      // UI routes: redirect to unauth page
      return NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
    }
  }

  // Verify tokens using fail-closed helper.
  // Prefer ID token for identity; fall back to access token if needed.
  let verifiedPayload: any | null = null;
  let verifiedVia: 'id' | 'access' | 'refresh' | null = null;
  let verifyError: string | null = null;

  function tokenUseOk(tokenUse: unknown, expected: 'id' | 'access'): boolean {
    // Fail-closed on explicit mismatch. If token_use is missing, allow (some JWTs omit it).
    if (!tokenUse) return true;
    return tokenUse === expected;
  }

  if (idToken) {
    const idVerify = await verifyJWT(idToken);
    if (idVerify.success) {
      if (tokenUseOk((idVerify.payload as any).token_use, 'id')) {
        verifiedPayload = idVerify.payload;
        verifiedVia = 'id';
      } else {
        verifyError = 'token_use mismatch (expected id)';
      }
    } else {
      verifyError = idVerify.error;
    }
  }

  if (!verifiedPayload && accessToken) {
    const accessVerify = await verifyJWT(accessToken);
    if (accessVerify.success) {
      if (tokenUseOk((accessVerify.payload as any).token_use, 'access')) {
        verifiedPayload = accessVerify.payload;
        verifiedVia = 'access';
        verifyError = null;
      } else {
        verifyError = 'token_use mismatch (expected access)';
      }
    } else {
      verifyError = accessVerify.error;
    }
  }

  if (!verifiedPayload) {
    // Fail closed: invalid or expired token(s)
    console.log('[MIDDLEWARE] Token verification failed');
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Token verification failed', {
        pathname,
        hostname,
        isApiRoute,
        hasIdToken: Boolean(idToken),
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        verifyError,
      });
    }
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
    } else {
      // UI routes: if refresh cookie is present, try refresh flow; otherwise clear cookies and redirect.
      if (refreshToken) {
        return redirectToRefresh();
      }

      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
      clearCookie(response, AFU9_AUTH_COOKIE);
      clearCookie(response, AFU9_ACCESS_COOKIE);
      clearCookie(response, AFU9_REFRESH_COOKIE);
      return response;
    }
  }

  // Extract user information from verified token
  const payload = verifiedPayload;
  const groupsClaimKey = getGroupsClaimKey();

  // Some Cognito setups don't include groups on the ID token but do on the access token.
  // If groups are missing and we verified via ID token, attempt access-token verification just for groups.
  let userGroups = (payload as any)[groupsClaimKey] as string[] | undefined;
  if ((!userGroups || userGroups.length === 0) && verifiedVia === 'id' && accessToken) {
    const accessVerify = await verifyJWT(accessToken);
    if (accessVerify.success) {
      const accessPayload = accessVerify.payload as any;
      const accessGroups = accessPayload[groupsClaimKey] as string[] | undefined;
      if (accessGroups && accessGroups.length > 0) {
        userGroups = accessGroups;
      }
    }
  }

  const userSub = (payload as any).sub || '';

  // Check stage-based access control
  const requiredStage = getStageFromHostname(hostname);
  const hasAccess = hasStageAccess(userGroups, requiredStage);
  
  if (!hasAccess) {
    console.log(`[MIDDLEWARE] User does not have access to ${requiredStage} stage`);
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Stage access denied', {
        pathname,
        hostname,
        requiredStage,
        groupsClaimKey,
        groupCount: userGroups?.length || 0,
        verifiedVia,
      });
    }
    
    if (isApiRoute) {
      // API routes: return 403 JSON
      return NextResponse.json(
        { error: 'Forbidden', message: `Access to ${requiredStage} stage not permitted` },
        { status: 403 }
      );
    } else {
      // UI routes: redirect to unauth page
      return NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url), {
        status: 403,
      });
    }
  }

  // Authentication and authorization successful
  // Add downstream context propagation headers
  const response = NextResponse.next();
  response.headers.set('x-afu9-sub', userSub);
  response.headers.set('x-afu9-stage', requiredStage);
  response.headers.set('x-afu9-groups', userGroups?.join(',') || '');
  if (AFU9_DEBUG_AUTH) {
    response.headers.set('x-afu9-auth-debug', '1');
    response.headers.set('x-afu9-auth-via', verifiedVia || 'unknown');
  }

  return response;
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
