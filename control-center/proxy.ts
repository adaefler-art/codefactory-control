import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from './lib/auth/jwt-verify';
import { getStageFromHostname, hasStageAccess, getGroupsClaimKey } from '@/lib/auth/stage-enforcement';
import { isPublicRoute } from './lib/auth/middleware-public-routes';
import { shouldAllowUnauthenticatedGithubStatusEndpoint } from './src/lib/auth/public-status-endpoints';
import { getEffectiveHostname } from './src/lib/http/effective-hostname';
import { extractSmokeKeyFromEnv, normalizeSmokeKeyCandidate, smokeKeysMatchConstantTime } from './src/lib/auth/smokeKey';
import { getActiveAllowlist, isRouteAllowed, type SmokeKeyAllowlistEntry } from './src/lib/db/smokeKeyAllowlist';

// Environment configuration for cookies and redirects
const AFU9_AUTH_COOKIE = process.env.AFU9_AUTH_COOKIE || 'afu9_id';
const AFU9_ACCESS_COOKIE = process.env.AFU9_ACCESS_COOKIE || 'afu9_access';
const AFU9_REFRESH_COOKIE = process.env.AFU9_REFRESH_COOKIE || 'afu9_refresh';
const AFU9_UNAUTH_REDIRECT = process.env.AFU9_UNAUTH_REDIRECT || '/login';
const AFU9_DEBUG_AUTH = (process.env.AFU9_DEBUG_AUTH || '').toLowerCase() === 'true' || process.env.AFU9_DEBUG_AUTH === '1';
const AFU9_COOKIE_DOMAIN = process.env.AFU9_COOKIE_DOMAIN;
const AFU9_COOKIE_SAMESITE_ENV = (process.env.AFU9_COOKIE_SAMESITE || 'lax').toLowerCase();
const normalizeServiceToken = (value: string): string => {
  let token = value.trim();

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/\r?\n/g, '').trim();

  return token;
};

const getServiceReadToken = () => normalizeServiceToken(process.env.SERVICE_READ_TOKEN || '');

const cookieSameSite: 'lax' | 'strict' | 'none' =
  AFU9_COOKIE_SAMESITE_ENV === 'none' || AFU9_COOKIE_SAMESITE_ENV === 'strict'
    ? (AFU9_COOKIE_SAMESITE_ENV as 'none' | 'strict')
    : 'lax';

const cookieSecure = process.env.NODE_ENV === 'production' || cookieSameSite === 'none';

// ========================================
// Smoke Key Allowlist Cache (I906)
// ========================================

interface AllowlistCache {
  data: SmokeKeyAllowlistEntry[];
  timestamp: number;
}

interface AllowlistFetchResult {
  data: SmokeKeyAllowlistEntry[];
  errorCode: string | null;
}

let allowlistCache: AllowlistCache | null = null;
const ALLOWLIST_CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Get smoke key allowlist with caching
 * 
 * Cache TTL: 30 seconds (meets requirement for changes to take effect within 30s)
 * Fail-closed: on error, returns empty array (denies access)
 */
async function getCachedAllowlist(): Promise<AllowlistFetchResult> {
  const now = Date.now();
  const bypassCache = process.env.NODE_ENV === 'test';
  
  // Check cache validity
  if (!bypassCache && allowlistCache && (now - allowlistCache.timestamp) < ALLOWLIST_CACHE_TTL_MS) {
    return { data: allowlistCache.data, errorCode: null };
  }
  
  // Fetch fresh data
  try {
    const result = await getActiveAllowlist();
    
    if (result.success && result.data) {
      if (!bypassCache) {
        allowlistCache = {
          data: result.data,
          timestamp: now,
        };
      }
      return { data: result.data, errorCode: null };
    } else {
      console.error('[MIDDLEWARE] Failed to fetch allowlist:', result.error);
      // Fail-closed: return empty array
      return { data: [], errorCode: 'db_unreachable' };
    }
  } catch (error) {
    console.error('[MIDDLEWARE] Error fetching allowlist:', error);
    // Fail-closed: return empty array
    return { data: [], errorCode: 'db_unreachable' };
  }
}

