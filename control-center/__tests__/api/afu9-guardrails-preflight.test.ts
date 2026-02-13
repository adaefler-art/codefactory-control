/**
 * AFU-9 Guardrails Preflight Tests
 *
 * @jest-environment node
 */

import { POST as preflight } from '../../app/api/afu9/guardrails/preflight/route';
import { __resetPolicyCache } from '../../src/lib/github/auth-wrapper';

describe('POST /api/afu9/guardrails/preflight', () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...envSnapshot, AFU9_GUARDRAILS_ENABLED: 'true' };
    __resetPolicyCache();
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
    __resetPolicyCache();
  });

  test('repo not allowlisted -> 409 + headers', async () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'allowed', repo: 'repo', branches: ['main'] }],
    });
    __resetPolicyCache();

    const request = new Request('http://localhost/api/afu9/guardrails/preflight', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'repo_write',
        repo: 'blocked/target',
      }),
    }) as unknown as Parameters<typeof preflight>[0];

    const response = await preflight(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_REPO_NOT_ALLOWED');
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('guardrails-preflight');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-missing-config')).toBe('');
  });

  test('missing required config -> 409 + missingConfig + headers', async () => {
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify({
      allowlist: [{ owner: 'allowed', repo: 'repo', branches: ['main'] }],
    });
    __resetPolicyCache();

    const request = new Request('http://localhost/api/afu9/guardrails/preflight', {
      method: 'POST',
      body: JSON.stringify({
        operation: 'repo_write',
        repo: 'allowed/repo',
        requiresConfig: ['MISSING_ENV_A', 'MISSING_ENV_B'],
      }),
    }) as unknown as Parameters<typeof preflight>[0];

    const response = await preflight(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GUARDRAIL_CONFIG_MISSING');
    expect(body.missingConfig).toEqual(['MISSING_ENV_A', 'MISSING_ENV_B']);
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-handler')).toBe('guardrails-preflight');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-missing-config')).toBe('MISSING_ENV_A,MISSING_ENV_B');
  });

  test('feature flag disabled -> 204 no-op with headers', async () => {
    process.env.AFU9_GUARDRAILS_ENABLED = 'false';

    const request = new Request('http://localhost/api/afu9/guardrails/preflight', {
      method: 'POST',
      body: JSON.stringify({
        requestId: 'req-guardrails-disabled',
        operation: 'repo_write',
        repo: 'blocked/target',
      }),
    }) as unknown as Parameters<typeof preflight>[0];

    const response = await preflight(request);

    expect(response.status).toBe(204);
    expect(response.headers.get('x-afu9-request-id')).toBe('req-guardrails-disabled');
    expect(response.headers.get('x-afu9-handler')).toBe('guardrails-preflight');
    expect(response.headers.get('x-afu9-phase')).toBe('preflight');
    expect(response.headers.get('x-afu9-missing-config')).toBe('');
  });
});
