/**
 * Tests for /api/issues/active-check endpoint
 * 
 * Issue #I5-2.1: Enforce Single Active Issue
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as activeCheckApi } from '../../app/api/issues/active-check/route';
import { Afu9IssueStatus, Afu9HandoffState, Afu9IssuePriority } from '../../src/lib/contracts/afu9Issue';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

// Mock database helpers
jest.mock('../../src/lib/db/afu9Issues', () => ({
  getActiveIssue: jest.fn(),
}));

describe('GET /api/issues/active-check', () => {
  const mockActiveIssue = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Active Issue',
    body: 'Test body',
    status: Afu9IssueStatus.ACTIVE,
    labels: ['bug'],
    priority: Afu9IssuePriority.P1,
    assignee: 'test-user',
    source: 'afu9',
    handoff_state: Afu9HandoffState.NOT_SENT,
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: '2023-12-23T00:00:00Z',
    updated_at: '2023-12-23T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns hasActive: true when an active issue exists', async () => {
    const { getActiveIssue } = require('../../src/lib/db/afu9Issues');
    getActiveIssue.mockResolvedValue({
      success: true,
      data: mockActiveIssue,
    });

    const request = new NextRequest('http://localhost/api/issues/active-check');
    const response = await activeCheckApi(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasActive).toBe(true);
    expect(body.activeIssue).toBeDefined();
    expect(body.activeIssue.id).toBe(mockActiveIssue.id);
    expect(body.activeIssue.publicId).toBe('123e4567');
    expect(body.activeIssue.title).toBe('Active Issue');
  });

  test('returns hasActive: false when no active issue exists', async () => {
    const { getActiveIssue } = require('../../src/lib/db/afu9Issues');
    getActiveIssue.mockResolvedValue({
      success: true,
      data: null,
    });

    const request = new NextRequest('http://localhost/api/issues/active-check');
    const response = await activeCheckApi(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasActive).toBe(false);
    expect(body.activeIssue).toBeNull();
  });

  test('returns 500 on database error', async () => {
    const { getActiveIssue } = require('../../src/lib/db/afu9Issues');
    getActiveIssue.mockResolvedValue({
      success: false,
      error: 'Database connection failed',
    });

    const request = new NextRequest('http://localhost/api/issues/active-check');
    const response = await activeCheckApi(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to check active issue');
    expect(body.details).toBe('Database connection failed');
  });

  test('handles unexpected errors gracefully', async () => {
    const { getActiveIssue } = require('../../src/lib/db/afu9Issues');
    getActiveIssue.mockRejectedValue(new Error('Unexpected error'));

    const request = new NextRequest('http://localhost/api/issues/active-check');
    const response = await activeCheckApi(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to check active issue');
    expect(body.details).toBe('Unexpected error');
  });
});
