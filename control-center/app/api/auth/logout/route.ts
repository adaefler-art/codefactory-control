import { NextRequest, NextResponse } from 'next/server';

// Environment configuration
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_ACCESS_COOKIE = process.env.AFU9_ACCESS_COOKIE || 'afu9_access';
const AFU9_REFRESH_COOKIE = process.env.AFU9_REFRESH_COOKIE || 'afu9_refresh';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || '/login';
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
 * POST /api/auth/logout
 * 
 * Logs out user by clearing authentication cookies
 * 
 * Response (Browser clients):
 * 302 redirect to /login
 * 
 * Response (API clients):
 * {
 *   "success": true,
 *   "message": "Logout successful"
 * }
 */
export async function POST(request: NextRequest) {
  const acceptHeader = request.headers.get('accept') || '';
  const isBrowserClient = acceptHeader.includes('text/html');

  // Create response (redirect for browser, JSON for API)
  let response: NextResponse;
  
  if (isBrowserClient) {
    // Browser client: redirect to login page
    response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
  } else {
    // API client: return JSON response
    response = NextResponse.json({
      success: true,
      message: 'Logout successful',
    });
  }

  // Clear all authentication cookies
  clearCookie(response, AFU9_AUTH_COOKIE);
  clearCookie(response, AFU9_ACCESS_COOKIE);
  clearCookie(response, AFU9_REFRESH_COOKIE);

  return response;
}

/**
 * GET /api/auth/logout
 * 
 * Logs out user by clearing authentication cookies
 * Redirects to login page
 */
export async function GET(request: NextRequest) {
  // Create redirect response
  const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));

  // Clear all authentication cookies
  clearCookie(response, AFU9_AUTH_COOKIE);
  clearCookie(response, AFU9_ACCESS_COOKIE);
  clearCookie(response, AFU9_REFRESH_COOKIE);

  return response;
}
