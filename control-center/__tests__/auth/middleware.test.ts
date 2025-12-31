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

describe('Middleware Authentication Logic', () => {
  beforeEach(() => {
    process.env.AFU9_AUTH_COOKIE = 'afu9_id';
    process.env.AFU9_UNAUTH_REDIRECT = 'https://afu-9.com/';
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
  });

  afterEach(() => {
    delete process.env.AFU9_AUTH_COOKIE;
    delete process.env.AFU9_UNAUTH_REDIRECT;
    delete process.env.AFU9_PUBLIC_STATUS_ENDPOINTS;
  });

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
});