function getRequestId(): string {
  try {
    // Available in Edge runtime
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function getEffectiveHostnameFromRequest(request: NextRequest): string {
  return getEffectiveHostname({
    nextUrlHostname: request.nextUrl.hostname,
    hostHeader: request.headers.get('host'),
    forwardedHostHeader: request.headers.get('x-forwarded-host'),
  });
}

function logAuthDecision(params: {
  requestId: string;
  route: string;
  method: string;
  status: number;
  reason: string;
}) {
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

function clearCookie(response: NextResponse, name: string) {
  response.cookies.set(name, '', {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    maxAge: 0,
    path: '/',
    ...(AFU9_COOKIE_DOMAIN ? { domain: AFU9_COOKIE_DOMAIN } : {}),
  });
}

function isSmokeBypass(request: NextRequest): boolean {
  const { expectedSmokeKey } = extractSmokeKeyFromEnv(process.env.AFU9_SMOKE_KEY);
  const providedSmokeKey = normalizeSmokeKeyCandidate(request.headers.get('x-afu9-smoke-key'));
  return smokeKeysMatchConstantTime(providedSmokeKey, expectedSmokeKey);
}

function maybeAttachSmokeDebugHeaders(
  response: NextResponse,
  request: NextRequest,
  detectedStage: string,
  isStagingHost: boolean
): NextResponse {
  // Staging-only to avoid leaking auth/debug signals on prod paths.
  if (!isStagingHost) return response;

  const providedSmokeKey = request.headers.get('x-afu9-smoke-key');
  if (!providedSmokeKey) return response;

  const extraction = extractSmokeKeyFromEnv(process.env.AFU9_SMOKE_KEY);
  const normalizedProvided = normalizeSmokeKeyCandidate(providedSmokeKey);
  const keyMatch = isSmokeBypass(request);

  response.headers.set('x-afu9-smoke-stage', detectedStage);
  response.headers.set('x-afu9-smoke-env-present', extraction.envPresent ? '1' : '0');
  response.headers.set('x-afu9-smoke-env-format', extraction.envFormat);
  response.headers.set('x-afu9-smoke-env-len', String(extraction.envLen));
  response.headers.set('x-afu9-smoke-expected-len', String(extraction.expectedLen));
  response.headers.set('x-afu9-smoke-expected-format', extraction.expectedFormat);
  response.headers.set('x-afu9-smoke-key-len', String(normalizedProvided?.length ?? 0));
  response.headers.set('x-afu9-smoke-key-match', keyMatch ? '1' : '0');
  return response;
}

function isServiceReadRoute(pathname: string, method: string): boolean {
  if (method !== 'GET') return false;
  if (pathname === '/api/issues') return true;
  if (pathname === '/api/afu9/issues') return true;
  if (/^\/api\/issues\/[^/]+$/.test(pathname)) return true;
  return /^\/api\/afu9\/issues\/[^/]+$/.test(pathname);
}
/**
 * Proxy (middleware) to protect routes and verify authentication
 * 
 * Enhanced with:
 * - Fail-closed JWT verification
 * - API vs UI route differentiation (401 JSON vs redirect)
 * - Downstream context propagation via x-afu9-* headers
 * - Environment variable driven configuration
 */
export async function middleware(request: NextRequest) {
  const requestId = getRequestId();
  const { pathname: rawPathname } = request.nextUrl;
  const hostname = getEffectiveHostnameFromRequest(request);
  const pathname = rawPathname === '/' ? rawPathname : rawPathname.replace(/\/+$/, '');
  const isApiRoute = pathname.startsWith('/api/');
  const smokeHeaderRaw = request.headers.get('x-afu9-smoke-key');
  const smokeHeaderPresent = Boolean(smokeHeaderRaw && smokeHeaderRaw.trim());
  const smokeKeyMatch = smokeHeaderPresent ? isSmokeBypass(request) : false;
  const isSmokeDiagnosticsRoute =
    pathname === '/api/diagnostics/smoke-key/allowlist' ||
    pathname === '/api/diagnostics/smoke-key/allowlist/seed';
  let smokeAllowlisted = false;
  let smokeBypassUsed = false;
  let smokeAllowlistError: string | null = null;

  const attachSmokeBypassHeaders = (response: NextResponse): NextResponse => {
    if (!smokeHeaderPresent || !isApiRoute) return response;
    response.headers.set('x-afu9-smoke-bypass', smokeBypassUsed ? '1' : '0');
    response.headers.set('x-afu9-smoke-allowlisted', smokeAllowlisted ? '1' : '0');
    if (smokeAllowlistError) {
      response.headers.set('x-afu9-smoke-allowlist-error', smokeAllowlistError);
    }
    return response;
  };

  const nextWithRequestId = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-request-id', requestId);
    return response;
  };

  if (isServiceReadRoute(pathname, request.method)) {
    const providedServiceToken = normalizeServiceToken(
      request.headers.get('x-afu9-service-token') || ''
    );
    if (providedServiceToken) {
      const serviceReadToken = getServiceReadToken();
      if (!serviceReadToken || providedServiceToken !== serviceReadToken) {
        const response = NextResponse.json(
          { error: 'Forbidden', message: 'service token rejected' },
          { status: 403 }
        );
        attachRequestId(response, requestId);
        attachSmokeBypassHeaders(response);
        logAuthDecision({ requestId, route: pathname, method: request.method, status: 403, reason: 'service_token_rejected' });
        return response;
      }
      const response = nextWithRequestId();
      attachSmokeBypassHeaders(response);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'service_token_allow' });
      return response;
    }
  }
  // Optional smoke-auth bypass for runtime-configurable allowlist of API endpoints (staging only).
  // I906: Replaced hardcoded allowlist with database-backed runtime configuration.
  // Contract:
  // - Header: X-AFU9-SMOKE-KEY (case-insensitive)
  // - Env gate: AFU9_SMOKE_KEY must be set (otherwise bypass is disabled)
  // - Host gate: staging only (stage.afu-9.com)
  // - Allowlist: Fetched from database (30s cache, fail-closed)
  const detectedStage = getStageFromHostname(hostname);
  const isStagingHost = detectedStage === 'staging' || hostname.toLowerCase().startsWith('stage.');

  if (smokeHeaderPresent && smokeKeyMatch && isSmokeDiagnosticsRoute && isStagingHost) {
    smokeBypassUsed = true;

    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete('x-afu9-sub');
    requestHeaders.delete('x-afu9-stage');
    requestHeaders.delete('x-afu9-groups');
    requestHeaders.delete('x-afu9-auth-debug');
    requestHeaders.delete('x-afu9-auth-via');
    requestHeaders.set('x-request-id', requestId);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-afu9-smoke-auth-used', '1');
    attachSmokeBypassHeaders(response);
    return maybeAttachSmokeDebugHeaders(response, request, detectedStage, isStagingHost);
  }

  if (isStagingHost && smokeKeyMatch) {
    // Fetch allowlist from database (cached for 30s)
    const allowlistResult = await getCachedAllowlist();
    smokeAllowlistError = allowlistResult.errorCode;
    smokeAllowlisted = isRouteAllowed(pathname, request.method, allowlistResult.data);

    if (smokeAllowlisted) {
      smokeBypassUsed = true;
      const smokeSubRaw = request.headers.get('x-afu9-sub');
      const smokeSub = (smokeSubRaw || 'smoke').trim();

      const requestHeaders = new Headers(request.headers);
      requestHeaders.delete('x-afu9-sub');
      requestHeaders.delete('x-afu9-stage');
      requestHeaders.delete('x-afu9-groups');
      requestHeaders.delete('x-afu9-auth-debug');
      requestHeaders.delete('x-afu9-auth-via');
      requestHeaders.set('x-request-id', requestId);
      requestHeaders.set('x-afu9-sub', smokeSub);
      requestHeaders.set('x-afu9-auth-via', 'smoke');

      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.headers.set('x-request-id', requestId);
      response.headers.set('x-afu9-smoke-auth-used', '1');
      attachSmokeBypassHeaders(response);
      return maybeAttachSmokeDebugHeaders(response, request, detectedStage, isStagingHost);
    }
  }

  // STAGING-only ops endpoint: allow unauthenticated GET for status checks.
  // Middleware runs bundled; do not rely on runtime env vars here. Gate strictly by hostname.
  if (shouldAllowUnauthenticatedGithubStatusEndpoint({ method: request.method, pathname, hostname })) {
    return nextWithRequestId();
  }

  if (isPublicRoute(pathname)) {
    const response = nextWithRequestId();
    attachSmokeBypassHeaders(response);
    return response;
  }

  // Extract JWT tokens from cookies
  const idToken = request.cookies.get(AFU9_AUTH_COOKIE)?.value;
  const accessToken = request.cookies.get(AFU9_ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(AFU9_REFRESH_COOKIE)?.value;

  const redirectToRefresh = () => {
    const original = request.nextUrl.pathname + request.nextUrl.search;
    const url = new URL('/auth/refresh', request.url);
    url.searchParams.set('redirectTo', original);
    const response = NextResponse.redirect(url);
    if (AFU9_DEBUG_AUTH) {
      response.headers.set('x-afu9-auth-debug', '1');
      response.headers.set('x-afu9-auth-via', 'refresh');
    }
    response.headers.set('cache-control', 'no-store, max-age=0');
    response.headers.set('pragma', 'no-cache');
    return attachRequestId(response, requestId);
  };
  // (Cognito refresh tokens are typically opaque and cannot be verified in middleware.)
  if (!idToken && !accessToken && refreshToken) {
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Refresh-only cookies present; redirecting to /auth/refresh', {
        pathname,
        hostname,
        isApiRoute,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }

    const response = redirectToRefresh();
    logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_refresh_redirect' });
    return response;
  }


  // Fail closed: no auth material present
  if (!idToken && !accessToken) {
    console.log('[MIDDLEWARE] No authentication token found');
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] No tokens present', {
        pathname,
        hostname,
        isApiRoute,
        configuredCookies: {
          id: AFU9_AUTH_COOKIE,
          access: AFU9_ACCESS_COOKIE,
          refresh: AFU9_REFRESH_COOKIE,
        },
      });
    }
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
      attachRequestId(response, requestId);
      attachSmokeBypassHeaders(response);
      maybeAttachSmokeDebugHeaders(response, request, detectedStage, isStagingHost);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 401, reason: 'auth_missing' });
      return response;
    } else {
      // UI routes: redirect to unauth page
      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_missing_redirect' });
      return response;
    }
  }

  // Verify tokens using fail-closed helper.
  // Prefer ID token for identity; fall back to access token if needed.
  let verifiedPayload: any | null = null;
  let verifiedVia: 'id' | 'access' | 'refresh' | null = null;
  let verifyError: string | null = null;

  function tokenUseOk(tokenUse: unknown, expected: 'id' | 'access'): boolean {
    // Fail-closed on explicit mismatch. If token_use is missing, allow (some JWTs omit it).
    if (!tokenUse) return true;
    return tokenUse === expected;
  }

  if (idToken) {
    const idVerify = await verifyJWT(idToken);
    if (idVerify.success) {
      if (tokenUseOk((idVerify.payload as any).token_use, 'id')) {
        verifiedPayload = idVerify.payload;
        verifiedVia = 'id';
      } else {
        verifyError = 'token_use mismatch (expected id)';
      }
    } else {
      verifyError = idVerify.error;
    }
  }

  if (!verifiedPayload && accessToken) {
    const accessVerify = await verifyJWT(accessToken);
    if (accessVerify.success) {
      if (tokenUseOk((accessVerify.payload as any).token_use, 'access')) {
        verifiedPayload = accessVerify.payload;
        verifiedVia = 'access';
        verifyError = null;
      } else {
        verifyError = 'token_use mismatch (expected access)';
      }
    } else {
      verifyError = accessVerify.error;
    }
  }

  if (!verifiedPayload) {
    // Fail closed: invalid or expired token(s)
    console.log('[MIDDLEWARE] Token verification failed');
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Token verification failed', {
        pathname,
        hostname,
        isApiRoute,
        hasIdToken: Boolean(idToken),
        hasAccessToken: Boolean(accessToken),
        hasRefreshToken: Boolean(refreshToken),
        verifyError,
      });
    }
    
    if (isApiRoute) {
      // API routes: return 401 JSON
      const response = NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or expired token' },
        { status: 401 }
      );
      attachRequestId(response, requestId);
      attachSmokeBypassHeaders(response);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 401, reason: 'auth_invalid_or_expired' });
      return response;
    } else {
      // UI routes: if refresh cookie is present, try refresh flow; otherwise clear cookies and redirect.
      if (refreshToken) {
        const response = redirectToRefresh();
        logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_invalid_refresh_redirect' });
        return response;
      }

      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url));
      clearCookie(response, AFU9_AUTH_COOKIE);
      clearCookie(response, AFU9_ACCESS_COOKIE);
      clearCookie(response, AFU9_REFRESH_COOKIE);
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: response.status, reason: 'auth_invalid_redirect' });
      return response;
    }
  }

  // Extract user information from verified token
  const payload = verifiedPayload;
  const groupsClaimKey = getGroupsClaimKey();

  // Some Cognito setups don't include groups on the ID token but do on the access token.
  // If groups are missing and we verified via ID token, attempt access-token verification just for groups.
  let userGroups = (payload as any)[groupsClaimKey] as string[] | undefined;
  if ((!userGroups || userGroups.length === 0) && verifiedVia === 'id' && accessToken) {
    const accessVerify = await verifyJWT(accessToken);
    if (accessVerify.success) {
      const accessPayload = accessVerify.payload as any;
      const accessGroups = accessPayload[groupsClaimKey] as string[] | undefined;
      if (accessGroups && accessGroups.length > 0) {
        userGroups = accessGroups;
      }
    }
  }

  const userSub = (payload as any).sub || '';

  // Check stage-based access control
  const requiredStage = getStageFromHostname(hostname);
  const hasAccess = hasStageAccess(userGroups, requiredStage);
  
  if (!hasAccess) {
    console.log(`[MIDDLEWARE] User does not have access to ${requiredStage} stage`);
    if (AFU9_DEBUG_AUTH) {
      console.log('[MIDDLEWARE][DEBUG] Stage access denied', {
        pathname,
        hostname,
        requiredStage,
        groupsClaimKey,
        groupCount: userGroups?.length || 0,
        verifiedVia,
      });
    }
    
    if (isApiRoute) {
      // API routes: return 403 JSON
      const response = NextResponse.json(
        { error: 'Forbidden', message: `Access to ${requiredStage} stage not permitted` },
        { status: 403 }
      );
      attachRequestId(response, requestId);
      attachSmokeBypassHeaders(response);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 403, reason: 'stage_access_denied' });
      return response;
    } else {
      // UI routes: redirect to unauth page
      const response = NextResponse.redirect(new URL(AFU9_UNAUTH_REDIRECT, request.url), {
        status: 403,
      });
      attachRequestId(response, requestId);
      logAuthDecision({ requestId, route: pathname, method: request.method, status: 403, reason: 'stage_access_denied_redirect' });
      return response;
    }
  }

  // Authentication and authorization successful
  // Add downstream context propagation headers to request for route handlers
  // SECURITY: Strip any client-provided x-afu9-* headers before setting verified values
  // This prevents header spoofing attacks where clients could impersonate other users
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-afu9-sub');
  requestHeaders.delete('x-afu9-stage');
  requestHeaders.delete('x-afu9-groups');
  requestHeaders.delete('x-afu9-auth-debug');
  requestHeaders.delete('x-afu9-auth-via');
  
  // Now set the verified values from JWT payload
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-afu9-sub', userSub);
  requestHeaders.set('x-afu9-stage', requiredStage);
  requestHeaders.set('x-afu9-groups', userGroups?.join(',') || '');
  if (AFU9_DEBUG_AUTH) {
    requestHeaders.set('x-afu9-auth-debug', '1');
    requestHeaders.set('x-afu9-auth-via', verifiedVia || 'unknown');
  }
  
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', requestId);
  attachSmokeBypassHeaders(response);

  return response;
}

// Next.js 16 proxy entrypoint (middleware -> proxy migration)
export async function proxy(request: NextRequest) {
  return middleware(request);
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
