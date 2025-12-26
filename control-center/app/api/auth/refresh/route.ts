import { NextRequest, NextResponse } from 'next/server';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'crypto';

// Environment configuration
const COGNITO_REGION = process.env.COGNITO_REGION || 'eu-central-1';
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || '';
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_ACCESS_COOKIE = process.env.AFU9_ACCESS_COOKIE || 'afu9_access';
const AFU9_REFRESH_COOKIE = process.env.AFU9_REFRESH_COOKIE || 'afu9_refresh';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || '/login';
const AFU9_DEBUG_AUTH = (process.env.AFU9_DEBUG_AUTH || '').toLowerCase() === 'true' || process.env.AFU9_DEBUG_AUTH === '1';
const AFU9_COOKIE_DOMAIN = process.env.AFU9_COOKIE_DOMAIN;
const AFU9_COOKIE_SAMESITE_ENV = (process.env.AFU9_COOKIE_SAMESITE || 'lax').toLowerCase();

const cookieSameSite: 'lax' | 'strict' | 'none' =
  AFU9_COOKIE_SAMESITE_ENV === 'none' || AFU9_COOKIE_SAMESITE_ENV === 'strict'
    ? (AFU9_COOKIE_SAMESITE_ENV as 'none' | 'strict')
    : 'lax';

// SameSite=None requires Secure.
const cookieSecure = process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

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
  return response;
}

function applyDebugHeaders(response: NextResponse) {
  if (!AFU9_DEBUG_AUTH) return;
  response.headers.set('x-afu9-auth-debug', '1');
  response.headers.set('x-afu9-auth-via', 'refresh');
}

function applyNoStore(response: NextResponse) {
  response.headers.set('cache-control', 'no-store, max-age=0');
  response.headers.set('pragma', 'no-cache');
}

function getFirstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  // Proxies may send comma-separated lists; take the first hop.
  return value.split(',')[0]?.trim() || null;
}

function computeExpectedOrigin(request: NextRequest): string {
  const proto = getFirstHeaderValue(request.headers.get('x-forwarded-proto')) || 'https';
  const host =
    getFirstHeaderValue(request.headers.get('x-forwarded-host')) ||
    getFirstHeaderValue(request.headers.get('host')) ||
    new URL(request.url).host;

  return `${proto}://${host}`;
}

function validateSameOrigin(request: NextRequest):
  | { ok: true; expectedOrigin: string; origin: string | null; referer: string | null }
  | { ok: false; reason: string; expectedOrigin: string; origin: string | null; referer: string | null } {
  const expectedOrigin = computeExpectedOrigin(request);
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  if (origin) {
    if (origin === expectedOrigin) return { ok: true, expectedOrigin, origin, referer };
    return { ok: false, reason: 'origin_mismatch', expectedOrigin, origin, referer };
  }

  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (refererOrigin === expectedOrigin) return { ok: true, expectedOrigin, origin, referer };
      return { ok: false, reason: 'referer_mismatch', expectedOrigin, origin, referer };
    } catch {
      return { ok: false, reason: 'invalid_referer', expectedOrigin, origin, referer };
    }
  }

  // If neither Origin nor Referer is present, allow (some clients/proxies strip these).
  // We still rely on SameSite cookies + refresh-token possession.
  if (AFU9_DEBUG_AUTH) {
    console.log('[AUTH-REFRESH][DEBUG] No Origin/Referer header present; allowing POST', {
      expectedOrigin,
      host: request.headers.get('host'),
      xForwardedHost: request.headers.get('x-forwarded-host'),
      xForwardedProto: request.headers.get('x-forwarded-proto'),
    });
  }

  return { ok: true, expectedOrigin, origin, referer };
}

function clearAuthCookies(response: NextResponse) {
  const base = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: 0,
    path: '/',
    ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
  } as const;

  response.cookies.set(AFU9_AUTH_COOKIE, '', base);
  response.cookies.set(AFU9_ACCESS_COOKIE, '', base);
  response.cookies.set(AFU9_REFRESH_COOKIE, '', base);
}

