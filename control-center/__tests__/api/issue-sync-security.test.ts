/**
 * POST /api/ops/issues/sync - Security & Validation Tests
 *
 * Tests for:
 * - 401 without x-afu9-sub
 * - 403 when repo not allowlisted (I711)
 * - Input validation and bounds
 * - Deterministic sorting
 * - Sanitization of persisted JSON
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

// Mock repo allowlist
jest.mock('../../src/lib/github/auth-wrapper', () => ({
  isRepoAllowed: jest.fn(),
}));

describe('POST /api/ops/issues/sync - Security Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('401: Unauthorized without x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-no-auth',
      },
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(body.details).toContain('Authentication required');
  });

  test('401: Unauthorized with empty x-afu9-sub header', async () => {
    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-empty-auth',
        'x-afu9-sub': '   ',
      },
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  test('403: Access denied when repo not in allowlist AND no GitHub calls made', async () => {
    const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
    const { searchIssues } = require('../../src/lib/github');
    const { createIssueSyncRun } = require('../../src/lib/db/issueSync');

    // Mock allowlist to deny access
    isRepoAllowed.mockReturnValue(false);

    // Mock createIssueSyncRun (should not be called, but mock just in case)
    createIssueSyncRun.mockResolvedValue({ success: true, data: 'run-id' });

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-403',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify({
        owner: 'unauthorized-owner',
        repo: 'unauthorized-repo',
      }),
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Access denied');
    expect(body.details).toContain('not in the allowlist');
    expect(body.details).toContain('I711');

    // CRITICAL: Verify NO GitHub API calls were made
    expect(searchIssues).not.toHaveBeenCalled();
  });

  test('400: Invalid request body validation (maxIssues > 200)', async () => {
    const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
    
    isRepoAllowed.mockReturnValue(true);

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-validation',
        'x-afu9-sub': 'user-123',
      },
      body: JSON.stringify({
        maxIssues: 500, // Exceeds MAX_ISSUES (200)
      }),
    });

    const response = await syncIssues(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toContain('maxIssues');
  });

  test('Deterministic: enforces is:issue and -is:pr in query', async () => {
    const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
    const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
      require('../../src/lib/db/issueSync');
    const { searchIssues } = require('../../src/lib/github');

    isRepoAllowed.mockReturnValue(true);
    createIssueSyncRun.mockResolvedValue({ success: true, data: 'run-123' });
    updateIssueSyncRun.mockResolvedValue({ success: true });
    upsertIssueSnapshot.mockResolvedValue({ success: true });

    searchIssues.mockResolvedValue({
      issues: [],
      total_count: 0,
    });

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-request-id': 'test-deterministic',
        'x-afu9-sub': 'user-123',
      },
      body: JSON.stringify({
        query: 'label:bug',
      }),
    });

    await syncIssues(request);

    // Verify searchIssues was called with is:issue and -is:pr
    expect(searchIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('is:issue'),
        sort: 'updated',
        direction: 'desc',
      })
    );

    const actualQuery = searchIssues.mock.calls[0][0].query;
    expect(actualQuery).toContain('is:issue');
    expect(actualQuery).toContain('-is:pr');
  });

  test('Sanitization: persisted JSON has no URLs with query strings', async () => {
    const { isRepoAllowed } = require('../../src/lib/github/auth-wrapper');
    const { createIssueSyncRun, updateIssueSyncRun, upsertIssueSnapshot } =
      require('../../src/lib/db/issueSync');
    const { searchIssues } = require('../../src/lib/github');

    isRepoAllowed.mockReturnValue(true);
    createIssueSyncRun.mockResolvedValue({ success: true, data: 'run-456' });
    updateIssueSyncRun.mockResolvedValue({ success: true });
    upsertIssueSnapshot.mockResolvedValue({ success: true });

    const issueWithSensitiveData = {
      number: 1,
      title: 'Test Issue',
      state: 'open' as const,
      html_url: 'https://github.com/owner/repo/issues/1',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T12:00:00Z',
      labels: [{ name: 'bug' }],
      assignees: [],
      node_id: 'node_123',
      body: 'Test body',
      // Add fields with sensitive data
      api_url: 'https://api.github.com/repos/owner/repo/issues/1?token=REDACTED',
      logs_url: 'https://api.github.com/logs?api_key=REDACTED',
      token: 'REDACTED_TOKEN',
    };

    searchIssues.mockResolvedValue({
      issues: [issueWithSensitiveData],
      total_count: 1,
    });

    const request = new NextRequest('http://localhost/api/ops/issues/sync', {
      method: 'POST',
      headers: {
        'x-request-id': 'test-sanitization',
        'x-afu9-sub': 'user-123',
      },
    });

    await syncIssues(request);

    // Verify upsertIssueSnapshot was called
    expect(upsertIssueSnapshot).toHaveBeenCalled();

    // Get the sanitized payload
    const sanitizedPayload = upsertIssueSnapshot.mock.calls[0][1].payload_json;

    // Check that URLs with query strings are redacted
    expect(JSON.stringify(sanitizedPayload)).not.toContain('?token=');
    expect(JSON.stringify(sanitizedPayload)).not.toContain('?api_key=');

    // Check that token field is redacted
    expect(JSON.stringify(sanitizedPayload)).not.toContain('ghp_secrettoken123');
  });
});
