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

describe('GET /api/workflows normalization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('normalizes timestamptz Dates before output contract validation', async () => {
    const { GET } = await import('../../app/api/workflows/route');
    const { getPool } = await import('@/lib/db');
    const pool = getPool() as any;

    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'w1',
          name: 'ci_failure_handler',
          description: null,
          definition: { steps: [] },
          version: 1,
          enabled: true,
          created_at: new Date('2025-12-18T15:14:27.368Z'),
          updated_at: new Date('2025-12-18T15:14:27.368Z'),
          last_run: null,
        },
      ],
    });

    const request = new NextRequest('http://localhost/api/workflows', {
      headers: {
        'x-request-id': 'test-req-1',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.workflows[0].created_at).toBe('2025-12-18T15:14:27.368Z');
    expect(body.workflows[0].updated_at).toBe('2025-12-18T15:14:27.368Z');
  });
});
