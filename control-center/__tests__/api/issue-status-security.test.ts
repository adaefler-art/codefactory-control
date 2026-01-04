/**
 * GET /api/issues/status - Security & Pagination Tests
 *
 * Tests for:
 * - 401 without x-afu9-sub
 * - Cursor-based pagination with hasMore/nextCursor
 * - Limit bounding (max 200)
 * - Deterministic sorting
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssueStatus } from '../../app/api/issues/status/route';

// Mock database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock issue sync database helpers
jest.mock('../../src/lib/db/issueSync', () => ({
  listIssueSnapshotsWithCursor: jest.fn(),
  getSyncStaleness: jest.fn(),
  getRecentSyncRuns: jest.fn(),
}));

describe('GET /api/issues/status - Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('401: Unauthorized without x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/issues/status', {
      headers: {
        'x-request-id': 'test-no-auth',
      },
    });

    const response = await getIssueStatus(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.details).toContain('Authentication required');
  });

  test('401: Unauthorized with empty x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/issues/status', {
      headers: {
        'x-request-id': 'test-empty-auth',
        'x-afu9-sub': '',
      },
    });

    const response = await getIssueStatus(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  test('Limit bounding: requested 500 => clamped to 200', async () => {
    const { listIssueSnapshotsWithCursor, getSyncStaleness, getRecentSyncRuns } =
      require('../../src/lib/db/issueSync');

    listIssueSnapshotsWithCursor.mockResolvedValue({
      success: true,
      data: { snapshots: [] },
    });

    getSyncStaleness.mockResolvedValue({
      success: true,
      data: {
        last_synced_at: null,
        staleness_hours: null,
        total_snapshots: 0,
      },
    });

    getRecentSyncRuns.mockResolvedValue({
      success: true,
      data: [],
    });

    const request = new NextRequest('http://localhost/api/issues/status?limit=500', {
      headers: {
        'x-request-id': 'test-limit-bound',
        'x-afu9-sub': 'user-123',
      },
    });

    await getIssueStatus(request);

    // Verify that limit was clamped to 200 (+ 1 for hasMore check = 201)
    expect(listIssueSnapshotsWithCursor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        limit: 201, // 200 + 1
      })
    );
  });

  test('Cursor pagination: hasMore=true and nextCursor returned', async () => {
    const { listIssueSnapshotsWithCursor, getSyncStaleness, getRecentSyncRuns } =
      require('../../src/lib/db/issueSync');

    // Return 51 snapshots (limit is 50, so hasMore should be true)
    const mockSnapshots = Array.from({ length: 51 }, (_, i) => ({
      repo_owner: 'owner',
      repo_name: 'repo',
      issue_number: i + 1,
      canonical_id: null,
      state: 'open',
      title: `Issue ${i + 1}`,
      labels: [],
      assignees: [],
      updated_at: new Date(`2025-01-${String(Math.min(i + 1, 28)).padStart(2, '0')}T00:00:00Z`),
      gh_node_id: `node_${i}`,
      payload_json: {},
      synced_at: new Date('2025-01-01T00:00:00Z'),
      created_at: new Date('2025-01-01T00:00:00Z'),
    }));

    listIssueSnapshotsWithCursor.mockResolvedValue({
      success: true,
      data: { snapshots: mockSnapshots },
    });

    getSyncStaleness.mockResolvedValue({
      success: true,
      data: {
        last_synced_at: new Date('2025-01-01T00:00:00Z'),
        staleness_hours: 1,
        total_snapshots: 51,
      },
    });

    getRecentSyncRuns.mockResolvedValue({
      success: true,
      data: [],
    });

    const request = new NextRequest('http://localhost/api/issues/status?limit=50', {
      headers: {
        'x-request-id': 'test-cursor',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await getIssueStatus(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBeDefined();
    expect(body.items).toHaveLength(50); // Should only return 50, not 51
    
    // nextCursor should be in format "timestamp:id"
    expect(body.nextCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*:\d+$/);
  });

  test('Cursor pagination: hasMore=false when no more results', async () => {
    const { listIssueSnapshotsWithCursor, getSyncStaleness, getRecentSyncRuns } =
      require('../../src/lib/db/issueSync');

    // Return only 10 snapshots (less than limit of 50)
    const mockSnapshots = Array.from({ length: 10 }, (_, i) => ({
      repo_owner: 'owner',
      repo_name: 'repo',
      issue_number: i + 1,
      canonical_id: null,
      state: 'open',
      title: `Issue ${i + 1}`,
      labels: [],
      assignees: [],
      updated_at: new Date('2025-01-01T00:00:00Z'),
      gh_node_id: `node_${i}`,
      payload_json: {},
      synced_at: new Date('2025-01-01T00:00:00Z'),
      created_at: new Date('2025-01-01T00:00:00Z'),
    }));

    listIssueSnapshotsWithCursor.mockResolvedValue({
      success: true,
      data: { snapshots: mockSnapshots },
    });

    getSyncStaleness.mockResolvedValue({
      success: true,
      data: {
        last_synced_at: new Date('2025-01-01T00:00:00Z'),
        staleness_hours: 1,
        total_snapshots: 10,
      },
    });

    getRecentSyncRuns.mockResolvedValue({
      success: true,
      data: [],
    });

    const request = new NextRequest('http://localhost/api/issues/status?limit=50', {
      headers: {
        'x-request-id': 'test-no-more',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await getIssueStatus(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeUndefined();
    expect(body.items).toHaveLength(10);
  });

  test('Deterministic sorting: verifies cursor-based query is called', async () => {
    const { listIssueSnapshotsWithCursor, getSyncStaleness, getRecentSyncRuns } =
      require('../../src/lib/db/issueSync');

    listIssueSnapshotsWithCursor.mockResolvedValue({
      success: true,
      data: { snapshots: [] },
    });

    getSyncStaleness.mockResolvedValue({
      success: true,
      data: {
        last_synced_at: null,
        staleness_hours: null,
        total_snapshots: 0,
      },
    });

    getRecentSyncRuns.mockResolvedValue({
      success: true,
      data: [],
    });

    const cursor = '2025-01-01T12:00:00.000Z:123';
    const request = new NextRequest(`http://localhost/api/issues/status?before=${cursor}&limit=50`, {
      headers: {
        'x-request-id': 'test-deterministic',
        'x-afu9-sub': 'user-123',
      },
    });

    await getIssueStatus(request);

    // Verify cursor was passed to DB function
    expect(listIssueSnapshotsWithCursor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        before: cursor,
        limit: 51, // 50 + 1 for hasMore check
      })
    );
  });

  test('400: Invalid state parameter', async () => {
    const request = new NextRequest('http://localhost/api/issues/status?state=invalid', {
      headers: {
        'x-request-id': 'test-invalid-state',
        'x-afu9-sub': 'user-123',
      },
    });

    const response = await getIssueStatus(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid state parameter');
    expect(body.details).toContain('must be "open" or "closed"');
  });
});
