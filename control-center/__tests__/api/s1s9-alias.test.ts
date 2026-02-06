/**
 * Tests for GET /api/afu9/s1s9/issues/[id] alias
 *
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
import * as s1s3IssueRoute from '../../app/api/afu9/s1s3/issues/[id]/route';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';
import {
  getS1S3IssueById,
  listS1S3RunsByIssue,
  listS1S3RunSteps,
} from '../../src/lib/db/s1s3Flow';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: jest.fn(),
  getS1S3IssueByCanonicalId: jest.fn(),
  listS1S3RunsByIssue: jest.fn(),
  listS1S3RunSteps: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('GET /api/afu9/s1s9/issues/[id] alias', () => {
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;
  const mockGetS1S3IssueById = getS1S3IssueById as jest.Mock;
  const mockListS1S3RunsByIssue = listS1S3RunsByIssue as jest.Mock;
  const mockListS1S3RunSteps = listS1S3RunSteps as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to s1s3 handler and sets route header', async () => {
    const shortId = '234fcabf';
    const uuid = '234fcabf-1234-4abc-9def-1234567890ab';

    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'shortid',
      uuid,
      shortId,
      issue: { id: uuid },
      source: 'control',
    });

    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: uuid,
        repo_full_name: 'octo/repo',
        github_issue_number: 42,
        acceptance_criteria: [],
      },
    });

    mockListS1S3RunsByIssue.mockResolvedValue({ success: true, data: [] });
    mockListS1S3RunSteps.mockResolvedValue({ success: true, data: [] });

    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${shortId}`,
      { headers: new Headers({ 'x-request-id': 'req-1' }) }
    );

    const response = await getIssue(request, {
      params: Promise.resolve({ id: shortId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-afu9-route')).toContain(
      `GET /api/afu9/s1s9/issues/${shortId}`
    );
    expect(mockGetS1S3IssueById).toHaveBeenCalledWith(expect.anything(), uuid);
    expect(mockListS1S3RunsByIssue).toHaveBeenCalledWith(expect.anything(), uuid);
  });

  it('falls back to s1s3 when s1s9 returns issue_not_found', async () => {
    const issueId = 'ISS-404';
    const request = new NextRequest(
      `http://localhost/api/afu9/s1s9/issues/${issueId}`,
      { headers: new Headers({ 'x-request-id': 'req-fallback' }) }
    );

    const handlerSpy = jest.spyOn(s1s3IssueRoute, 'GET');
    handlerSpy
      .mockResolvedValueOnce(
        NextResponse.json(
          {
            errorCode: 'issue_not_found',
            issueId,
            requestId: 'req-fallback',
          },
          {
            status: 404,
            headers: {
              'x-afu9-handler': 'control',
              'x-afu9-auth-path': 'control',
              'x-afu9-request-id': 'req-fallback',
              'x-afu9-route': `GET /api/afu9/s1s9/issues/${issueId}`,
            },
          }
        )
      )
      .mockResolvedValueOnce(
        NextResponse.json(
          {
            issue: { id: issueId },
            runs: [],
            steps: [],
          },
          {
            status: 200,
            headers: {
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
    expect(response.headers.get('x-afu9-scope-resolved')).toBe('s1s3');
    expect(response.headers.get('x-afu9-handler')).toBe('control');
    expect(handlerSpy).toHaveBeenCalledTimes(2);

    handlerSpy.mockRestore();
  });
});