function setAuthCookies(response: NextResponse, tokens: { IdToken?: string; AccessToken?: string; RefreshToken?: string }) {
  const base = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
    ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
  } as const;

  if (tokens.IdToken) {
    response.cookies.set(AFU9_AUTH_COOKIE, tokens.IdToken, {
      ...base,
      maxAge: 60 * 60,
    });
  }

  if (tokens.AccessToken) {
    response.cookies.set(AFU9_ACCESS_COOKIE, tokens.AccessToken, {
      ...base,
      maxAge: 60 * 60,
    });
  }

  // Only update refresh cookie if Cognito returns a new one (often it won't on refresh).
  if (tokens.RefreshToken) {
    response.cookies.set(AFU9_REFRESH_COOKIE, tokens.RefreshToken, {
      ...base,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

async function refreshTokens(refreshToken: string) {
  if (!COGNITO_CLIENT_ID) {
    throw new Error('Missing COGNITO_CLIENT_ID');
  }

  const authParams: InitiateAuthCommandInput = {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  };

  const command = new InitiateAuthCommand(authParams);
  const result = await cognitoClient.send(command);
  const tokens = result.AuthenticationResult;

  if (!tokens?.AccessToken && !tokens?.IdToken) {
    throw new Error('Refresh returned no tokens');
  }

  return {
    IdToken: tokens.IdToken,
    AccessToken: tokens.AccessToken,
    RefreshToken: tokens.RefreshToken,
  };
}

/**
 * GET /api/auth/refresh
 *
 * POST-only to avoid state changes on GET (prefetch/CSRF risk).
 */
export async function GET(_request: NextRequest) {
  const requestId = getRequestId();
  const response = NextResponse.json({ 
    error: 'Method Not Allowed',
    requestId,
    timestamp: new Date().toISOString(),
  }, { status: 405 });
  response.headers.set('allow', 'POST');
  applyNoStore(response);
  applyDebugHeaders(response);
  attachRequestId(response, requestId);
  logAuthRoute({ requestId, route: '/api/auth/refresh', method: 'GET', status: 405, reason: 'method_not_allowed' });
  return response;
}

/**
 * POST /api/auth/refresh
 *
 * API variant (returns JSON). Clients can call this if they want to proactively refresh.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId();
  // Defense-in-depth: reject cross-site POSTs (important if SameSite=None is configured).
  const csrf = validateSameOrigin(request);
  if (!csrf.ok) {
    const body: Record<string, unknown> = { 
      error: 'Forbidden',
      requestId,
      timestamp: new Date().toISOString(),
    };
    if (AFU9_DEBUG_AUTH) {
      body.details = csrf.reason;
      body.expectedOrigin = csrf.expectedOrigin;
      body.origin = csrf.origin;
      body.referer = csrf.referer;
    }

    const response = NextResponse.json(body, { status: 403 });
    applyNoStore(response);
    applyDebugHeaders(response);
    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/refresh', method: 'POST', status: 403, reason: 'csrf_forbidden' });
    return response;
  }

  const refreshToken = request.cookies.get(AFU9_REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = NextResponse.json({ 
      error: 'Missing refresh token',
      requestId,
      timestamp: new Date().toISOString(),
    }, { status: 401 });
    applyNoStore(response);
    applyDebugHeaders(response);
    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/refresh', method: 'POST', status: 401, reason: 'missing_refresh_token' });
    return response;
  }

  try {
    const tokens = await refreshTokens(refreshToken);
    const response = NextResponse.json({ success: true });
    setAuthCookies(response, tokens);
    applyNoStore(response);
    applyDebugHeaders(response);
    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/refresh', method: 'POST', status: 200, reason: 'ok' });
    return response;
  } catch (error: unknown) {
    console.error('[AUTH-REFRESH] Refresh failed:', error);
    const response = NextResponse.json({ 
      error: 'Refresh failed',
      requestId,
      timestamp: new Date().toISOString(),
    }, { status: 401 });
    clearAuthCookies(response);
    applyNoStore(response);
    applyDebugHeaders(response);
    attachRequestId(response, requestId);
    logAuthRoute({ requestId, route: '/api/auth/refresh', method: 'POST', status: 401, reason: 'refresh_failed' });
    return response;
  }
}
