import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

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
 * Response:
 * {
 *   "success": true,
 *   "message": "Login successful"
 * }
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

    // Create response with success message
    const response = NextResponse.json({
      success: true,
      message: 'Login successful',
    });

    // Set HttpOnly, Secure cookies with SameSite=Lax
    // ID Token (contains user info and groups)
    response.cookies.set('afu9_id', IdToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1 hour (matches token validity)
      path: '/',
    });

    // Access Token (for API calls)
    response.cookies.set('afu9_access', AccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1 hour (matches token validity)
      path: '/',
    });

    // Optionally store refresh token (longer expiry)
    if (RefreshToken) {
      response.cookies.set('afu9_refresh', RefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30 days (matches token validity)
        path: '/',
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
