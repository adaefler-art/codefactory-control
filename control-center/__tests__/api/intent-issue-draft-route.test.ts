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

  test('returns 200 with success:true, draft:null, reason:NO_DRAFT for empty state (not 404)', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-123',
      },
    });

    const res = await GET(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.draft).toBeNull();
    expect(body.reason).toBe('NO_DRAFT');
    // requestId should be in headers (checked via x-request-id header in real usage)
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

  test('returns 200 with success:true and draft data when draft exists', async () => {
    const mockDraft = {
      id: 'draft-123',
      session_id: 'session-1',
      created_at: '2026-01-09T10:00:00Z',
      updated_at: '2026-01-09T10:00:00Z',
      issue_json: { canonicalId: 'I123', title: 'Test Issue' },
      issue_hash: 'abc123',
      last_validation_status: 'valid' as const,
      last_validation_at: '2026-01-09T10:00:00Z',
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-789',
      },
    });

    const res = await GET(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.draft).toEqual(mockDraft);
    expect(body.reason).toBeUndefined();
  });
});
