/**
 * Tests for Publish Batches API Endpoint
 * Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
 */

import { GET } from '@/app/api/intent/sessions/[id]/publish-batches/route';
import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { queryPublishBatchesBySession } from '@/lib/db/intentIssueSetPublishLedger';

jest.mock('@/lib/db');
jest.mock('@/lib/db/intentIssueSetPublishLedger');

const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;
const mockQueryPublishBatchesBySession = queryPublishBatchesBySession as jest.MockedFunction<
  typeof queryPublishBatchesBySession
>;

describe('GET /api/intent/sessions/[id]/publish-batches', () => {
  const sessionId = 'session-123';
  const userId = 'user-456';
  const mockPool = {
    query: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPool.mockReturnValue(mockPool as any);
  });

  it('should return 401 if user is not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-123/publish-batches');
    const context = { params: Promise.resolve({ id: sessionId }) };

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('should return 404 if session does not exist', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-123/publish-batches');
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
  });

  it('should return 403 if user does not own the session', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-123/publish-batches');
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: sessionId, user_id: 'different-user' }],
    });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Forbidden');
  });

  it('should return 400 if limit parameter is invalid', async () => {
    const request = new NextRequest(
      'http://localhost/api/intent/sessions/session-123/publish-batches?limit=200'
    );
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: sessionId, user_id: userId }],
    });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid limit parameter');
  });

  it('should return 400 if offset parameter is invalid', async () => {
    const request = new NextRequest(
      'http://localhost/api/intent/sessions/session-123/publish-batches?offset=-5'
    );
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: sessionId, user_id: userId }],
    });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid offset parameter');
  });

  it('should return batches successfully', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-123/publish-batches');
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    const mockBatches = [
      {
        batch_id: 'batch-1',
        status: 'completed',
        created_at: '2024-01-01T00:00:00Z',
        issue_set_id: 'set-1',
        session_id: sessionId,
        request_id: 'req-1',
        lawbook_version: 'v1.0.0',
        total_items: 5,
        created_count: 3,
        updated_count: 2,
        skipped_count: 0,
        failed_count: 0,
        error_message: null,
        owner: 'test-owner',
        repo: 'test-repo',
        result_json: null,
        result_truncated: false,
      },
    ];

    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: sessionId, user_id: userId }],
    });

    mockQueryPublishBatchesBySession.mockResolvedValueOnce({
      success: true,
      data: mockBatches,
    });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.batches).toHaveLength(1);
    expect(data.batches[0].batch_id).toBe('batch-1');
    expect(data.pagination.limit).toBe(50);
    expect(data.pagination.offset).toBe(0);
  });

  it('should respect custom limit and offset parameters', async () => {
    const request = new NextRequest(
      'http://localhost/api/intent/sessions/session-123/publish-batches?limit=10&offset=5'
    );
    request.headers.set('x-afu9-sub', userId);
    const context = { params: Promise.resolve({ id: sessionId }) };

    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: sessionId, user_id: userId }],
    });

    mockQueryPublishBatchesBySession.mockResolvedValueOnce({
      success: true,
      data: [],
    });

    const response = await GET(request, context);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pagination.limit).toBe(10);
    expect(data.pagination.offset).toBe(5);
    expect(mockQueryPublishBatchesBySession).toHaveBeenCalledWith(
      mockPool,
      sessionId,
      { limit: 10, offset: 5 }
    );
  });
});
