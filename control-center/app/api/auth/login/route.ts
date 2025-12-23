import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import { verifyJWT } from '../../../../lib/auth/jwt-verify';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
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

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

/**
 * GET /api/auth/login
 * 
 * Check if user is already authenticated
 * - If authenticated: redirect to /dashboard (or ?redirectTo= query param)
 * - If not authenticated: redirect to AFU9_UNAUTH_REDIRECT
 */
export async function GET(request: NextRequest) {
  // Check if user already has valid authentication cookie
  const idToken = request.cookies.get(AFU9_AUTH_COOKIE)?.value;

  if (idToken) {
    // Verify the token
    const verifyResult = await verifyJWT(idToken);
    
    if (verifyResult.success) {
      // User is authenticated, redirect to dashboard or redirectTo param
      const redirectTo = request.nextUrl.searchParams.get('redirectTo') || '/dashboard';
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
  }

  // Not authenticated, redirect to unauth page
  return NextResponse.redirect(AFU9_UNAUTH_REDIRECT);
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
 *   "success": true,
 *   "message": "Login successful"
 * }
 * 
 * Response (Browser clients with Accept: text/html):
 * 302 redirect to /dashboard or ?redirectTo= param
 * 
 * Error response:
 * {
 *   "success": false,
 *   "error": "Invalid credentials"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { username, password } = body;

    // Validate input
    if (!username || !password) {
      return NextResponse.json(
        {
          success: false,
          error: 'Username and password are required',
        },
        { status: 400 }
      );
    }

    // Validate environment variables
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      console.error('Missing Cognito configuration');
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication service not configured',
        },
        { status: 500 }
      );
    }

    // Prepare authentication request
    const authParams: InitiateAuthCommandInput = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    };

    // Authenticate with Cognito
    const command = new InitiateAuthCommand(authParams);
    const authResult = await cognitoClient.send(command);

    // Check if authentication was successful
    if (!authResult.AuthenticationResult) {
      console.error('Authentication failed: No authentication result');
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication failed',
        },
        { status: 401 }
      );
    }

    // Extract tokens
    const { IdToken, AccessToken, RefreshToken } = authResult.AuthenticationResult;

    if (!IdToken || !AccessToken) {
      console.error('Authentication failed: Missing tokens');
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication failed',
        },
        { status: 401 }
      );
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
        success: true,
        message: 'Login successful',
      });
    }

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

    return response;
  } catch (error: any) {
    console.error('Login error:', error);

    // Handle specific Cognito errors
    if (error.name === 'NotAuthorizedException') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    if (error.name === 'UserNotFoundException') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid username or password',
        },
        { status: 401 }
      );
    }

    if (error.name === 'UserNotConfirmedException') {
      return NextResponse.json(
        {
          success: false,
          error: 'User account not confirmed',
        },
        { status: 401 }
      );
    }

    // Generic error response
    return NextResponse.json(
      {
        success: false,
        error: 'Authentication failed',
      },
      { status: 500 }
    );
  }
}
