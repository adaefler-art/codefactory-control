/**
 * Issues single-issue contract test
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue } from '../../app/api/issues/[id]/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueById: jest.fn(),
  updateAfu9Issue: jest.fn(),
}));

describe('GET /api/issues/[id] contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns a single Issue object with `id`', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');

    const mockIssue = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Issue',
      body: null,
      status: 'CREATED',
      labels: [],
      priority: null,
      assignee: null,
      source: 'afu9',
      handoff_state: 'NOT_SENT',
      github_issue_number: null,
      github_url: null,
      last_error: null,
      created_at: '2023-12-23T00:00:00Z',
      updated_at: '2023-12-23T00:00:00Z',
    };

    getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

    const req = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000');
    const res = await getIssue(req, {
      params: { id: mockIssue.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Single issue object (not wrapped)
    expect(body).toHaveProperty('id', mockIssue.id);
    expect(body).toHaveProperty('title', 'Test Issue');
    expect(body).not.toHaveProperty('issue');
  });

  test('normalizes legacy `issue_id` to `id`', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');

    getAfu9IssueById.mockResolvedValue({
      success: true,
      data: {
        issue_id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Legacy Issue',
        body: null,
        status: 'CREATED',
        labels: [],
        priority: null,
        assignee: null,
        source: 'afu9',
        handoff_state: 'NOT_SENT',
        github_issue_number: null,
        github_url: null,
        last_error: null,
        created_at: '2023-12-23T00:00:00Z',
        updated_at: '2023-12-23T00:00:00Z',
      },
    });

    const req = new NextRequest('http://localhost/api/issues/123e4567-e89b-12d3-a456-426614174000');
    const res = await getIssue(req, {
      params: { id: '123e4567-e89b-12d3-a456-426614174000' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('id', '123e4567-e89b-12d3-a456-426614174000');
    expect(body).not.toHaveProperty('issue_id');
  });
});
