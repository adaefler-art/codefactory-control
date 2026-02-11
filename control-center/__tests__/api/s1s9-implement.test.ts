/**
 * S1S9 Implement Wrapper Contract Tests
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as postS1S9Implement } from '../../app/api/afu9/s1s9/issues/[id]/implement/route';
import { POST as postS1S3Implement } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { GET as getS1S9Issue } from '../../app/api/afu9/issues/[id]/route';
import { withAfu9ScopeFallback } from '../../app/api/afu9/s1s9/_shared';

jest.mock('../../app/api/afu9/s1s3/issues/[id]/implement/route', () => ({
  POST: jest.fn(),
}));

jest.mock('../../app/api/afu9/issues/[id]/route', () => ({
  GET: jest.fn(),
}));

jest.mock('../../app/api/afu9/s1s9/_shared', () => ({
  isIssueNotFound: jest.fn(async () => false),
  withAfu9ScopeFallback: jest.fn(),
  buildAfu9ScopeHeaders: jest.fn((params: { requestedScope: string; resolvedScope: string }) => ({
    'x-afu9-scope-requested': params.requestedScope,
    'x-afu9-scope-resolved': params.resolvedScope,
  })),
}));

describe('POST /api/afu9/s1s9/issues/[id]/implement', () => {
  const mockPostS1S3Implement = postS1S3Implement as jest.Mock;
  const mockGetS1S9Issue = getS1S9Issue as jest.Mock;
  const mockWithAfu9ScopeFallback = withAfu9ScopeFallback as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetS1S9Issue.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    mockWithAfu9ScopeFallback.mockImplementation(async (options: { primary: () => Promise<Response> }) => {
      return options.primary();
    });
  });

  test('preserves downstream 409 and adds handler headers', async () => {
    mockPostS1S3Implement.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, code: 'GITHUB_AUTH_MISSING', requestId: 'req-123' }), {
        status: 409,
        headers: {
          'content-type': 'application/json',
          'x-afu9-request-id': 'req-123',
        },
      })
    );

    const request = new NextRequest('http://localhost/api/afu9/s1s9/issues/issue-123/implement', {
      method: 'POST',
      headers: {
        'x-request-id': 'req-123',
      },
    });

    const response = await postS1S9Implement(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_MISSING');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s9-implement');
    expect(response.headers.get('x-afu9-handler')).toBeTruthy();
    expect(response.headers.get('x-afu9-request-id')).toBe('req-123');
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
  });

  test('maps proxy TypeError to 409 with headers', async () => {
    mockWithAfu9ScopeFallback.mockImplementation(async () => {
      throw new TypeError('Cannot create proxy with a non-object as target or handler');
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s9/issues/issue-123/implement', {
      method: 'POST',
      headers: {
        'x-request-id': 'req-456',
      },
    });

    const response = await postS1S9Implement(request, {
      params: Promise.resolve({ id: 'issue-123' }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('IMPLEMENT_PRECONDITION_FAILED');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s9-implement');
    expect(response.headers.get('x-afu9-request-id')).toBe('req-456');
  });
});
