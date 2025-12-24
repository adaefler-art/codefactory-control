/**
 * GET /api/issues/new
 *
 * Ensures the New Issue draft endpoint always returns 200 and a DraftIssue shape.
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getDraftIssue, PATCH as createIssueFromNew } from '../../app/api/issues/new/route';

// Mock the database module used by PATCH /api/issues/new
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  createAfu9Issue: jest.fn(),
}));

describe('GET /api/issues/new', () => {
  test('returns 200 and a DraftIssue JSON payload', async () => {
    const request = new NextRequest('http://localhost/api/issues/new', {
      headers: {
        'x-request-id': 'test-req-issues-new-1',
        // These headers are normally injected by middleware after auth.
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
    });

    const response = await getDraftIssue(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-issues-new-1');

    expect(body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: '',
        description: '',
        status: 'CREATED',
        labels: [],
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );

    // UUID-ish check (v4 or v7 etc) - keep loose.
    expect(body.id).toMatch(/^[0-9a-fA-F-]{36}$/);

    // ISO timestamps parse cleanly
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
  });
});

describe('PATCH /api/issues/new', () => {
  test('returns 201 and an Issue JSON payload with parseable timestamps', async () => {
    const { createAfu9Issue } = require('../../src/lib/db/afu9Issues');

    createAfu9Issue.mockResolvedValue({
      success: true,
      data: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Created from New',
        body: 'Draft description',
        status: 'CREATED',
        labels: ['bug'],
        priority: 'P1',
        assignee: null,
        source: 'afu9',
        handoff_state: 'NOT_SENT',
        github_issue_number: null,
        github_url: null,
        last_error: null,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
      },
    });

    const request = new NextRequest('http://localhost/api/issues/new', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-issues-new-patch-1',
        // Normally injected by middleware after auth.
        'x-afu9-sub': 'user-123',
        'x-afu9-stage': 'staging',
        'x-afu9-groups': 'afu9-engineer-stage',
      },
      body: JSON.stringify({
        title: 'Created from New',
        description: 'Draft description',
        labels: ['bug'],
        priority: 'P1',
        status: 'CREATED',
      }),
    });

    const response = await createIssueFromNew(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('test-req-issues-new-patch-1');

    expect(body).toEqual(
      expect.objectContaining({
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'Created from New',
        description: 'Draft description',
        status: 'CREATED',
        labels: ['bug'],
        priority: 'P1',
        handoffState: 'NOT_SENT',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      })
    );

    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);
  });
});
