/**
 * E65.1 Proof Gates Tests (v2)
 *
 * Deploy status is derived deterministically from E65.2 post-deploy verification runs.
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/deploy/status/route';
import { resolveDeployStatusFromVerificationRuns } from '../../src/lib/deploy-status/verification-resolver';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({ query: jest.fn() })),
}));

jest.mock('../../src/lib/deploy-status/verification-resolver', () => ({
  resolveDeployStatusFromVerificationRuns: jest.fn(),
}));

jest.mock('../../src/lib/db/deployStatusSnapshots', () => ({
  getLatestDeployStatusSnapshot: jest.fn(),
  insertDeployStatusSnapshot: jest.fn(),
}));

describe('E65.1 Proof Gates (v2)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('Proof A: returns 503 when DATABASE_ENABLED is false', async () => {
    process.env.DATABASE_ENABLED = 'false';

    const request = new NextRequest('http://localhost/api/deploy/status?env=prod', { method: 'GET' });
    const response = await GET(request);

    expect(response.status).toBe(503);
  });

  test('Proof A: handles different environments (prod, stage, dev)', async () => {
    process.env.DATABASE_ENABLED = 'true';

    const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
    getLatestDeployStatusSnapshot.mockImplementation(async (_pool: any, env: string) => ({
      success: true,
      snapshot: {
        id: `snapshot-${env}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        env,
        status: 'YELLOW',
        observed_at: new Date().toISOString(),
        reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        related_deploy_event_id: null,
        staleness_seconds: 0,
      },
    }));

    for (const env of ['prod', 'stage', 'dev']) {
      const request = new NextRequest(`http://localhost/api/deploy/status?env=${env}`, { method: 'GET' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.env).toBe(env);
      expect(body.snapshot_id).toBe(`snapshot-${env}`);
    }
  });

  test('Proof B: TTL cache hit does not call resolver', async () => {
    process.env.DATABASE_ENABLED = 'true';

    const { getLatestDeployStatusSnapshot } = require('../../src/lib/db/deployStatusSnapshots');
    getLatestDeployStatusSnapshot.mockResolvedValue({
      success: true,
      snapshot: {
        id: 'cached-snapshot',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 5000).toISOString(),
        reasons: [{ code: 'VERIFICATION_SUCCESS', severity: 'info', message: 'ok' }],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        related_deploy_event_id: null,
        staleness_seconds: 0,
      },
    });

    const request = new NextRequest('http://localhost/api/deploy/status?env=prod', { method: 'GET' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot_id).toBe('cached-snapshot');
    expect(resolveDeployStatusFromVerificationRuns).not.toHaveBeenCalled();
  });

  test('Proof B: force refresh bypasses cache and persists snapshot', async () => {
    process.env.DATABASE_ENABLED = 'true';

    const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
      require('../../src/lib/db/deployStatusSnapshots');

    getLatestDeployStatusSnapshot.mockResolvedValue({
      success: true,
      snapshot: {
        id: 'cached-snapshot',
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 5000).toISOString(),
        reasons: [],
        signals: { checked_at: new Date().toISOString(), verification_run: null },
        staleness_seconds: 0,
      },
    });

    (resolveDeployStatusFromVerificationRuns as jest.MockedFunction<typeof resolveDeployStatusFromVerificationRuns>).mockResolvedValue({
      env: 'prod',
      status: 'YELLOW',
      observed_at: new Date().toISOString(),
      reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
      signals: { checked_at: new Date().toISOString(), verification_run: null },
      staleness_seconds: 0,
    } as any);

    insertDeployStatusSnapshot.mockResolvedValue({ success: true, snapshot: { id: 'new-snapshot' } });

    const request = new NextRequest('http://localhost/api/deploy/status?env=prod&force=true', { method: 'GET' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot_id).toBe('new-snapshot');
    expect(resolveDeployStatusFromVerificationRuns).toHaveBeenCalled();
    expect(insertDeployStatusSnapshot).toHaveBeenCalled();
  });

  test('Proof C: cached snapshot requires correlationId match', async () => {
    process.env.DATABASE_ENABLED = 'true';

    const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
      require('../../src/lib/db/deployStatusSnapshots');

    getLatestDeployStatusSnapshot.mockResolvedValue({
      success: true,
      snapshot: {
        id: 'cached-snapshot',
        env: 'prod',
        status: 'GREEN',
        observed_at: new Date(Date.now() - 1000).toISOString(),
        reasons: [],
        signals: {
          checked_at: new Date().toISOString(),
          correlation_id: 'corr-1',
          verification_run: { run_id: 'run-1' },
        },
        staleness_seconds: 0,
      },
    });

    (resolveDeployStatusFromVerificationRuns as jest.MockedFunction<typeof resolveDeployStatusFromVerificationRuns>).mockResolvedValue({
      env: 'prod',
      status: 'YELLOW',
      observed_at: new Date().toISOString(),
      reasons: [{ code: 'NO_VERIFICATION_RUN', severity: 'warning', message: 'No run' }],
      signals: { checked_at: new Date().toISOString(), correlation_id: 'corr-X', verification_run: null },
      staleness_seconds: 0,
    } as any);

    insertDeployStatusSnapshot.mockResolvedValue({ success: true, snapshot: { id: 'new-snapshot' } });

    const mismatchReq = new NextRequest('http://localhost/api/deploy/status?env=prod&correlationId=corr-X', { method: 'GET' });
    const mismatchRes = await GET(mismatchReq);
    expect(mismatchRes.status).toBe(200);
    expect(resolveDeployStatusFromVerificationRuns).toHaveBeenCalled();

    (resolveDeployStatusFromVerificationRuns as jest.MockedFunction<typeof resolveDeployStatusFromVerificationRuns>).mockClear();

    const matchReq = new NextRequest('http://localhost/api/deploy/status?env=prod&correlationId=corr-1', { method: 'GET' });
    const matchRes = await GET(matchReq);
    const matchBody = await matchRes.json();

    expect(matchRes.status).toBe(200);
    expect(matchBody.snapshot_id).toBe('cached-snapshot');
    expect(resolveDeployStatusFromVerificationRuns).not.toHaveBeenCalled();
  });

  test('Proof D: idempotent persistence returns latest snapshot without inserting', async () => {
    process.env.DATABASE_ENABLED = 'true';

    const { getLatestDeployStatusSnapshot, insertDeployStatusSnapshot } =
      require('../../src/lib/db/deployStatusSnapshots');

    const previousSnapshot = {
      id: 'prev-snapshot',
      env: 'prod',
      status: 'GREEN',
      observed_at: new Date(Date.now() - 60000).toISOString(),
      reasons: [{ code: 'VERIFICATION_SUCCESS', severity: 'info', message: 'ok' }],
      signals: {
        checked_at: new Date().toISOString(),
        correlation_id: 'corr-1',
        verification_run: { run_id: 'run-1' },
      },
      staleness_seconds: 60,
    };

    getLatestDeployStatusSnapshot
      .mockResolvedValueOnce({ success: true, snapshot: previousSnapshot })
      .mockResolvedValueOnce({ success: true, snapshot: previousSnapshot });

    (resolveDeployStatusFromVerificationRuns as jest.MockedFunction<typeof resolveDeployStatusFromVerificationRuns>).mockResolvedValue({
      env: 'prod',
      status: 'GREEN',
      observed_at: new Date().toISOString(),
      reasons: [{ code: 'VERIFICATION_SUCCESS', severity: 'info', message: 'ok' }],
      signals: {
        checked_at: new Date().toISOString(),
        correlation_id: 'corr-1',
        verification_run: { run_id: 'run-1' },
      },
      staleness_seconds: 0,
    } as any);

    const request = new NextRequest('http://localhost/api/deploy/status?env=prod', { method: 'GET' });
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.snapshot_id).toBe('prev-snapshot');
    expect(insertDeployStatusSnapshot).not.toHaveBeenCalled();
  });
});
