import { NextRequest, NextResponse } from 'next/server';

// Environment configuration
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || '/login';

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
  response.cookies.delete(AFU9_AUTH_COOKIE);
  response.cookies.delete('afu9_access');
  response.cookies.delete('afu9_refresh');

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
  response.cookies.delete(AFU9_AUTH_COOKIE);
  response.cookies.delete('afu9_access');
  response.cookies.delete('afu9_refresh');

  return response;
}
