/**
 * Tests for GET /api/afu9/s1s9/issues/[id] alias
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue } from '../../app/api/afu9/s1s9/issues/[id]/route';
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
});
