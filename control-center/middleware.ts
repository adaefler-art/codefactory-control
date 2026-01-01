import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/auth/jwt-verify';
import { getStageFromHostname, hasStageAccess, getGroupsClaimKey } from './lib/auth/stage-enforcement';
import { isPublicRoute } from './lib/auth/middleware-public-routes';
import { shouldAllowUnauthenticatedGithubStatusEndpoint } from './src/lib/auth/public-status-endpoints';
import { getEffectiveHostname } from './src/lib/http/effective-hostname';

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

function getRequestId(): string {
  try {
    // Available in Edge runtime
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function getEffectiveHostnameFromRequest(request: NextRequest): string {
  return getEffectiveHostname({
    nextUrlHostname: request.nextUrl.hostname,
    hostHeader: request.headers.get('host'),
    forwardedHostHeader: request.headers.get('x-forwarded-host'),
  });
}

function logAuthDecision(params: {
  requestId: string;
  route: string;
  method: string;
  status: number;
  reason: string;
}) {
  console.log(
    JSON.stringify({
      level: 'info',
      ...params,
      timestamp: new Date().toISOString(),
    })
  );
}

function attachRequestId(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId);
  return response;
}

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
  const requestId = getRequestId();
  const { pathname: rawPathname } = request.nextUrl;
  const hostname = getEffectiveHostnameFromRequest(request);
  const pathname = rawPathname === '/' ? rawPathname : rawPathname.replace(/\/+$/, '');

  const nextWithRequestId = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-request-id', requestId);
    return response;
  };

  // Optional smoke-auth bypass for a small allowlist of API endpoints (staging only).
  // Contract:
  // - Header: X-AFU9-SMOKE-KEY (case-insensitive)
  // - Env gate: AFU9_SMOKE_KEY must be set (otherwise bypass is disabled)
  // - Host gate: staging only (stage.afu-9.com)
  const smokeKey = process.env.AFU9_SMOKE_KEY;
  const providedSmokeKey = request.headers.get('x-afu9-smoke-key');
  const isStagingHost = getStageFromHostname(hostname) === 'staging';

  if (isStagingHost && smokeKey && providedSmokeKey === smokeKey) {
    const allowlisted =
      (request.method === 'GET' && pathname === '/api/timeline/chain') ||
      ((request.method === 'GET' || request.method === 'POST') && /^\/api\/intent\/sessions$/.test(pathname)) ||
      (request.method === 'GET' && /^\/api\/intent\/sessions\/[^/]+$/.test(pathname)) ||
      (request.method === 'POST' && /^\/api\/intent\/sessions\/[^/]+\/messages$/.test(pathname));

    if (allowlisted) {
      const response = nextWithRequestId();
      response.headers.set('x-afu9-smoke-auth-used', '1');
      return response;
    }
  }

  // STAGING-only ops endpoint: allow unauthenticated GET for status checks.
  // Middleware runs bundled; do not rely on runtime env vars here. Gate strictly by hostname.
  if (shouldAllowUnauthenticatedGithubStatusEndpoint({ method: request.method, pathname, hostname })) {
    return nextWithRequestId();
  }

  if (isPublicRoute(pathname)) {
    return nextWithRequestId();
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
    return attachRequestId(response, requestId);
  };

  // If we have no usable JWT (id/access) but do have a refresh cookie,
  // redirect UI navigation through the refresh endpoint to mint new tokens.
  // (Cognito refresh tokens are typically opaque and cannot be verified in middleware.)
  if (!idToken && !accessToken && refreshToken) {
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Refresh-only cookies present; redirecting to /auth/refresh', {
        pathname,
        hostname,
        isApiRoute,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }

    if (isApiRoute) {
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required (refresh token present)' },
        { status: 401 }
      );
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 401, reason: 'auth_refresh_only' });
      return response;
    }

    const response = redirectToRefresh();
    logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_refresh_redirect' });
    return response;
  }

  // Fail closed: no auth material present
  if (!idToken && !accessToken) {
    console.log('[MIDDLEWARE] No authentication token found');
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] No tokens present', {
        pathname,
        hostname,
        isApiRoute,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 401, reason: 'auth_missing' });
      return response;
    } else {
      // UI routes: redirect to unauth page
      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_missing_redirect' });
      return response;
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
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 401, reason: 'auth_invalid_or_expired' });
      return response;
    } else {
      // UI routes: if refresh cookie is present, try refresh flow; otherwise clear cookies and redirect.
      if (refreshToken) {
        const response = redirectToRefresh();
        logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_invalid_refresh_redirect' });
        return response;
      }

      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
      clearCookie(response, AFU9_AUTH_COOKIE);
      clearCookie(response, AFU9_ACCESS_COOKIE);
      clearCookie(response, AFU9_REFRESH_COOKIE);
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_invalid_redirect' });
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
      const response = NextResponse.json(
        { error: 'Forbidden', message: `Access to ${requiredStage} stage not permitted` },
        { status: 403 }
      );
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 403, reason: 'stage_access_denied' });
      return response;
    } else {
      // UI routes: redirect to unauth page
      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url), {
        status: 403,
      });
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 403, reason: 'stage_access_denied_redirect' });
      return response;
    }
  }

  // Authentication and authorization successful
  // Add downstream context propagation headers
  const response = nextWithRequestId();
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
