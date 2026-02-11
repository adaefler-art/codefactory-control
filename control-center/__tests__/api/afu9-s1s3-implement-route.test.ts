/**
 * S3 Implement Route Contract Tests
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as implementIssue } from '../../app/api/afu9/s1s3/issues/[id]/implement/route';
import { S1S3IssueStatus } from '../../src/lib/contracts/s1s3Flow';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';

const mockGetS1S3IssueById = jest.fn();
const mockCreateS1S3Run = jest.fn();
const mockCreateS1S3RunStep = jest.fn();
const mockUpdateS1S3RunStatus = jest.fn();
const mockUpdateS1S3IssueStatus = jest.fn();

const mockResolveStageMissingConfig = jest.fn();
const mockGetStageRegistryEntry = jest.fn();

jest.mock('@/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('@/lib/db/s1s3Flow', () => ({
  getS1S3IssueById: (...args: unknown[]) => mockGetS1S3IssueById(...args),
  createS1S3Run: (...args: unknown[]) => mockCreateS1S3Run(...args),
  createS1S3RunStep: (...args: unknown[]) => mockCreateS1S3RunStep(...args),
  updateS1S3RunStatus: (...args: unknown[]) => mockUpdateS1S3RunStatus(...args),
  updateS1S3IssueStatus: (...args: unknown[]) => mockUpdateS1S3IssueStatus(...args),
}));

jest.mock('@/lib/stage-registry', () => ({
  getStageRegistryEntry: (...args: unknown[]) => mockGetStageRegistryEntry(...args),
  getStageRegistryError: jest.fn(() => ({
    code: 'STAGE_MISSING',
    message: 'Stage missing',
  })),
  resolveStageMissingConfig: (...args: unknown[]) => mockResolveStageMissingConfig(...args),
}));

jest.mock('@/lib/github/issue-sync', () => ({
  triggerAfu9Implementation: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('POST /api/afu9/s1s3/issues/[id]/implement', () => {
  const mockResolveIssue = resolveIssueIdentifierOr404 as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_STAGE = 'local';
    process.env.AFU9_GITHUB_IMPLEMENT_LABEL = 'implement';
    process.env.AFU9_GITHUB_IMPLEMENT_COMMENT = 'go';

    mockGetStageRegistryEntry.mockReturnValue({
      stageId: 'S3',
      routes: {
        implement: {
          handler: 's1s3-implement',
        },
      },
    });
    mockResolveStageMissingConfig.mockReturnValue([]);

    mockResolveIssue.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: 'issue-123',
      source: 'control',
    });
  });

  test('returns 409 + handler headers when mirror missing', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: null,
        github_issue_number: null,
      },
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_MIRROR_MISSING');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-afu9-commit')).toBeDefined();
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
  });

  test('returns 409 + handler headers when github auth missing', async () => {
    mockResolveStageMissingConfig.mockReturnValue(['AFU9_GITHUB_APP_ID']);

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('GITHUB_AUTH_MISSING');
    expect(Array.isArray(body.missingConfig)).toBe(true);
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
  });

  test('returns 500 + handler headers on unexpected throw', async () => {
    mockGetS1S3IssueById.mockResolvedValue({
      success: true,
      data: {
        id: 'issue-123',
        status: S1S3IssueStatus.SPEC_READY,
        repo_full_name: 'org/repo',
        github_issue_number: 42,
        owner: 'afu9',
        github_issue_url: 'https://github.com/org/repo/issues/42',
      },
    });
    mockCreateS1S3Run.mockImplementation(() => {
      throw new Error('boom');
    });

    const request = new NextRequest('http://localhost/api/afu9/s1s3/issues/issue-123/implement', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const params = Promise.resolve({ id: 'issue-123' });
    const response = await implementIssue(request, { params });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('IMPLEMENT_FAILED');
    expect(response.headers.get('x-afu9-handler')).toBe('s1s3-implement');
    expect(response.headers.get('x-afu9-handler-ver')).toBe('v1');
    expect(response.headers.get('x-cf-handler')).toBe('s1s3-implement');
  });
});
