/**
 * DELETE /api/issues/[id]
 *
 * Tests the soft delete functionality for issues
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { DELETE as deleteIssue } from '../../app/api/issues/[id]/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  softDeleteAfu9Issue: jest.fn(),
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  const fetchIssueRowByIdentifier = jest.fn();
  const resolveIssueIdentifier = jest.fn(async (id: string, requestId: string) => {
    const result = await fetchIssueRowByIdentifier(id);
    if (result?.ok) {
      return {
        ok: true,
        type: 'uuid',
        uuid: result.row.id,
        issue: result.row,
        source: 'control',
      };
    }
    const status = result?.status ?? 404;
    const errorCode = status === 400
      ? 'invalid_issue_identifier'
      : status === 404
        ? 'issue_not_found'
        : 'issue_lookup_failed';
    return {
      ok: false,
      status,
      body: {
        errorCode,
        issueId: id,
        lookupStore: 'control',
        requestId,
      },
    };
  });
  return {
    ...actual,
    fetchIssueRowByIdentifier,
    resolveIssueIdentifier,
    resolveIssueIdentifierOr404: resolveIssueIdentifier,
    normalizeIssueForApi: jest.fn((row) => row),
  };
});

describe('DELETE /api/issues/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockIssue = {
    id: 'test-uuid-1',
    title: 'Test Issue',
    body: 'Test body',
    status: 'CREATED',
    labels: [],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    activated_at: null,
    execution_state: 'IDLE',
    execution_started_at: null,
    execution_completed_at: null,
    execution_output: null,
    deleted_at: null,
  };

  test('successfully soft deletes issue with CREATED status and NOT_SENT handoff state', async () => {
    const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
    const { softDeleteAfu9Issue } = require('../../src/lib/db/afu9Issues');
    
    fetchIssueRowByIdentifier.mockResolvedValue({
      ok: true,
      row: mockIssue,
    });
    softDeleteAfu9Issue.mockResolvedValue({ success: true });

    const request = new NextRequest('http://localhost/api/issues/test-uuid-1');

    const response = await deleteIssue(
      request,
      { params: Promise.resolve({ id: 'test-uuid-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(softDeleteAfu9Issue).toHaveBeenCalledWith(
      expect.anything(),
      'test-uuid-1'
    );
  });

  test('returns 403 when trying to delete issue not in CREATED/NOT_SENT state', async () => {
    const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
    const { softDeleteAfu9Issue } = require('../../src/lib/db/afu9Issues');
    
    const activeIssue = { ...mockIssue, id: 'test-uuid-2', status: 'ACTIVE', handoff_state: 'SYNCED' };
    fetchIssueRowByIdentifier.mockResolvedValue({
      ok: true,
      row: activeIssue,
    });
    softDeleteAfu9Issue.mockResolvedValue({
      success: false,
      error: 'Cannot delete issue: deletion only allowed for status=CREATED and handoff_state=NOT_SENT. Current status=ACTIVE, handoff_state=SYNCED',
    });

    const request = new NextRequest('http://localhost/api/issues/test-uuid-2');

    const response = await deleteIssue(
      request,
      { params: Promise.resolve({ id: 'test-uuid-2' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('deletion only allowed');
  });

  test('returns 404 when issue does not exist', async () => {
    const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
    
    fetchIssueRowByIdentifier.mockResolvedValue({
      ok: false,
      status: 404,
      body: { error: 'Issue not found: test-uuid-3' },
    });

    const request = new NextRequest('http://localhost/api/issues/test-uuid-3');

    const response = await deleteIssue(
      request,
      { params: Promise.resolve({ id: 'test-uuid-3' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: 'test-uuid-3',
    });
  });
});
