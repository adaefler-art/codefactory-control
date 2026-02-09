/**
 * Tests for GET /api/health
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getHealth } from '../../app/api/health/route';

describe('GET /api/health', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
    process.env.BUILD_TIME = '2026-02-09T00:00:00.000Z';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns commitSha, buildTime, and service', async () => {
    const request = new NextRequest('http://localhost/api/health');
    const response = await getHealth(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.service).toBe('afu9-control-center');
    expect(body.commitSha).toBe('abcdef1234567890');
    expect(body.buildTime).toBe('2026-02-09T00:00:00.000Z');
  });
});
