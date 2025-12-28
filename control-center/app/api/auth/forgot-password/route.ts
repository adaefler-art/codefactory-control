import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import crypto from 'crypto';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
const AFU9_DEBUG_AUTH = (process.env.AFU9_DEBUG_AUTH || '').toLowerCase() === 'true' || process.env.AFU9_DEBUG_AUTH === '1';
const DISABLE_PASSWORD_RESET = (process.env.DISABLE_PASSWORD_RESET || 'false').toLowerCase() === 'true' || process.env.DISABLE_PASSWORD_RESET === '1';

function getCorrelationId(request: NextRequest): string {
  return (
    request.headers.get('x-correlation-id') ||
    request.headers.get('x-request-id') ||
    crypto.randomUUID()
  );
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function usernameToHash(username: string): string {
  return sha256Hex(username.trim().toLowerCase());
}

function clientIdSuffix(clientId: string): string {
  if (!clientId) return '';
  return clientId.length <= 6 ? clientId : clientId.slice(-6);
}

function extractErrorCode(error: unknown): string {
  if (typeof error === 'object' && error && 'name' in error && typeof (error as any).name === 'string') {
    return (error as any).name;
  }
  return 'UnknownError';
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return '';
}

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
 *   "message": "Password reset code sent to your email"
 * }
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);

  try {
    const body = await request.json();
    const { username } = body;

    // Check if password reset is disabled
    if (DISABLE_PASSWORD_RESET) {
      console.log(JSON.stringify({
        event: 'forgot_password',
        result: 'disabled',
        errorCode: 'PasswordResetDisabled',
        correlationId,
      }));

      const response = NextResponse.json(
        {
          error: 'Password reset is not available in this environment',
          requestId: correlationId,
          timestamp: new Date().toISOString(),
        },
        { status: 501 }
      );
      response.headers.set('x-afu9-correlation-id', correlationId);
      response.headers.set('cache-control', 'no-store, max-age=0');
      response.headers.set('pragma', 'no-cache');
      return response;
    }

    // Validate input
    if (!username) {
      const response = NextResponse.json(
        {
          error: 'Username is required',
          requestId: correlationId,
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
      response.headers.set('x-afu9-correlation-id', correlationId);
      response.headers.set('cache-control', 'no-store, max-age=0');
      response.headers.set('pragma', 'no-cache');
      return response;
    }

    // Validate environment variables
    if (!COGNITO_CLIENT_ID) {
      console.error(JSON.stringify({
        event: 'forgot_password',
        result: 'error',
        errorCode: 'MissingCognitoClientId',
        usernameHash: usernameToHash(username),
        clientIdSuffix: clientIdSuffix(COGNITO_CLIENT_ID),
        region: COGNITO_REGION,
        correlationId,
      }));

      const response = NextResponse.json(
        {
          error: 'Password reset service not configured',
          requestId: correlationId,
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
      );
      response.headers.set('x-afu9-correlation-id', correlationId);
      response.headers.set('cache-control', 'no-store, max-age=0');
      response.headers.set('pragma', 'no-cache');
      return response;
    }

    // Initiate forgot password flow
    const command = new ForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: username,
    });

    await cognitoClient.send(command);

    console.log(JSON.stringify({
      event: 'forgot_password',
      result: 'ok',
      errorCode: '',
      usernameHash: usernameToHash(username),
      clientIdSuffix: clientIdSuffix(COGNITO_CLIENT_ID),
      region: COGNITO_REGION,
      correlationId,
    }));

    // Always return success message for security (don't reveal if user exists)
    const response = NextResponse.json({
      message: 'If the email address exists, a password reset code has been sent.',
    });
    response.headers.set('x-afu9-correlation-id', correlationId);
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    return response;
  } catch (error: unknown) {
    const errorCode = extractErrorCode(error);
    const errorMessage = extractErrorMessage(error);

    console.error(JSON.stringify({
      event: 'forgot_password',
      result: 'error',
      errorCode,
      usernameHash: '',
      clientIdSuffix: clientIdSuffix(COGNITO_CLIENT_ID),
      region: COGNITO_REGION,
      correlationId,
      ...(AFU9_DEBUG_AUTH ? { errorMessage } : {}),
    }));

    const responseBody: Record<string, unknown> = {
      error: 'Password reset failed',
      requestId: correlationId,
      timestamp: new Date().toISOString(),
    };
    if (AFU9_DEBUG_AUTH) {
      responseBody.details = `${errorCode}: ${errorMessage}`;
    }

    // Return 500 for service errors (not 502 which indicates bad gateway)
    const response = NextResponse.json(responseBody, { status: 500 });
    response.headers.set('x-afu9-correlation-id', correlationId);
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    return response;
  }
}
