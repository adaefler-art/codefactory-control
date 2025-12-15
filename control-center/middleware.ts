import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/auth/jwt-verify';
import { getStageFromHostname, hasStageAccess, getGroupsClaimKey } from './lib/auth/stage-enforcement';

// Environment configuration for cookies and redirects
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || 'https://afu-9.com/';

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
    '/api/health',
    '/api/ready',
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

  // Extract JWT token from cookie (using configurable cookie name)
  const idToken = request.cookies.get(AFU9_AUTH_COOKIE)?.value;

  // Fail closed: no token present
  if (!idToken) {
    console.log('[MIDDLEWARE] No authentication token found');
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    } else {
      // UI routes: redirect to unauth page
      return NextResponse.redirect(AFU9_UNAUTH_REDIRECT);
    }
  }

  // Verify the ID token using fail-closed helper
  const verifyResult = await verifyJWT(idToken);
  
  if (!verifyResult.success) {
    // Fail closed: invalid or expired token
    console.log('[MIDDLEWARE] Token verification failed:', verifyResult.error);
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
    } else {
      // UI routes: redirect to unauth page and clear invalid cookies
      const response = NextResponse.redirect(AFU9_UNAUTH_REDIRECT);
      response.cookies.delete(AFU9_AUTH_COOKIE);
      response.cookies.delete('afu9_access');
      response.cookies.delete('afu9_refresh');
      return response;
    }
  }

  // Extract user information from verified token
  const payload = verifyResult.payload;
  const groupsClaimKey = getGroupsClaimKey();
  const userGroups = (payload as any)[groupsClaimKey] as string[] | undefined;
  const userSub = payload.sub || '';

  // Check stage-based access control
  const requiredStage = getStageFromHostname(hostname);
  const hasAccess = hasStageAccess(userGroups, requiredStage);
  
  if (!hasAccess) {
    console.log(`[MIDDLEWARE] User does not have access to ${requiredStage} stage`);
    
    if (isApiRoute) {
      // API routes: return 403 JSON
      return NextResponse.json(
        { error: 'Forbidden', message: `Access to ${requiredStage} stage not permitted` },
        { status: 403 }
      );
    } else {
      // UI routes: redirect to unauth page
      return NextResponse.redirect(AFU9_UNAUTH_REDIRECT, {
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
