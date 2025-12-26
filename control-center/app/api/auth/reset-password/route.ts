import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

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
 *   "success": true,
 *   "message": "Password reset successful"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, code, newPassword } = body;

    // Validate input
    if (!username || !code || !newPassword) {
      return NextResponse.json(
        {
          error: 'Username, code, and new password are required',
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    // Validate environment variables
    if (!COGNITO_CLIENT_ID) {
      console.error('Missing Cognito configuration');
      return NextResponse.json(
        {
          error: 'Password reset service not configured',
          requestId: getRequestId(),
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
    }

    // Confirm forgot password with code
    const command = new ConfirmForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
      ConfirmationCode: code,
      Password: newPassword,
    });

    await cognitoClient.send(command);

    return NextResponse.json({
      success: true,
      message: 'Password reset successful',
    });
  } catch (error: unknown) {
    console.error('Reset password error:', error);

    // Handle specific Cognito errors
    if (error instanceof Error) {
      if (error.name === 'CodeMismatchException') {
        return NextResponse.json(
          {
            error: 'Invalid verification code',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        );
      }

      if (error.name === 'ExpiredCodeException') {
        return NextResponse.json(
          {
            error: 'Verification code has expired',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        );
      }

      if (error.name === 'InvalidPasswordException') {
        return NextResponse.json(
          {
            error: 'Password does not meet requirements',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 400 }
        );
      }

      if (error.name === 'LimitExceededException') {
        return NextResponse.json(
          {
            error: 'Too many attempts. Please try again later.',
            requestId: getRequestId(),
            timestamp: new Date().toISOString(),
          },
          { status: 429 }
        );
      }
    }

    // Generic error response
    return NextResponse.json(
      {
        error: 'Password reset failed',
        requestId: getRequestId(),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
