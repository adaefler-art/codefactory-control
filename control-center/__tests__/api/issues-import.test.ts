/**
 * POST /api/issues/import
 *
 * Tests the bulk import functionality for issues
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as importIssues } from '../../app/api/issues/import/route';
import { createAfu9Issue } from '../../src/lib/db/afu9Issues';
import { getPool } from '../../src/lib/db';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  createAfu9Issue: jest.fn(),
}));

describe('POST /api/issues/import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('imports single issue successfully', async () => {
    const mockCreateResult = {
      success: true,
      data: {
        id: 'test-uuid-1',
        title: 'Test Issue',
        body: 'This is a test issue',
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
      },
    };

    (createAfu9Issue as jest.Mock).mockResolvedValue(mockCreateResult);

    const requestBody = {
      content: 'Test Issue\nThis is a test issue',
    };

    const request = new NextRequest('http://localhost/api/issues/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'test-req-import-1',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify(requestBody),
    });

    const response = await importIssues(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.imported).toBe(1);
    expect(body.total).toBe(1);
    expect(body.issues).toHaveLength(1);
    expect(createAfu9Issue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Test Issue',
        body: 'This is a test issue',
        labels: [],
        status: 'CREATED',
      })
    );
  });

  test('imports multiple issues separated by ---', async () => {
    const mockCreateResult = (title: string) => ({
      success: true,
      data: {
        id: `test-uuid-${title}`,
        title,
        body: `Body for ${title}`,
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
      },
    });

    (createAfu9Issue as jest.Mock)
      .mockResolvedValueOnce(mockCreateResult('Issue 1'))
      .mockResolvedValueOnce(mockCreateResult('Issue 2'));

    const requestBody = {
      content: 'Issue 1\nBody for Issue 1\n---\nIssue 2\nBody for Issue 2',
    };

    const request = new NextRequest('http://localhost/api/issues/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'test-req-import-2',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify(requestBody),
    });

    const response = await importIssues(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.imported).toBe(2);
    expect(body.total).toBe(2);
    expect(body.issues).toHaveLength(2);
    expect(createAfu9Issue).toHaveBeenCalledTimes(2);
  });

  test('parses labels and status from meta-lines', async () => {
    const mockCreateResult = {
      success: true,
      data: {
        id: 'test-uuid-meta',
        title: 'Issue with metadata',
        body: 'This has metadata',
        status: 'SPEC_READY',
        labels: ['bug', 'urgent'],
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
      },
    };

    (createAfu9Issue as jest.Mock).mockResolvedValue(mockCreateResult);

    const requestBody = {
      content: 'Issue with metadata\nLabels: bug, urgent\nStatus: SPEC_READY\nThis has metadata',
    };

    const request = new NextRequest('http://localhost/api/issues/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'test-req-import-3',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify(requestBody),
    });

    const response = await importIssues(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(createAfu9Issue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: 'Issue with metadata',
        body: 'This has metadata',
        labels: ['bug', 'urgent'],
        status: 'SPEC_READY',
      })
    );
  });

  test('returns 400 when content is missing', async () => {
    const request = new NextRequest('http://localhost/api/issues/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'test-req-import-4',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify({}),
    });

    const response = await importIssues(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('content is required');
  });

  test('returns 400 when content is empty', async () => {
    const request = new NextRequest('http://localhost/api/issues/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'test-req-import-5',
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify({ content: '   ' }),
    });

    const response = await importIssues(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('cannot be empty');
  });
});
