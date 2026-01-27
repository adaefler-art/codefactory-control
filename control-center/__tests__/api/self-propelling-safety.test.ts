/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST as selfPropelPost } from '../../app/api/issues/[id]/self-propel/route';

describe('Self-propelling safety guards', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns 404 when self-propelling is disabled (default)', async () => {
    delete process.env.AFU9_ENABLE_SELF_PROPELLING;

    const res = await selfPropelPost(
      { json: async () => ({ owner: 'o', repo: 'r' }) } as any,
      { params: { id: '1' } } as any
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('fails readiness when enabled but workflow artifact is missing', async () => {
    process.env.AFU9_ENABLE_SELF_PROPELLING = 'true';
    process.env.DATABASE_ENABLED = 'false';
    process.env.AFU9_STAGE = 'development';
    process.env.SERVICE_READ_TOKEN = 'test-token';

    jest.resetModules();
    jest.doMock('fs', () => {
      const actual = jest.requireActual('fs');
      return {
        ...actual,
        existsSync: () => false,
      };
    });

    const { GET: readyGet } = await import('../../app/api/ready/route');
    const res = await readyGet(new NextRequest('http://localhost/api/ready'));

    expect(res.status).toBe(503);

    const payload = await res.json();
    expect(payload.ready).toBe(false);
    expect(payload.checks.self_propelling.status).toBe('error');
    expect(payload.checks.self_propelling.message).toContain(
      'AFU9_ENABLE_SELF_PROPELLING=true but workflow artifact missing'
    );
  });
});
