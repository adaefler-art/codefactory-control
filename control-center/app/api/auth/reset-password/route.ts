import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

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
          success: false,
          error: 'Username, code, and new password are required',
        },
        { status: 400 }
      );
    }

    // Validate environment variables
    if (!COGNITO_CLIENT_ID) {
      console.error('Missing Cognito configuration');
      return NextResponse.json(
        {
          success: false,
          error: 'Password reset service not configured',
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
            success: false,
            error: 'Invalid verification code',
          },
          { status: 400 }
        );
      }

      if (error.name === 'ExpiredCodeException') {
        return NextResponse.json(
          {
            success: false,
            error: 'Verification code has expired',
          },
          { status: 400 }
        );
      }

      if (error.name === 'InvalidPasswordException') {
        return NextResponse.json(
          {
            success: false,
            error: 'Password does not meet requirements',
          },
          { status: 400 }
        );
      }

      if (error.name === 'LimitExceededException') {
        return NextResponse.json(
          {
            success: false,
            error: 'Too many attempts. Please try again later.',
          },
          { status: 429 }
        );
      }
    }

    // Generic error response
    return NextResponse.json(
      {
        success: false,
        error: 'Password reset failed',
      },
      { status: 500 }
    );
  }
}
