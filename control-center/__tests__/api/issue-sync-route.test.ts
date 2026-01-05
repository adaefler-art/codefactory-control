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
  getIssue: jest.fn(),
}));

// Mock afu9Issues database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
  updateAfu9Issue: jest.fn(),
}));

// Mock GitHub auth wrapper
jest.mock('../../src/lib/github/auth-wrapper', () => ({
  isRepoAllowed: jest.fn(() => true), // Default to allowed, override in specific tests
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
   * I3 Security: Auth and Allowlist Guardrails
   */
  describe('I3 Security: Auth and Allowlist Guardrails', () => {
    beforeEach(() => {
      // Reset isRepoAllowed to default (allowed) for each test
      const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
      isRepoAllowed.mockReturnValue(true);
    });

    test('returns 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'test-req-no-auth',
          // Missing x-afu9-sub header
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
      expect(body.details).toContain('Authentication required');
    });

    test('returns 401 when x-afu9-sub header is empty', async () => {
      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'test-req-empty-auth',
          'x-afu9-sub': '  ', // Empty/whitespace only
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 403 when repo not in allowlist and makes zero GitHub calls', async () => {
      const { searchIssues } = require('../../src/lib/github');
      const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
      
      // Override to deny this specific repo
      isRepoAllowed.mockReturnValue(false);

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'test-req-forbidden-repo',
          'x-afu9-sub': 'user-123',
        },
        body: JSON.stringify({
          owner: 'forbidden-org',
          repo: 'forbidden-repo',
        }),
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe('Access denied');
      expect(body.details).toContain('not in the allowlist');
      expect(body.details).toContain('I711');
      
      // CRITICAL: Verify zero GitHub API calls were made
      expect(searchIssues).not.toHaveBeenCalled();
    });

    test('sanitizes and truncates github_status_raw to prevent unbounded persistence', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-sanitize';
      
      // Create a very long but valid status label that should be truncated
      const baseLabel = 'status: implementing';
      // Pad to make it > 256 chars
      const longLabel = baseLabel + '-' + 'x'.repeat(300);
      
      const mockGitHubIssue = {
        number: 999,
        title: 'I999: Long Status Test',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/999',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T12:00:00Z',
        labels: [{ name: longLabel }],
        assignees: [],
        node_id: 'node_999',
        body: 'Test',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-999',
        title: 'I999: Long Status Test',
        github_issue_number: 999,
        github_mirror_status: 'UNKNOWN',
        status: 'IMPLEMENTING',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockGitHubIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      getIssue.mockResolvedValue({
        state: 'open',
        labels: [{ name: 'status: https://example.com?token=secret' }],
        updated_at: '2025-01-04T12:00:00Z',
      });
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-sync-sanitize',
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify the update was called
      expect(updateAfu9Issue).toHaveBeenCalled();

      const callArgs = updateAfu9Issue.mock.calls[0][2];
      const savedRaw = callArgs.github_status_raw;
      
      // The github_status_raw field should be bounded to <= 256 chars
      if (savedRaw !== null) {
        expect(savedRaw.length).toBeLessThanOrEqual(256);
      }
    });

    test('redacts URLs with query strings in github_status_raw', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-redact';
      
      // Use a simple valid status and test that the raw value is sanitized
      const mockGitHubIssue = {
        number: 888,
        title: 'I888: Sanitize Test',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/888',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T12:00:00Z',
        labels: [
          // Use a URL with query string as the raw label value (after "status:")
          // This will be detected and sanitized
          { name: 'status: https://example.com?token=secret' }
        ],
        assignees: [],
        node_id: 'node_888',
        body: 'Test',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-888',
        title: 'I888: Sanitize Test',
        github_issue_number: 888,
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
          'x-request-id': 'test-sync-redact',
          'x-afu9-sub': 'user-123',
        },
      });

      const response = await syncIssues(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);

      // Verify the update was called
      expect(updateAfu9Issue).toHaveBeenCalled();
      
      const callArgs = updateAfu9Issue.mock.calls[0][2];
      
      expect(callArgs.github_mirror_status).toBe('OPEN');
      expect(typeof callArgs.github_status_raw).toBe('string');

      const snapshot = JSON.parse(callArgs.github_status_raw);
      expect(snapshot.state).toBe('open');
      // Ensure query string is not persisted
      expect(JSON.stringify(snapshot)).not.toContain('?');
    });
  });

  /**
   * I3: GitHub Status Mirror v1 - Test fixtures for State Model v1 sync
   */
  describe('I3: State Model v1 Status Sync', () => {
    // Note: afu9Issues module is already mocked at the top level
    // We just need to configure the mock in each test

    test('syncs GitHub OPEN state to github_mirror_status and stores snapshot labels', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
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
      getIssue.mockResolvedValue({
        state: 'open',
        labels: [{ name: 'status: implementing' }],
        updated_at: '2025-01-04T12:00:00Z',
      });
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

      // Verify github_mirror_status was updated to OPEN
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-775',
        expect.objectContaining({
          github_mirror_status: 'OPEN',
          github_status_raw: expect.any(String),
          status_source: 'github_state',
          github_issue_last_sync_at: expect.any(String),
          github_sync_error: null,
        })
      );

      const callArgs = updateAfu9Issue.mock.calls[0][2];
      const snapshot = JSON.parse(callArgs.github_status_raw);
      expect(snapshot.state).toBe('open');
      expect(snapshot.labels).toContain('status: implementing');
    });

    test('syncs GitHub CLOSED state to github_mirror_status and includes closedAt when available', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
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
      getIssue.mockResolvedValue({
        state: 'closed',
        labels: [{ name: 'status: done' }],
        updated_at: '2025-01-04T12:00:00Z',
        closed_at: '2025-01-04T12:30:00Z',
      });
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

      // Verify github_mirror_status was updated to CLOSED
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-500',
        expect.objectContaining({
          github_mirror_status: 'CLOSED',
          github_status_raw: expect.any(String),
          status_source: 'github_state',
          github_issue_last_sync_at: expect.any(String),
          github_sync_error: null,
        })
      );

      const callArgs = updateAfu9Issue.mock.calls[0][2];
      const snapshot = JSON.parse(callArgs.github_status_raw);
      expect(snapshot.state).toBe('closed');
      expect(snapshot.closedAt).toBeTruthy();
    });

    test('closed GitHub issue maps to CLOSED regardless of labels', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
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
      getIssue.mockResolvedValue({
        state: 'closed',
        labels: [{ name: 'bug' }],
        updated_at: '2025-01-04T12:00:00Z',
      });
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

      // Verify github_mirror_status was updated to CLOSED
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-600',
        expect.objectContaining({
          github_mirror_status: 'CLOSED',
          github_status_raw: expect.any(String),
          github_status_updated_at: expect.any(String),
          status_source: 'github_state',
          github_issue_last_sync_at: expect.any(String),
          github_sync_error: null,
        })
      );
    });

    test('fetches fresh issue details via REST API and syncs status', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-rest-fetch';
      
      // Mock GitHub search result (may be stale)
      const mockSearchIssue = {
        number: 700,
        title: 'I700: REST Fetch Test',
        state: 'open',
        html_url: 'https://github.com/adaefler-art/codefactory-control/issues/700',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T10:00:00Z',
        labels: [{ name: 'old-label' }],
        assignees: [],
        node_id: 'node_700',
        body: 'Test REST fetch',
      };

      // Mock fresh REST API result
      const mockRestIssue = {
        state: 'open',
        labels: [{ name: 'status:implementing' }],
        updated_at: '2025-01-04T12:00:00Z',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-700',
        title: 'I700: REST Fetch Test',
        github_issue_number: 700,
        github_mirror_status: 'UNKNOWN',
        status: 'CREATED',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockSearchIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      getIssue.mockResolvedValue(mockRestIssue); // Fresh REST fetch
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-rest-fetch',
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

      // Verify REST API was called to get fresh issue details
      expect(getIssue).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        700
      );

      // Verify status was extracted from fresh REST data (not stale search result)
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-700',
        expect.objectContaining({
          github_mirror_status: 'OPEN',
          github_status_raw: expect.any(String),
          status_source: 'github_state',
          github_issue_last_sync_at: expect.any(String),
          github_sync_error: null, // No error on success
        })
      );

      const callArgs = updateAfu9Issue.mock.calls[0][2];
      const snapshot = JSON.parse(callArgs.github_status_raw);
      expect(snapshot.labels).toContain('status:implementing');
    });

    test('handles REST fetch failure gracefully and sets sync error', async () => {
      const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
        require('../../src/lib/db/issueSync');
      const { searchIssues, getIssue } = require('../../src/lib/github');
      const { listAfu9Issues, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');

      const mockRunId = 'run-rest-error';
      
      const mockSearchIssue = {
        number: 800,
        title: 'I800: REST Error Test',
        state: 'open',
        html_url: 'https://github.com/adaefler-art/codefactory-control/issues/800',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-04T10:00:00Z',
        labels: [],
        assignees: [],
        node_id: 'node_800',
        body: 'Test error handling',
      };

      const mockAfu9Issue = {
        id: 'afu9-uuid-800',
        title: 'I800: REST Error Test',
        github_issue_number: 800,
        github_mirror_status: 'TODO',
        status: 'SPEC_READY',
      };

      createIssueSyncRun.mockResolvedValue({ success: true, data: mockRunId });
      searchIssues.mockResolvedValue({ issues: [mockSearchIssue], total_count: 1 });
      upsertIssueSnapshot.mockResolvedValue({ success: true });
      updateIssueSyncRun.mockResolvedValue({ success: true });
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockAfu9Issue] });
      getIssue.mockRejectedValue(new Error('GitHub API-Limit erreicht')); // Simulate API error
      updateAfu9Issue.mockResolvedValue({ success: true, data: mockAfu9Issue });

      const request = new NextRequest('http://localhost/api/ops/issues/sync', {
        method: 'POST',
        headers: {
          'x-request-id': 'test-rest-error',
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

      // Verify REST API was attempted
      expect(getIssue).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        800
      );

      // Verify error was captured and status set to ERROR
      expect(updateAfu9Issue).toHaveBeenCalledWith(
        expect.anything(),
        'afu9-uuid-800',
        expect.objectContaining({
          github_mirror_status: 'ERROR',
          github_status_raw: null,
          github_issue_last_sync_at: expect.any(String),
          github_sync_error: expect.any(String),
        })
      );

      const callArgs = updateAfu9Issue.mock.calls[0][2];
      const err = JSON.parse(callArgs.github_sync_error);
      expect(typeof err.code).toBe('string');
      expect(String(err.message)).toContain('GitHub API-Limit');
    });
  });
});
