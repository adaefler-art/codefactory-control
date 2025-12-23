/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

const pool = {
  query: jest.fn(),
};

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => pool),
}));

describe('GET /api/executions/[id] normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('normalizes execution timestamptz Dates before output contract validation', async () => {
    const { GET } = await import('../../app/api/executions/[id]/route');
    const { getPool } = await import('@/lib/db');
    const pool = getPool() as any;

    pool.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM workflow_executions')) {
        return Promise.resolve({
          rows: [
            {
              id: 'x1',
              workflow_id: 'w1',
              status: 'completed',
              input: { a: 1 },
              output: { b: 2 },
              context: { c: 3 },
              started_at: new Date('2025-12-23T15:00:00.000Z'),
              completed_at: new Date('2025-12-23T15:00:01.000Z'),
              error: null,
              triggered_by: 'tester',
              github_run_id: null,
              created_at: new Date('2025-12-23T15:00:00.000Z'),
              updated_at: new Date('2025-12-23T15:00:01.000Z'),
              workflow_name: 'wf',
              workflow_description: 'desc',
            },
          ],
        });
      }

      if (sql.includes('FROM workflow_steps')) {
        return Promise.resolve({
          rows: [
            {
              id: 's1',
              execution_id: 'x1',
              step_name: 'step',
              step_index: 0,
              status: 'completed',
              input: null,
              output: null,
              started_at: new Date('2025-12-23T15:00:00.000Z'),
              completed_at: new Date('2025-12-23T15:00:01.000Z'),
              duration_ms: 1000,
              error: null,
              retry_count: 0,
              created_at: new Date('2025-12-23T15:00:00.000Z'),
              updated_at: new Date('2025-12-23T15:00:01.000Z'),
            },
          ],
        });
      }

      return Promise.resolve({ rows: [] });
    });

    const request = new NextRequest('http://localhost/api/executions/x1', {
      headers: {
        'x-request-id': 'test-req-2',
      },
    });

    const response = await GET(request, { params: Promise.resolve({ id: 'x1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.started_at).toBe('2025-12-23T15:00:00.000Z');
    expect(body.created_at).toBe('2025-12-23T15:00:00.000Z');
    expect(body.steps[0].started_at).toBe('2025-12-23T15:00:00.000Z');
  });
});
