/**
 * Tests for GET /api/intent/sessions/[id]/issue-draft
 *
 * Covers:
 * - Empty state returns a clean NO_DRAFT (non-500)
 * - Missing table maps to MIGRATION_REQUIRED (non-500) and includes requestId
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/intent/sessions/[id]/issue-draft/route';
import * as intentIssueDrafts from '../../src/lib/db/intentIssueDrafts';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/db/intentIssueDrafts');

describe('GET /api/intent/sessions/[id]/issue-draft', () => {
  const mockGetIssueDraft = intentIssueDrafts.getIssueDraft as jest.MockedFunction<typeof intentIssueDrafts.getIssueDraft>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 404 with code NO_DRAFT (empty state), not 500', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-123',
      },
    });

    const res = await GET(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('No draft exists');
    expect(body.code).toBe('NO_DRAFT');
    expect(body.requestId).toBe('req-123');
  });

  test('maps MIGRATION_REQUIRED to 503 with clean code and requestId', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: false, error: 'MIGRATION_REQUIRED' });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-456',
      },
    });

    const res = await GET(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('MIGRATION_REQUIRED');
    expect(body.error).toContain('Database migration required');
    expect(body.requestId).toBe('req-456');
  });
});
