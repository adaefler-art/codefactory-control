import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';

const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID;

const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_REGION,
});

function parseJWT(token: string): unknown {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) {
      return null;
    }
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, 'base64')
        .toString()
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    return null;
  }
}

function determineRedirectUrl(idToken: string): string {
  const claims = parseJWT(idToken) as Record<string, unknown> | null;
  
  if (claims && claims['cognito:groups']) {
    const groups = claims['cognito:groups'];
    if (Array.isArray(groups) && groups.includes('afu9-admin-prod')) {
      return 'https://prod.afu-9.com/';
    }
  }
  
  // Default redirect
  return 'https://stage.afu-9.com/';
}

export async function POST(request: NextRequest) {
  try {
    // Validate environment variables
    if (!COGNITO_USER_POOL_ID || !COGNITO_CLIENT_ID) {
      console.error('Missing Cognito configuration');
      return NextResponse.json(
        { error: 'Authentication service unavailable' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    // Authenticate with Cognito
    const authParams: InitiateAuthCommandInput = {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    };

    const command = new InitiateAuthCommand(authParams);
    const response = await cognitoClient.send(command);

    if (!response.AuthenticationResult) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    const { IdToken, AccessToken } = response.AuthenticationResult;

    if (!IdToken || !AccessToken) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 401 }
      );
    }

    // Determine redirect URL based on groups
    const redirectUrl = determineRedirectUrl(IdToken);

    // Create response with cookies
    const jsonResponse = NextResponse.json({ redirectUrl });

    // Set HttpOnly Secure cookies
    jsonResponse.cookies.set('afu9_id', IdToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600, // 1 hour
    });

    jsonResponse.cookies.set('afu9_access', AccessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600, // 1 hour
    });

    return jsonResponse;
  } catch (error: unknown) {
    console.error('Authentication error:', error);
    
    // Return generic error message without details
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }
}
