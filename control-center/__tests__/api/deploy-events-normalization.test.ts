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

describe('GET /api/deploy-events normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('normalizes created_at Date before output contract validation', async () => {
    const { GET } = await import('../../app/api/deploy-events/route');
    process.env.DATABASE_ENABLED = 'true';
    process.env.DATABASE_PASSWORD = 'test';

    const { getPool } = await import('@/lib/db');
    const pool = getPool() as any;

    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'e1',
          created_at: new Date('2025-12-23T15:01:34.136Z'),
          env: 'staging',
          service: 'control-center',
          version: '0.5.0',
          commit_hash: 'deadbeef',
          status: 'success',
          message: 'ok',
        },
      ],
      rowCount: 1,
    });

    const request = new NextRequest('http://localhost/api/deploy-events?env=staging&service=control-center', {
      headers: {
        host: 'stage.afu-9.com',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].created_at).toBe('2025-12-23T15:01:34.136Z');
  });
});
