import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import { verifyJWT } from '../../../../lib/auth/jwt-verify';
import { randomUUID } from 'crypto';
import { AUTH_STATE_HEADER } from '@/lib/auth/auth-state';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_ACCESS_COOKIE = process.env.AFU9_ACCESS_COOKIE || 'afu9_access';
const AFU9_REFRESH_COOKIE = process.env.AFU9_REFRESH_COOKIE || 'afu9_refresh';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || 'https://afu-9.com/';
const AFU9_COOKIE_DOMAIN = process.env.AFU9_COOKIE_DOMAIN;
const AFU9_COOKIE_SAMESITE_ENV = (process.env.AFU9_COOKIE_SAMESITE || 'lax').toLowerCase();

const cookieSameSite: 'lax' | 'strict' | 'none' =
  AFU9_COOKIE_SAMESITE_ENV === 'none' || AFU9_COOKIE_SAMESITE_ENV === 'strict'
    ? (AFU9_COOKIE_SAMESITE_ENV as 'none' | 'strict')
    : 'lax';

const cookieSecure = process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

function createCognitoClient() {
  return new CognitoIdentityProviderClient({
    region: COGNITO_REGION,
  });
}

function getRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function logAuthRoute(params: { requestId: string; route: string; method: string; status: number; reason: string }) {
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
  response.headers.set('cache-control', 'no-store, max-age=0');
  response.headers.set('pragma', 'no-cache');
  return response;
}

/**
 * GET /api/auth/login
 * 
 * Check if user is already authenticated
 * - If authenticated: redirect to /dashboard (or ?redirectTo= query param)
 * - If not authenticated: redirect to AFU9_UNAUTH_REDIRECT
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId();
  // Check if user already has valid authentication cookie
  const idToken = request.cookies.get(AFU9_AUTH_COOKIE)?.value;

  if (idToken) {
    // Verify the token
    const verifyResult = await verifyJWT(idToken);
    
    if (verifyResult.success) {
      // User is authenticated, redirect to dashboard or redirectTo param
      const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard';
      const response = NextResponse.redirect(new URL(redirectTo, request.url));
      response.headers.set(AUTH_STATE_HEADER, 'authenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'GET', status: response.status, reason: 'already_authenticated_redirect' });
      return response;
    }
  }

  // Not authenticated, redirect to unauth page
  const response = NextResponse.redirect(AFU9_UNAUTH_REDIRECT);
  response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
  attachRequestId(response, requestId);
  logAuthRoute({ requestId, route: '/api/auth/login', method: 'GET', status: response.status, reason: 'unauth_redirect' });
  return response;
}

/**
 * POST /api/auth/login
 * 
 * Authenticates user with Cognito using USER_PASSWORD_AUTH flow
 * Sets HttpOnly, Secure cookies with JWT tokens
 * 
 * Request body:
 * {
 *   "username": "user@example.com",
 *   "password": "password123"
 * }
 * 
 * Response (API clients):
 * {
 *   "message": "Login successful"
 * }
 * 
 * Response (Browser clients with Accept: text/html):
 * 302 redirect to /dashboard or ?redirectTo= param
 * 
 * Error response:
 * {
 *   "error": "Invalid credentials",
 *   "requestId": "string",
 *   "timestamp": "ISO-8601"
 * }
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId();
  try {
    // Parse request body
    const body = await request.json();
    const { username, password } = body;

    // Validate input
    if (!username || !password) {
      const response = NextResponse.json(
        {
          error: 'Username and password are required',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 400, reason: 'missing_credentials' });
      return response;
    }

    // Validate environment variables
    const cognitoClientId =
      process.env.COGNITO_CLIENT_ID || (process.env.NODE_ENV === 'test' ? 'test-client-id' : '');

    if (!cognitoClientId) {
      console.error('Missing Cognito configuration');
      const response = NextResponse.json(
        {
          error: 'Authentication service not configured',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 500, reason: 'cognito_misconfigured' });
      return response;
    }

    // Prepare authentication request
    const authParams: InitiateAuthCommandInput = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: cognitoClientId,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    };

    // Authenticate with Cognito
    const command = new InitiateAuthCommand(authParams);
    const cognitoClient = createCognitoClient();
    const authResult = await cognitoClient.send(command);

    // Check if authentication was successful
    if (!authResult.AuthenticationResult) {
      console.error('Authentication failed: No authentication result');
      const response = NextResponse.json(
        {
          error: 'Authentication failed',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 401, reason: 'auth_failed_no_result' });
      return response;
    }

    // Extract tokens
    const { IdToken, AccessToken, RefreshToken } = authResult.AuthenticationResult;

    if (!IdToken || !AccessToken) {
      console.error('Authentication failed: Missing tokens');
      const response = NextResponse.json(
        {
          error: 'Authentication failed',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 401, reason: 'auth_failed_missing_tokens' });
      return response;
    }

    // Determine redirect URL for browser clients
    const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard';
    const referer = request.headers.get('referer');
    const acceptHeader = request.headers.get('accept') || '';
    const isBrowserClient = acceptHeader.includes('text/html');

    // Create response (redirect for browser, JSON for API)
    let response: NextResponse;
    
    if (isBrowserClient) {
      // Browser client: redirect to dashboard or redirectTo
      response = NextResponse.redirect(new URL(redirectTo, request.url));
    } else {
      // API client: return JSON response
      response = NextResponse.json({
        message: 'Login successful',
      });
    }
    response.headers.set(AUTH_STATE_HEADER, 'authenticated');

    // Set HttpOnly cookies for auth.
    // Defaults are safe for same-origin use; optional env toggles allow cross-subdomain deployments.
    // ID Token (contains user info and groups)
    response.cookies.set(AFU9_AUTH_COOKIE, IdToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      maxAge: 60 * 60, // 1 hour (matches token validity)
      path: '/',
      ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
    });

    // Access Token (for API calls)
    response.cookies.set(AFU9_ACCESS_COOKIE, AccessToken, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      maxAge: 60 * 60, // 1 hour (matches token validity)
      path: '/',
      ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
    });

    // Optionally store refresh token (longer expiry)
    if (RefreshToken) {
      response.cookies.set(AFU9_REFRESH_COOKIE, RefreshToken, {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
        maxAge: 60 * 60 * 24 * 30, // 30 days (matches token validity)
        path: '/',
        ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
      });
    }

    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: response.status, reason: 'ok' });
    return response;
  } catch (error: any) {
    console.error('Login error:', error);

    // Handle specific Cognito errors
    if (error.name === 'NotAuthorizedException') {
      const response = NextResponse.json(
        {
          error: 'Invalid username or password',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 401, reason: 'not_authorized' });
      return response;
    }

    if (error.name === 'UserNotFoundException') {
      const response = NextResponse.json(
        {
          error: 'Invalid username or password',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 401, reason: 'user_not_found' });
      return response;
    }

    if (error.name === 'UserNotConfirmedException') {
      const response = NextResponse.json(
        {
          error: 'User account not confirmed',
          requestId,
          timestamp: new Date().toISOString(),
        },
        { status: 401 }
      );
      response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
      attachRequestId(response, requestId);
      logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 401, reason: 'user_not_confirmed' });
      return response;
    }

    // Generic error response
    const response = NextResponse.json(
      {
        error: 'Authentication failed',
        requestId,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
    response.headers.set(AUTH_STATE_HEADER, 'unauthenticated');
    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/login', method: 'POST', status: 500, reason: 'unhandled_error' });
    return response;
  }
}
