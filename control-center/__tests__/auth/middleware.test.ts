/**
 * Tests for authentication middleware (unit tests for helpers only)
 * 
 * Note: Full integration tests for middleware would require Next.js test utilities
 * These tests focus on the authentication logic rather than Next.js specifics
 */

import * as jwtVerify from '../../lib/auth/jwt-verify';
import * as stageEnforcement from '@/lib/auth/stage-enforcement';
import { PUBLIC_ROUTES, isPublicRoute } from '../../lib/auth/middleware-public-routes';
import { shouldAllowUnauthenticatedGithubStatusEndpoint } from '../../src/lib/auth/public-status-endpoints';
import * as smokeAllowlist from '../../src/lib/db/smokeKeyAllowlist';
import { middleware } from '../../proxy';

jest.mock('../../src/lib/db/smokeKeyAllowlist', () => {
  const actual = jest.requireActual('../../src/lib/db/smokeKeyAllowlist');
  return {
    ...actual,
    getActiveAllowlist: jest.fn(),
  };
});

const defaultAllowlist: smokeAllowlist.SmokeKeyAllowlistEntry[] = [
  {
    id: 1,
    route_pattern: '/api/timeline/chain',
    method: 'GET',
    is_regex: false,
    description: 'Timeline chain smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 2,
    route_pattern: '/api/intent/sessions',
    method: 'POST',
    is_regex: false,
    description: 'Intent sessions smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 3,
    route_pattern: '^/api/intent/sessions/[^/]+/messages$',
    method: 'POST',
    is_regex: true,
    description: 'Intent session messages smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 4,
    route_pattern: '/api/issues',
    method: 'GET',
    is_regex: false,
    description: 'Issues list smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 5,
    route_pattern: '/api/ops/issues/sync',
    method: 'POST',
    is_regex: false,
    description: 'Ops issues sync smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 6,
    route_pattern: '/api/issues/sync',
    method: 'POST',
    is_regex: false,
    description: 'Issues sync smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 7,
    route_pattern: '/api/integrations/github/ingest/issue',
    method: 'POST',
    is_regex: false,
    description: 'GitHub ingest smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
  {
    id: 8,
    route_pattern: '/api/afu9/s1s3/issues/pick',
    method: 'POST',
    is_regex: false,
    description: 'S1S3 pick smoke bypass',
    added_by: 'test',
    added_at: new Date(0).toISOString(),
    removed_by: null,
    removed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
];

const mockGetActiveAllowlist = smokeAllowlist.getActiveAllowlist as jest.MockedFunction<
  typeof smokeAllowlist.getActiveAllowlist
>;

describe('Middleware Authentication Logic', () => {
  beforeEach(() => {
    process.env.AFU9_AUTH_COOKIE = 'afu9_id';
    process.env.AFU9_UNAUTH_REDIRECT = 'https://afu-9.com/';
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
    delete process.env.AFU9_SMOKE_KEY;
    delete process.env.SERVICE_READ_TOKEN;
    mockGetActiveAllowlist.mockResolvedValue({ success: true, data: defaultAllowlist });
  });

  afterEach(() => {
    delete process.env.AFU9_AUTH_COOKIE;
    delete process.env.AFU9_UNAUTH_REDIRECT;
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
    delete process.env.AFU9_SMOKE_KEY;
    delete process.env.SERVICE_READ_TOKEN;
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
        pathname: '/api/mcp/verify',
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
        method: 'GET',
        pathname: '/api/mcp/verify',
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
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('plain');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-expected-format')).toBe('plain');
      expect(response.headers.get('x-afu9-smoke-expected-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-key-len')).toBe(String('wrong'.length));
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
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('plain');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-expected-format')).toBe('plain');
      expect(response.headers.get('x-afu9-smoke-expected-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-key-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
      expect(response.headers.get('x-request-id')).toBeTruthy();
    });

    test('env set as JSON {key:"secret"}, correct header -> bypass on staging host', async () => {
      const env = JSON.stringify({ key: 'secret' });
      process.env.AFU9_SMOKE_KEY = env;
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('json');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe(String(env.trim().length));
      expect(response.headers.get('x-afu9-smoke-expected-format')).toBe('json-extracted');
      expect(response.headers.get('x-afu9-smoke-expected-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
    });

    test('env set as JSON {smokeKey:"secret"}, correct header -> bypass on staging host', async () => {
      const env = JSON.stringify({ smokeKey: 'secret' });
      process.env.AFU9_SMOKE_KEY = env;
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('json');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe(String(env.trim().length));
      expect(response.headers.get('x-afu9-smoke-expected-format')).toBe('json-extracted');
      expect(response.headers.get('x-afu9-smoke-expected-len')).toBe(String('secret'.length));
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
    });

    test('env looks like JSON but is invalid -> no throw, bypass disabled (match=false)', async () => {
      const env = '{not-valid-json';
      process.env.AFU9_SMOKE_KEY = env;
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/timeline/chain',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('json_invalid');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe(String(env.trim().length));
      expect(response.headers.get('x-afu9-smoke-expected-format')).toBe('json-unusable');
      expect(response.headers.get('x-afu9-smoke-expected-len')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
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
      expect(response.headers.get('x-afu9-smoke-stage')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-env-present')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-key-match')).toBeNull();
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
      expect(response.headers.get('x-afu9-smoke-env-format')).toBe('plain');
      expect(response.headers.get('x-afu9-smoke-env-len')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-key-len')).toBe(String('secret'.length));
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

  describe('Smoke-auth bypass allowlist for Issues endpoints (staging only)', () => {
    test('stage + correct key + GET /api/issues => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/issues',
        method: 'GET',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-env-present')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('1');
    });

    test('stage + correct key + POST /api/ops/issues/sync => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/ops/issues/sync',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('stage + correct key + POST /api/issues/sync => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/issues/sync',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret', 'x-afu9-sub': 'smoke-user-a' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('stage + correct key + POST /api/integrations/github/ingest/issue => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/integrations/github/ingest/issue',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
    });

    test('stage + wrong key => bypass not active (401)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/issues',
        headers: { 'x-afu9-smoke-key': 'wrong' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-stage')).toBe('staging');
      expect(response.headers.get('x-afu9-smoke-key-match')).toBe('0');
    });

    test('non-stage + correct key => bypass not active (401)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://prod.afu-9.com/api/issues',
        method: 'GET',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-stage')).toBeNull();
    });

    test('non-stage + correct key + POST /api/issues/sync => bypass not active (401)', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      const request = makeRequest({
        url: 'https://prod.afu-9.com/api/issues/sync',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret', 'x-afu9-sub': 'smoke-user-a' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-stage')).toBeNull();
    });
  });

  describe('Smoke-auth bypass allowlist for S1S3 pick (staging only)', () => {
    const allowlistedEntry = {
      id: 1,
      route_pattern: '/api/afu9/s1s3/issues/pick',
      method: 'post',
      is_regex: false,
      description: 'S1S3 pick smoke test',
      added_by: 'test',
      added_at: new Date(0).toISOString(),
      removed_by: null,
      removed_at: null,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    };

    test('stage + correct key + allowlisted POST /api/afu9/s1s3/issues/pick => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      mockGetActiveAllowlist.mockResolvedValue({ success: true, data: [allowlistedEntry] });
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);

      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/s1s3/issues/pick',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-bypass')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-allowlisted')).toBe('1');

      nowSpy.mockRestore();
    });

    test('stage + correct key + NOT allowlisted => still 401', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      mockGetActiveAllowlist.mockResolvedValue({ success: true, data: [] });
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(60000);

      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/s1s3/issues/pick',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-auth-used')).toBeNull();
      expect(response.headers.get('x-afu9-smoke-bypass')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-allowlisted')).toBe('0');

      nowSpy.mockRestore();
    });

    test('stage + correct key + allowlist lookup failure => 401 with allowlist error header', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';
      mockGetActiveAllowlist.mockResolvedValue({ success: false, error: 'DB down' });
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(120000);

      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/s1s3/issues/pick',
        method: 'POST',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(401);
      expect(response.headers.get('x-afu9-smoke-bypass')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-allowlisted')).toBe('0');
      expect(response.headers.get('x-afu9-smoke-allowlist-error')).toBe('db_unreachable');

      nowSpy.mockRestore();
    });
  });

  describe('Smoke-auth diagnostics bypass (staging only)', () => {
    test('stage + correct key + GET /api/diagnostics/smoke-key/allowlist => bypass active', async () => {
      process.env.AFU9_SMOKE_KEY = 'secret';

      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/diagnostics/smoke-key/allowlist',
        method: 'GET',
        headers: { 'x-afu9-smoke-key': 'secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('x-afu9-smoke-bypass')).toBe('1');
      expect(response.headers.get('x-afu9-smoke-allowlisted')).toBe('0');
    });
  });

  describe('Service read token access (afu9 issues)', () => {
    test('missing token keeps unauthenticated behavior (401)', async () => {
      process.env.SERVICE_READ_TOKEN = 'service-secret';
      const request = makeRequest({ url: 'https://stage.afu-9.com/api/afu9/issues' });

      const response = await middleware(request);
      expect(response.status).toBe(401);
    });

    test('wrong token returns 403', async () => {
      process.env.SERVICE_READ_TOKEN = 'service-secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/issues',
        headers: { 'x-afu9-service-token': 'wrong-secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(403);
    });

    test('correct token allows GET /api/afu9/issues', async () => {
      process.env.SERVICE_READ_TOKEN = 'service-secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/issues',
        headers: { 'x-afu9-service-token': 'service-secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
    });

    test('correct token allows GET /api/afu9/issues/:id', async () => {
      process.env.SERVICE_READ_TOKEN = 'service-secret';
      const request = makeRequest({
        url: 'https://stage.afu-9.com/api/afu9/issues/ISS-001',
        headers: { 'x-afu9-service-token': 'service-secret' },
      });

      const response = await middleware(request);
      expect(response.status).toBe(200);
    });
  });
});
