/**
 * Control S1 Spec API Tests
 *
 * Tests for POST /api/control/afu9/s1/issues/[issueId]/spec
 *
 * @jest-environment node
 */

import { POST as specPost } from '../../app/api/control/afu9/s1/issues/[issueId]/spec/route';
import { updateS1S3IssueSpec } from '../../src/lib/db/s1s3Flow';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/s1s3Flow', () => ({
  updateS1S3IssueSpec: jest.fn(),
}));

describe('POST /api/control/afu9/s1/issues/[issueId]/spec', () => {
  const mockUpdateSpec = updateS1S3IssueSpec as jest.Mock;
  const issueId = '6d92bba6-dca3-4d04-b1e0-7667b573604e';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 with SPEC_READY for existing issue', async () => {
    mockUpdateSpec.mockResolvedValue({ success: true, data: { id: issueId } });

    const request = new Request(
      `http://localhost/api/control/afu9/s1/issues/${issueId}/spec`,
      {
        method: 'POST',
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    ) as unknown as Parameters<typeof specPost>[0];

    const context = { params: Promise.resolve({ issueId }) };
    const response = await specPost(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'SPEC_READY',
      issueId,
    });
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
    expect(response.headers.get('x-afu9-auth-path')).toBe('control');
  });

  test('returns 404 with issue_not_found for unknown issue', async () => {
    mockUpdateSpec.mockResolvedValue({ success: false, error: 'Issue not found' });

    const request = new Request(
      `http://localhost/api/control/afu9/s1/issues/${issueId}/spec`,
      {
        method: 'POST',
        body: JSON.stringify({
          scope: 'Test scope',
          acceptanceCriteria: ['AC1'],
        }),
      }
    ) as unknown as Parameters<typeof specPost>[0];

    const context = { params: Promise.resolve({ issueId }) };
    const response = await specPost(request, context);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
    });
    expect(response.headers.get('x-afu9-request-id')).toBeTruthy();
  });
});
