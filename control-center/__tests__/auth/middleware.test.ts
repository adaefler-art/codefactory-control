/**
 * Tests for authentication middleware (unit tests for helpers only)
 * 
 * Note: Full integration tests for middleware would require Next.js test utilities
 * These tests focus on the authentication logic rather than Next.js specifics
 */

import * as jwtVerify from '../../lib/auth/jwt-verify';
import * as stageEnforcement from '../../lib/auth/stage-enforcement';
import { PUBLIC_ROUTES, isPublicRoute } from '../../lib/auth/middleware-public-routes';
import { shouldAllowUnauthenticatedGithubStatusEndpoint } from '../../src/lib/auth/public-status-endpoints';
import { middleware } from '../../proxy';

describe('Middleware Authentication Logic', () => {
  beforeEach(() => {
    process.env.AFU9_AUTH_COOKIE = 'afu9_id';
    process.env.AFU9_UNAUTH_REDIRECT = 'https://afu-9.com/';
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
    delete process.env.AFU9_SMOKE_KEY;
  });

  afterEach(() => {
    delete process.env.AFU9_AUTH_COOKIE;
    delete process.env.AFU9_UNAUTH_REDIRECT;
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
    delete process.env.AFU9_SMOKE_KEY;
  });

  function makeRequest(params: { url: string; method?: string; headers?: Record<string, string> }) {
    const url = new URL(params.url);
    const headers = new Headers(params.headers ?? {});

    return {
      url: url.toString(),
      method: params.method ?? 'GET',
      nextUrl: url,
      headers,
      cookies: {
        get: () => undefined,
      },
    } as any;
  }

  test('Environment variables are correctly configured', () => {
    expect(process.env.AFU9_AUTH_COOKIE).toBe('afu9_id');
    expect(process.env.AFU9_UNAUTH_REDIRECT).toBe('https://afu-9.com/');
  });

  test('Public routes list includes expected paths', () => {
    expect(PUBLIC_ROUTES).toContain('/api/auth/login');
    expect(PUBLIC_ROUTES).toContain('/api/github/webhook');
    expect(PUBLIC_ROUTES).toContain('/api/webhooks/github');
    expect(PUBLIC_ROUTES).toContain('/api/health');
    expect(PUBLIC_ROUTES).toContain('/favicon.ico');
  });

  test('Webhook route is treated as public', () => {
    expect(isPublicRoute('/api/github/webhook')).toBe(true);
    expect(isPublicRoute('/api/webhooks/github')).toBe(true);
  });

  test('API routes are identified by /api/ prefix', () => {
    const apiPaths = ['/api/workflows', '/api/users', '/api/auth/logout'];
    const uiPaths = ['/dashboard', '/workflows', '/settings'];

    apiPaths.forEach(path => {
      expect(path.startsWith('/api/')).toBe(true);
    });

    uiPaths.forEach(path => {
      expect(path.startsWith('/api/')).toBe(false);
    });
  });

  test('Auth helpers are available for middleware', () => {
    expect(typeof jwtVerify.verifyJWT).toBe('function');
    expect(typeof stageEnforcement.hasStageAccess).toBe('function');
    expect(typeof stageEnforcement.getStageFromHostname).toBe('function');
    expect(typeof stageEnforcement.getGroupsClaimKey).toBe('function');
  });

  test('Expected x-afu9-* headers are defined', () => {
    const expectedHeaders = ['x-afu9-sub', 'x-afu9-stage', 'x-afu9-groups'];
    
    expectedHeaders.forEach(header => {
      expect(header).toMatch(/^x-afu9-/);
    });
  });

  test('Staging-only allow rule: unauthenticated GET /api/integrations/github/status on stage.* host', () => {
    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/integrations/github/status',
        hostname: 'stage.afu-9.com',
      })
    ).toBe(true);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/deploy/status',
        hostname: 'stage.afu-9.com',
      })
    ).toBe(true);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'POST',
        pathname: '/api/integrations/github/status',
        hostname: 'stage.afu-9.com',
      })
    ).toBe(false);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'POST',
        pathname: '/api/deploy/status',
        hostname: 'stage.afu-9.com',
      })
    ).toBe(false);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/health',
        hostname: 'stage.afu-9.com',
      })
    ).toBe(false);
  });

  test('Staging-only allow rule is disabled on non-stage hosts', () => {
    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/integrations/github/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(false);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/deploy/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(false);
  });

  test('Public status endpoint allow rule supports AFU9_PUBLIC_STATUS_ENDPOINTS=true', () => {
    process.env.AFU9_PUBLIC_STATUS_ENDPOINTS = 'true';

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/integrations/github/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(true);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'GET',
        pathname: '/api/deploy/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(true);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'POST',
        pathname: '/api/integrations/github/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(false);

    expect(
      shouldAllowUnauthenticatedGithubStatusEndpoint({
        method: 'POST',
        pathname: '/api/deploy/status',
        hostname: 'prod.afu-9.com',
      })
    ).toBe(false);
  });

  describe('Smoke-auth bypass for GET /api/timeline/chain', () => {
    test('env set, no header -> 401 (staging host)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({ url: 'https://stage.afu-9.com/api/timeline/chain' });

      const response = await middleware(request);
      expect(response.status).toBe(401);
    });

    test('env set, wrong header -> 401 (staging host)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'wrong' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
    });

    test('env set, correct header -> bypass (NextResponse.next) on staging host', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
      expect(response.headers.get('x-request-id')).toBeTruthy();
    });

    test('env has trailing newline/spaces, header matches after trim -> bypass on staging host', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret\n';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': '  secret  ' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('env set, correct header but non-staging host -> still 401', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://prod.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
    });

    test('env not set, header present -> still 401 (staging host)', async () => {
      delete process.env.AFU9_SMOKE_KEY;
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('0');
    });
  });

  describe('Smoke-auth bypass allowlist for Intent Sessions (staging only)', () => {
    test('stage + correct key + POST /api/intent/sessions => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/intent/sessions',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
    });

    test('stage + key matches after trim + POST /api/intent/sessions => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret\n';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/intent/sessions',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('stage + correct key + POST /api/intent/sessions/<id>/messages => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/intent/sessions/abc123/messages',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('stage + wrong/missing key => bypass not active (401)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';

      const missing = makeRequest({
        url: 'https://stage.afu-9.com/api/intent/sessions',
        method: 'POST',
      });
      const missingRes = await middleware(missing);
      expect(missingRes.status).toBe(401);
      expect(missingRes.headers.get('x-afu9-smoke-auth-used')).toBeNull();

      const wrong = makeRequest({
        url: 'https://stage.afu-9.com/api/intent/sessions/abc123/messages',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'wrong' },
      });
      const wrongRes = await middleware(wrong);
      expect(wrongRes.status).toBe(401);
      expect(wrongRes.headers.get('x-afu9-smoke-auth-used')).toBeNull();
    });

    test('non-stage + correct key => bypass not active (401)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://prod.afu-9.com/api/intent/sessions',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
    });
  });
});
