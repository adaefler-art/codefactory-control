import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';
import { parseBooleanEnv } from '../../../../lib/env-utils';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
const DISABLE_PASSWORD_RESET = parseBooleanEnv(process.env.DISABLE_PASSWORD_RESET);

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

function getRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function applyNoStoreHeaders(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'no-store, max-age=0');
  response.headers.set('pragma', 'no-cache');
  return response;
}

/**
 * POST /api/auth/reset-password
 * 
 * Confirms password reset with verification code
 * 
 * Request body:
 * {
 *   "username": "user@example.com",
 *   "code": "123456",
 *   "newPassword": "newPassword123!"
 * }
 * 
 * Response:
 * {
 *   "message": "Password reset successful"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, code, newPassword } = body;

    // Check if password reset is disabled
    if (DISABLE_PASSWORD_RESET) {
      return applyNoStoreHeaders(NextResponse.json(
        {
          error: 'Password reset is not available in this environment',
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        },
        { status: 501 }
      ));
    }

    // Validate input
    if (!username || !code || !newPassword) {
      return applyNoStoreHeaders(NextResponse.json(
        {
          error: 'Username, code, and new password are required',
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      ));
    }

    // Validate environment variables
    if (!COGNITO_CLIENT_ID) {
      console.error('Missing Cognito configuration');
      return applyNoStoreHeaders(NextResponse.json(
        {
          error: 'Password reset service not configured',
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      ));
    }

    // Confirm forgot password with code
    const command = new ConfirmForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    });

    await cognitoClient.send(command);

    return applyNoStoreHeaders(NextResponse.json({
      message: 'Password reset successful',
    }));
  } catch (error: unknown) {
    console.error('Reset password error:', error);

    // Handle specific Cognito errors
    if (error instanceof Error) {
      if (error.name === 'CodeMismatchException') {
        return applyNoStoreHeaders(NextResponse.json(
          {
            error: 'Invalid verification code',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        ));
      }

      if (error.name === 'ExpiredCodeException') {
        return applyNoStoreHeaders(NextResponse.json(
          {
            error: 'Verification code has expired',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        ));
      }

      if (error.name === 'InvalidPasswordException') {
        return applyNoStoreHeaders(NextResponse.json(
          {
            error: 'Password does not meet requirements',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        ));
      }

      if (error.name === 'LimitExceededException') {
        return applyNoStoreHeaders(NextResponse.json(
          {
            error: 'Too many attempts. Please try again later.',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 429 }
        ));
      }
    }

    // Generic error response
    return applyNoStoreHeaders(NextResponse.json(
      {
        error: 'Password reset failed',
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    ));
  }
}
