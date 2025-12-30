import { insertDeployStatusSnapshot } from '@/lib/db/deployStatusSnapshots';

function createPoolMock() {
  return {
    query: jest.fn(),
  } as any;
}

describe('deployStatusSnapshots idempotency', () => {
  test('updates existing snapshot for same (env, correlationKey, runId)', async () => {
    const pool = createPoolMock();

    // BEGIN
    pool.query.mockResolvedValueOnce({ rows: [] });
    // advisory lock
    pool.query.mockResolvedValueOnce({ rows: [] });
    // SELECT existing id
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'existing-snapshot-id' }] });
    // UPDATE ... RETURNING
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'existing-snapshot-id',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          env: 'prod',
          status: 'GREEN',
          observedAt: '2025-01-01T00:00:00.000Z',
          reasons: [],
          signals: {
            checkedAt: '2025-01-01T00:00:00.000Z',
            correlationId: 'corr-1',
            verificationRun: { runId: 'run-1' },
          },
          relatedDeployEventId: null,
          stalenessSeconds: 0,
        },
      ],
    });
    // COMMIT
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await insertDeployStatusSnapshot(pool, {
      env: 'prod',
      status: 'GREEN',
      observedAt: '2025-01-01T00:00:00.000Z',
      reasons: [],
      signals: {
        checkedAt: '2025-01-01T00:00:00.000Z',
        correlationId: 'corr-1',
        verificationRun: {
          runId: 'run-1',
          playbookId: 'post-deploy-verify',
          playbookVersion: 'v1',
          env: 'prod',
          status: 'success',
          createdAt: '2025-01-01T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        },
      },
      stalenessSeconds: 0,
    });

    expect(result.success).toBe(true);
    expect(result.snapshot?.id).toBe('existing-snapshot-id');

    const calls = pool.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(calls[0]).toBe('BEGIN');
    expect(calls.some((sql: string) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(calls.some((sql: string) => sql.trimStart().startsWith('UPDATE deploy_status_snapshots'))).toBe(
      true
    );
    expect(calls.some((sql: string) => sql.trimStart().startsWith('INSERT INTO deploy_status_snapshots'))).toBe(
      false
    );
  });

  test('inserts when no existing snapshot matches key', async () => {
    const pool = createPoolMock();

    // BEGIN
    pool.query.mockResolvedValueOnce({ rows: [] });
    // advisory lock
    pool.query.mockResolvedValueOnce({ rows: [] });
    // SELECT existing id: none
    pool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT ... RETURNING
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'new-snapshot-id',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          env: 'prod',
          status: 'YELLOW',
          observedAt: '2025-01-01T00:00:00.000Z',
          reasons: [],
          signals: {
            checkedAt: '2025-01-01T00:00:00.000Z',
            correlationId: 'corr-2',
            verificationRun: { runId: 'run-2' },
          },
          relatedDeployEventId: null,
          stalenessSeconds: 0,
        },
      ],
    });
    // COMMIT
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await insertDeployStatusSnapshot(pool, {
      env: 'prod',
      status: 'YELLOW',
      observedAt: '2025-01-01T00:00:00.000Z',
      reasons: [],
      signals: {
        checkedAt: '2025-01-01T00:00:00.000Z',
        correlationId: 'corr-2',
        verificationRun: {
          runId: 'run-2',
          playbookId: 'post-deploy-verify',
          playbookVersion: 'v1',
          env: 'prod',
          status: 'running',
          createdAt: '2025-01-01T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        },
      },
      stalenessSeconds: 0,
    });

    expect(result.success).toBe(true);
    expect(result.snapshot?.id).toBe('new-snapshot-id');

    const calls = pool.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((sql: string) => sql.trimStart().startsWith('INSERT INTO deploy_status_snapshots'))).toBe(
      true
    );
  });

  test('treats unique violation as success by returning existing snapshot', async () => {
    const pool = createPoolMock();

    // BEGIN
    pool.query.mockResolvedValueOnce({ rows: [] });
    // advisory lock
    pool.query.mockResolvedValueOnce({ rows: [] });
    // SELECT existing id: none
    pool.query.mockResolvedValueOnce({ rows: [] });
    // INSERT throws unique violation
    const uniqueViolation: any = new Error('duplicate key value violates unique constraint');
    uniqueViolation.code = '23505';
    pool.query.mockRejectedValueOnce(uniqueViolation);
    // ROLLBACK
    pool.query.mockResolvedValueOnce({ rows: [] });
    // Fallback SELECT existing snapshot
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'existing-after-violation',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
          env: 'prod',
          status: 'GREEN',
          observedAt: '2025-01-01T00:00:00.000Z',
          reasons: [],
          signals: {
            checkedAt: '2025-01-01T00:00:00.000Z',
            correlationId: 'corr-3',
            verificationRun: { runId: 'run-3' },
          },
          relatedDeployEventId: null,
          stalenessSeconds: 0,
        },
      ],
    });

    const result = await insertDeployStatusSnapshot(pool, {
      env: 'prod',
      status: 'GREEN',
      observedAt: '2025-01-01T00:00:00.000Z',
      reasons: [],
      signals: {
        checkedAt: '2025-01-01T00:00:00.000Z',
        correlationId: 'corr-3',
        verificationRun: {
          runId: 'run-3',
          playbookId: 'post-deploy-verify',
          playbookVersion: 'v1',
          env: 'prod',
          status: 'success',
          createdAt: '2025-01-01T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
        },
      },
      stalenessSeconds: 0,
    });

    expect(result.success).toBe(true);
    expect(result.snapshot?.id).toBe('existing-after-violation');
  });
});
