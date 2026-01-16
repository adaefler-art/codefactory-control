/**
 * Admin Activity Log API Tests (I904)
 * 
 * Tests for admin activity log endpoint:
 * - GET endpoint with various filters
 * - Pagination support
 * - Authentication and authorization
 * - Response schema validation
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/admin/activity/route';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/unifiedTimelineEvents', () => ({
  queryTimelineEvents: jest.fn(),
  countTimelineEvents: jest.fn(),
}));

jest.mock('../../src/lib/timeline/unifiedTimelineEvents', () => ({
  UNIFIED_EVENT_TYPES: [
    'approval_submitted',
    'approval_approved',
    'approval_denied',
    'issue_published',
    'pr_merged',
  ],
}));

import { queryTimelineEvents, countTimelineEvents } from '../../src/lib/db/unifiedTimelineEvents';

const MOCK_EVENTS = [
  {
    id: '123e4567-e89b-12d3-a456-426614174001',
    event_type: 'approval_approved',
    timestamp: '2025-12-30T10:00:00.000Z',
    actor: 'user-123',
    session_id: 'session-abc',
    canonical_id: 'CR-2025-12-30-001',
    gh_issue_number: 101,
    pr_number: null,
    workflow_run_id: null,
    subject_type: 'afu9_issue',
    subject_identifier: 'session:session-abc',
    request_id: 'req-xyz',
    lawbook_hash: 'abc123',
    evidence_hash: 'def456',
    context_pack_id: null,
    links: { afu9SessionUrl: '/intent/session-abc' },
    summary: 'user-123 approved publish for CR-2025-12-30-001',
    details: { action: 'publish' },
    created_at: '2025-12-30T10:00:00.000Z',
  },
  {
    id: '123e4567-e89b-12d3-a456-426614174002',
    event_type: 'issue_published',
    timestamp: '2025-12-30T11:00:00.000Z',
    actor: 'system',
    session_id: 'session-abc',
    canonical_id: 'CR-2025-12-30-001',
    gh_issue_number: 101,
    pr_number: null,
    workflow_run_id: null,
    subject_type: 'gh_issue',
    subject_identifier: 'owner/repo#101',
    request_id: 'req-abc',
    lawbook_hash: null,
    evidence_hash: null,
    context_pack_id: null,
    links: { ghIssueUrl: 'https://github.com/owner/repo/issues/101' },
    summary: 'published issue owner/repo#101 for CR-2025-12-30-001',
    details: {},
    created_at: '2025-12-30T11:00:00.000Z',
  },
];

describe('GET /api/admin/activity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_ADMIN_SUBS = 'admin-user';
    process.env.AFU9_SMOKE_KEY = 'test-smoke-key';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
    delete process.env.AFU9_SMOKE_KEY;
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(data.code).toBe('UNAUTHORIZED');
  });

  test('allows access with valid admin user', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue(MOCK_EVENTS);
    (countTimelineEvents as jest.Mock).mockResolvedValue(2);

    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.events).toHaveLength(2);
    expect(data.pagination).toBeDefined();
  });

  test('allows access with valid smoke key', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue(MOCK_EVENTS);
    (countTimelineEvents as jest.Mock).mockResolvedValue(2);

    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
      headers: {
        'x-afu9-smoke-key': 'test-smoke-key',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  test('filters by sessionId', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([MOCK_EVENTS[0]]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(1);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/activity?sessionId=session-abc',
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.filters.sessionId).toBe('session-abc');
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        session_id: 'session-abc',
      })
    );
  });

  test('filters by issueId', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([MOCK_EVENTS[1]]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(1);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/activity?issueId=101',
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.filters.issueId).toBe(101);
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gh_issue_number: 101,
      })
    );
  });

  test('filters by event type', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([MOCK_EVENTS[0]]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(1);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/activity?types=approval_approved',
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.filters.types).toEqual(['approval_approved']);
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'approval_approved',
      })
    );
  });

  test('supports pagination with cursor', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([MOCK_EVENTS[1]]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(2);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/activity?cursor=1&limit=1',
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pagination.cursor).toBe(1);
    expect(data.pagination.limit).toBe(1);
    expect(data.pagination.total).toBe(2);
    expect(data.pagination.hasMore).toBe(false);
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: 1,
        offset: 1,
      })
    );
  });

  test('validates response schema', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue(MOCK_EVENTS);
    (countTimelineEvents as jest.Mock).mockResolvedValue(2);

    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.schemaVersion).toBe('1.0.0');
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBe(2);
    
    expect(data.pagination).toBeDefined();
    expect(typeof data.pagination.cursor).toBe('number');
    expect(typeof data.pagination.limit).toBe('number');
    expect(typeof data.pagination.total).toBe('number');
    expect(typeof data.pagination.hasMore).toBe('boolean');
    
    expect(data.filters).toBeDefined();

    expect(data.events[0]).toMatchObject({
      id: expect.any(String),
      timestamp: expect.any(String),
      type: expect.any(String),
      actor: expect.any(String),
      correlationId: expect.any(String),
      summary: expect.any(String),
    });
  });

  test('enforces limit bounds (max 200)', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(0);

    const request = new NextRequest(
      'http://localhost:3000/api/admin/activity?limit=500',
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pagination.limit).toBe(200); // Capped at max
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: 200,
      })
    );
  });

  test('handles date range filters', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue(MOCK_EVENTS);
    (countTimelineEvents as jest.Mock).mockResolvedValue(2);

    const startDate = '2025-12-30T00:00:00.000Z';
    const endDate = '2025-12-30T23:59:59.999Z';

    const request = new NextRequest(
      `http://localhost:3000/api/admin/activity?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'admin-user',
        },
      }
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.filters.startDate).toBe(startDate);
    expect(data.filters.endDate).toBe(endDate);
    
    expect(queryTimelineEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        start_time: startDate,
        end_time: endDate,
      })
    );
  });

  test('returns 500 on database error', async () => {
    (queryTimelineEvents as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to load activity log');
    expect(data.code).toBe('QUERY_FAILED');
    expect(data.details).toBe('Database connection failed');
  });

  test('sets proper cache headers', async () => {
    (queryTimelineEvents as jest.Mock).mockResolvedValue([]);
    (countTimelineEvents as jest.Mock).mockResolvedValue(0);

    const request = new NextRequest('http://localhost:3000/api/admin/activity', {
      method: 'GET',
      headers: {
        'x-afu9-sub': 'admin-user',
      },
    });

    const response = await GET(request);

    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(response.headers.get('x-request-id')).toBeDefined();
  });
});
