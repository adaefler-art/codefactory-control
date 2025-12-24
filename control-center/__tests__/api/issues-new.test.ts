/**
 * GET /api/issues/new
 *
 * Ensures the New Issue draft endpoint always returns 200 and a DraftIssue shape.
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getDraftIssue } from '../../app/api/issues/new/route';

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
