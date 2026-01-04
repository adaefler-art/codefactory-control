/**
 * POST /api/ops/issues/sync
 *
 * AFU-9 Issue Status Sync MVP tests
 * Ensures sync endpoint works correctly with mocked GitHub API
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as syncIssues } from '../../app/api/ops/issues/sync/route';

// Mock database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock issue sync database helpers
jest.mock('../../src/lib/db/issueSync', () => ({
  createIssueSyncRun: jest.fn(),
  updateIssueSyncRun: jest.fn(),
  upsertIssueSnapshot: jest.fn(),
}));

// Mock GitHub client
jest.mock('../../src/lib/github', () => ({
  searchIssues: jest.fn(),
}));

// Mock afu9Issues database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
  updateAfu9Issue: jest.fn(),
}));

describe('POST /api/ops/issues/sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('successfully syncs issues from GitHub', async () => {
    const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
      require('../../src/lib/db/issueSync');
    const { searchIssues } = require('../../src/lib/github');

    const mockRunId = 'run-123';
    const mockIssues = [
      {
        number: 1,
        title: 'E64.1: Test Issue',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T12:00:00Z',
        labels: [{ name: 'bug' }],
        assignees: [{ login: 'user1' }],
        node_id: 'node_123',
        body: 'Test body',
      },
      {
        number: 2,
        title: 'I751: Another Issue',
        state: 'closed',
        html_url: 'https://github.com/owner/repo/issues/2',
        created_at: '2025-01-02T00:00:00Z',
        updated_at: '2025-01-02T12:00:00Z',
        labels: [{ name: 'enhancement' }],
        assignees: [],
        node_id: 'node_456',
        body: null,
      },
    ];

    // Mock createIssueSyncRun
    createIssueSyncRun.mockResolvedValue({
      success: true,
      data: mockRunId,
    });

    // Mock searchIssues
    searchIssues.mockResolvedValue({
      issues: mockIssues,
      total_count: 2,
    });

    // Mock upsertIssueSnapshot
    upsertIssueSnapshot.mockResolvedValue({
      success: true,
    });

    // Mock updateIssueSyncRun
    updateIssueSyncRun.mockResolvedValue({
      success: true,
    });

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-sync-1',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify({}),
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-sync-1');

    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        total: 2,
        upserted: 2,
        syncedAt: expect.any(String),
      })
    );

    // Verify sync run was created
    expect(createIssueSyncRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('repo:')
    );

    // Verify issues were fetched
    expect(searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.any(String),
        per_page: 100,
        page: 1,
        sort: 'updated',
        direction: 'desc',
      })
    );

    // Verify snapshots were upserted (2 issues)
    expect(upsertIssueSnapshot).toHaveBeenCalledTimes(2);

    // Verify first issue snapshot
    expect(upsertIssueSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issue_number: 1,
        canonical_id: 'E64.1',
        state: 'open',
        title: 'E64.1: Test Issue',
      })
    );

    // Verify second issue snapshot
    expect(upsertIssueSnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        issue_number: 2,
        canonical_id: 'I751',
        state: 'closed',
        title: 'I751: Another Issue',
      })
    );

    // Verify sync run was updated with success
    expect(updateIssueSyncRun).toHaveBeenCalledWith(expect.anything(), mockRunId, {
      status: 'SUCCESS',
      total_count: 2,
      upserted_count: 2,
    });
  });

  test('handles sync failure gracefully', async () => {
    const { createIssueSyncRun, updateIssueSyncRun } = require('../../src/lib/db/issueSync');
    const { searchIssues } = require('../../src/lib/github');

    const mockRunId = 'run-456';

    createIssueSyncRun.mockResolvedValue({
      success: true,
      data: mockRunId,
    });

    searchIssues.mockRejectedValue(new Error('GitHub API error'));

    updateIssueSyncRun.mockResolvedValue({
      success: true,
    });

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-sync-error',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to sync issues');

    // Verify sync run was updated with failure
    expect(updateIssueSyncRun).toHaveBeenCalledWith(expect.anything(), mockRunId, {
      status: 'FAILED',
      total_count: 0,
      upserted_count: 0,
      error: 'GitHub API error',
    });
  });

  test('idempotency: multiple syncs update snapshots correctly', async () => {
    const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
      require('../../src/lib/db/issueSync');
    const { searchIssues } = require('../../src/lib/github');

    const mockRunId1 = 'run-111';
    const mockRunId2 = 'run-222';
    const mockIssue = {
      number: 1,
      title: 'E64.1: Test Issue',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/1',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T12:00:00Z',
      labels: [{ name: 'bug' }],
      assignees: [],
      node_id: 'node_123',
      body: 'Test body',
    };

    createIssueSyncRun
      .mockResolvedValueOnce({ success: true, data: mockRunId1 })
      .mockResolvedValueOnce({ success: true, data: mockRunId2 });

    searchIssues.mockResolvedValue({
      issues: [mockIssue],
      total_count: 1,
    });

    upsertIssueSnapshot.mockResolvedValue({ success: true });
    updateIssueSyncRun.mockResolvedValue({ success: true });

    // First sync
    const request1 = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-request-id': 'test-sync-1',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
    });

    const response1 = await syncIssues(request1);
    const body1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(body1.ok).toBe(true);
    expect(body1.upserted).toBe(1);

    // Second sync (idempotent)
    const request2 = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-request-id': 'test-sync-2',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
    });

    const response2 = await syncIssues(request2);
    const body2 = await response2.json();

    expect(response2.status).toBe(200);
    expect(body2.ok).toBe(true);
    expect(body2.upserted).toBe(1);

    // Verify both syncs created separate run records
    expect(createIssueSyncRun).toHaveBeenCalledTimes(2);

    // Verify snapshots were upserted both times (idempotent operation)
    expect(upsertIssueSnapshot).toHaveBeenCalledTimes(2);

    // Verify both runs were marked successful
    expect(updateIssueSyncRun).toHaveBeenCalledTimes(2);
  });

  /**
   * I3: GitHub Status Mirror v1 - Test fixtures for State Model v1 sync
   */
  describe('I3: State Model v1 Status Sync', () => {
    // Note: afu9Issues module is already mocked at the top level
    // We just need to configure the mock in each test

    test('syncs IN_PROGRESS status from GitHub label to github_mirror_status', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-in-progress';
      const mockGitHubIssue = {
        number: 458,
        title: 'I775: Test Issue In Progress',
        state: 'open',
        html_url: 'https://github.com/adaefler-art/codefactory-control/issues/458',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T12:00:00Z',
        labels: [{ name: 'status: implementing' }], // IN_PROGRESS signal
        assignees: [],
        node_id: 'node_458',
        body: 'Test body',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-775',
        title: 'I775: Test Issue',
        github_issue_number: 458,
        github_mirror_status: 'UNKNOWN',
        status: 'IMPLEMENTING',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockGitHubIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-sync-in-progress',
          'x-afu9-sub': 'user-123',
          'x-afu9-stage': 'staging',
          'x-afu9-groups': 'afu9-engineer-stage',
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.statusSynced).toBe(1);

      // Verify github_mirror_status was updated to IN_PROGRESS
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-775',
        expect.objectContaining({
          github_mirror_status: 'IN_PROGRESS',
          github_status_raw: 'status: implementing',
          github_issue_last_sync_at: expect.any(String),
        })
      );
    });

    test('syncs DONE status from closed GitHub issue with explicit done label', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-done';
      const mockGitHubIssue = {
        number: 500,
        title: 'I500: Completed Issue',
        state: 'closed',
        html_url: 'https://github.com/adaefler-art/codefactory-control/issues/500',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T12:00:00Z',
        labels: [{ name: 'status: done' }], // Explicit DONE signal
        assignees: [],
        node_id: 'node_500',
        body: 'Completed work',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-500',
        title: 'I500: Completed Issue',
        github_issue_number: 500,
        github_mirror_status: 'IN_PROGRESS',
        status: 'IMPLEMENTING',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockGitHubIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-sync-done',
          'x-afu9-sub': 'user-123',
          'x-afu9-stage': 'staging',
          'x-afu9-groups': 'afu9-engineer-stage',
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.statusSynced).toBe(1);

      // Verify github_mirror_status was updated to DONE
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-500',
        expect.objectContaining({
          github_mirror_status: 'DONE',
          github_status_raw: 'status: done',
          github_issue_last_sync_at: expect.any(String),
        })
      );
    });

    test('closed GitHub issue WITHOUT done signal maps to UNKNOWN (semantic protection)', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-closed-no-done';
      const mockGitHubIssue = {
        number: 600,
        title: 'I600: Closed Issue (no done signal)',
        state: 'closed',
        html_url: 'https://github.com/adaefler-art/codefactory-control/issues/600',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T12:00:00Z',
        labels: [{ name: 'bug' }], // No status label
        assignees: [],
        node_id: 'node_600',
        body: 'Closed without completion',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-600',
        title: 'I600: Closed Issue',
        github_issue_number: 600,
        github_mirror_status: 'IN_PROGRESS',
        status: 'IMPLEMENTING',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockGitHubIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-sync-closed-no-done',
          'x-afu9-sub': 'user-123',
          'x-afu9-stage': 'staging',
          'x-afu9-groups': 'afu9-engineer-stage',
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.statusSynced).toBe(1);

      // Verify github_mirror_status was updated to UNKNOWN (semantic protection)
      // This prevents incorrectly marking cancelled/killed issues as DONE
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-600',
        expect.objectContaining({
          github_mirror_status: 'UNKNOWN',
          github_status_raw: null,
          github_issue_last_sync_at: expect.any(String),
        })
      );
    });
  });
});
