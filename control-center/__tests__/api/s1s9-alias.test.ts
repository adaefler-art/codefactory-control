/**
 * Tests for GET /api/afu9/s1s9/issues/[id] alias
 *
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
import { GET as getS1S9Issue } from '../../app/api/afu9/issues/[id]/route';
import { GET as getS1S3Issue } from '../../app/api/afu9/s1s3/issues/[id]/route';

jest.mock('../../app/api/afu9/issues/[id]/route', () => ({
  GET: jest.fn(),
}));

jest.mock('../../app/api/afu9/s1s3/issues/[id]/route', () => ({
  GET: jest.fn(),
}));

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

    const mockS1S9Issue = getS1S9Issue as jest.Mock;
    mockS1S9Issue.mockResolvedValueOnce(
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
    expect(mockS1S9Issue).toHaveBeenCalledTimes(1);
  });

  it('falls back to s1s3 when s1s9 returns issue_not_found', async () => {
    const issueId = 'ISS-404';
    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-fallback' }) }
    );

    const mockS1S9Issue = getS1S9Issue as jest.Mock;
    mockS1S9Issue.mockResolvedValueOnce(
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

    const mockS1S3Issue = getS1S3Issue as jest.Mock;
    mockS1S3Issue.mockResolvedValueOnce(
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
    expect(mockS1S9Issue).toHaveBeenCalledTimes(1);
    expect(mockS1S3Issue).toHaveBeenCalledTimes(1);
  });

  it('sets error code header when fallback also fails', async () => {
    const issueId = 'ISS-404B';
    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-fallback-err' }) }
    );

    const mockS1S9Issue = getS1S9Issue as jest.Mock;
    mockS1S9Issue.mockResolvedValueOnce(
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

    const mockS1S3Issue = getS1S3Issue as jest.Mock;
    mockS1S3Issue.mockResolvedValueOnce(
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
  });
});
