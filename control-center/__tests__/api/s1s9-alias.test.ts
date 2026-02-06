/**
 * Tests for GET /api/afu9/s1s9/issues/[id] alias
 *
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
import * as s1s9IssueRoute from '../../app/api/afu9/issues/[id]/route';
import * as s1s3IssueRoute from '../../app/api/afu9/s1s3/issues/[id]/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/unifiedTimelineEvents', () => ({
  recordTimelineEvent: jest.fn().mockResolvedValue({}),
}));

describe('GET /api/afu9/s1s9/issues/[id] alias', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses s1s9 handler when available', async () => {
    const issueId = '234fcabf';

    const handlerSpy = jest.spyOn(s1s9IssueRoute, 'GET');
    handlerSpy.mockResolvedValueOnce(
      NextResponse.json(
        {
          id: issueId,
          status: 'CREATED',
        },
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-afu9-route': `GET /api/afu9/s1s9/issues/${issueId}`,
          },
        }
      )
    );

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-1' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: issueId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s9');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s9');
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    handlerSpy.mockRestore();
  });

  it('falls back to s1s3 when s1s9 returns issue_not_found', async () => {
    const issueId = 'ISS-404';
    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-fallback' }) }
    );

    const s1s9Spy = jest.spyOn(s1s9IssueRoute, 'GET');
    s1s9Spy.mockResolvedValueOnce(
      NextResponse.json(
        {
          errorCode: 'issue_not_found',
          issueId,
          requestId: 'req-fallback',
        },
        {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-afu9-handler': 'control',
            'x-afu9-auth-path': 'control',
            'x-afu9-request-id': 'req-fallback',
            'x-afu9-route': `GET /api/afu9/s1s9/issues/${issueId}`,
          },
        }
      )
    );

    const s1s3Spy = jest.spyOn(s1s3IssueRoute, 'GET');
    s1s3Spy.mockResolvedValueOnce(
      NextResponse.json(
        {
          issue: { id: issueId },
          runs: [],
          steps: [],
        },
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-afu9-handler': 'control',
            'x-afu9-auth-path': 'control',
            'x-afu9-request-id': 'req-fallback',
            'x-afu9-route': `GET /api/afu9/s1s3/issues/${issueId}`,
          },
        }
      )
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: issueId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s9');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s3');
    expect(response.headers.get('x-afu9-handler')).toBe('control');
    expect(s1s9Spy).toHaveBeenCalledTimes(1);
    expect(s1s3Spy).toHaveBeenCalledTimes(1);

    s1s9Spy.mockRestore();
    s1s3Spy.mockRestore();
  });

  it('sets error code header when fallback also fails', async () => {
    const issueId = 'ISS-404B';
    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-fallback-err' }) }
    );

    const s1s9Spy = jest.spyOn(s1s9IssueRoute, 'GET');
    s1s9Spy.mockResolvedValueOnce(
      NextResponse.json(
        {
          errorCode: 'issue_not_found',
          issueId,
          requestId: 'req-fallback-err',
        },
        {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-afu9-route': `GET /api/afu9/s1s9/issues/${issueId}`,
          },
        }
      )
    );

    const s1s3Spy = jest.spyOn(s1s3IssueRoute, 'GET');
    s1s3Spy.mockResolvedValueOnce(
      NextResponse.json(
        {
          errorCode: 'issue_not_found',
          issueId,
          requestId: 'req-fallback-err',
        },
        {
          status: 404,
          headers: {
            'content-type': 'application/json',
            'x-afu9-route': `GET /api/afu9/s1s3/issues/${issueId}`,
          },
        }
      )
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: issueId }),
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('x-afu9-scope-requested')).toBe('s1s9');
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s3');
    expect(response.headers.get('x-afu9-error-code')).toBe('issue_not_found');

    s1s9Spy.mockRestore();
    s1s3Spy.mockRestore();
  });
});
