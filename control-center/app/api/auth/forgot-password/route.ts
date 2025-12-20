import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';

// Initialize Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

/**
 * POST /api/auth/forgot-password
 * 
 * Initiates password reset flow by sending verification code to user's email
 * 
 * Request body:
 * {
 *   "username": "user@example.com"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Password reset code sent to your email"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username } = body;

    // Validate input
    if (!username) {
      return NextResponse.json(
        {
          success: false,
          error: 'Username is required',
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

    // Initiate forgot password flow
    const command = new ForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
    });

    await cognitoClient.send(command);

    // Always return success message for security (don't reveal if user exists)
    return NextResponse.json({
      success: true,
      message: 'If the email address exists, a password reset code has been sent.',
    });
  } catch (error: unknown) {
    console.error('Forgot password error:', error);

    // Don't reveal specific error details for security
    return NextResponse.json({
      success: true,
      message: 'If the email address exists, a password reset code has been sent.',
    });
  }
}
