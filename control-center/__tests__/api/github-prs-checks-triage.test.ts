/**
 * Tests for GET /api/github/prs/{prNumber}/checks/triage
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/github/prs/[prNumber]/checks/triage/route';

// Mock dependencies
jest.mock('../../src/lib/github/checks-triage-service', () => ({
  generateChecksTriageReport: jest.fn(),
}));

jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/lib/github/auth-wrapper', () => ({
  RepoAccessDeniedError: class RepoAccessDeniedError extends Error {
    repository: string;
    constructor(repository: string) {
      super(`Repository access denied: ${repository}`);
      this.repository = repository;
    }
  },
}));

describe('GET /api/github/prs/{prNumber}/checks/triage', () => {
  let mockGenerateReport: any;

  beforeEach(() => {
    const { generateChecksTriageReport } = require('../../src/lib/github/checks-triage-service');
    mockGenerateReport = generateChecksTriageReport;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with triage report for valid request', async () => {
    const mockReport = {
      schemaVersion: '1.0',
      requestId: 'test-req-1',
      deploymentEnv: 'staging',
      lawbookHash: 'v1.0.0-dev',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      pr: { number: 123, headSha: 'abc123' },
      summary: {
        overall: 'GREEN',
        failingChecks: 0,
        failingRuns: 0,
      },
      failures: [],
    };

    mockGenerateReport.mockResolvedValue(mockReport);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
        headers: {
          'x-request-id': 'test-req-1',
        },
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockReport);
    expect(mockGenerateReport).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 123,
      maxLogBytes: 65536,
      maxSteps: 50,
      requestId: 'test-req-1',
    });
  });

  it('should return 400 for invalid PR number', async () => {
    const request = new NextRequest(
      'http://localhost/api/github/prs/invalid/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: 'invalid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('INVALID_PR_NUMBER');
  });

  it('should return 400 for missing owner parameter', async () => {
    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('MISSING_PARAMS');
  });

  it('should return 400 for missing repo parameter', async () => {
    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('MISSING_PARAMS');
  });

  it('should accept optional query parameters', async () => {
    const mockReport = {
      schemaVersion: '1.0',
      requestId: 'test-req-2',
      deploymentEnv: 'staging',
      lawbookHash: 'v1.0.0-dev',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      pr: { number: 123, headSha: 'abc123' },
      summary: {
        overall: 'GREEN',
        failingChecks: 0,
        failingRuns: 0,
      },
      failures: [],
    };

    mockGenerateReport.mockResolvedValue(mockReport);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo&workflowRunId=456&maxLogBytes=1024&maxSteps=10',
      {
        method: 'GET',
        headers: {
          'x-request-id': 'test-req-2',
        },
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    expect(mockGenerateReport).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 123,
      workflowRunId: 456,
      maxLogBytes: 1024,
      maxSteps: 10,
      requestId: 'test-req-2',
    });
  });

  it('should return 403 for repository access denied', async () => {
    const { RepoAccessDeniedError } = require('../../src/lib/github/auth-wrapper');
    mockGenerateReport.mockRejectedValue(
      new RepoAccessDeniedError('test-owner/test-repo')
    );

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('REPO_ACCESS_DENIED');
  });

  it('should return 404 for PR not found', async () => {
    mockGenerateReport.mockRejectedValue(new Error('Not Found'));

    const request = new NextRequest(
      'http://localhost/api/github/prs/999/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '999' }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe('PR_NOT_FOUND');
  });

  it('should return 500 for internal errors', async () => {
    mockGenerateReport.mockRejectedValue(new Error('Database connection failed'));

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('should include x-request-id header in response', async () => {
    const mockReport = {
      schemaVersion: '1.0',
      requestId: 'custom-req-id',
      deploymentEnv: 'staging',
      lawbookHash: 'v1.0.0-dev',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      pr: { number: 123, headSha: 'abc123' },
      summary: {
        overall: 'GREEN',
        failingChecks: 0,
        failingRuns: 0,
      },
      failures: [],
    };

    mockGenerateReport.mockResolvedValue(mockReport);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
        headers: {
          'x-request-id': 'custom-req-id',
        },
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('custom-req-id');
  });

  it('should generate request-id if not provided', async () => {
    const mockReport = {
      schemaVersion: '1.0',
      requestId: 'auto-generated',
      deploymentEnv: 'staging',
      lawbookHash: 'v1.0.0-dev',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      pr: { number: 123, headSha: 'abc123' },
      summary: {
        overall: 'GREEN',
        failingChecks: 0,
        failingRuns: 0,
      },
      failures: [],
    };

    mockGenerateReport.mockResolvedValue(mockReport);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toBeTruthy();
    expect(requestId).toMatch(/^triage-\d+$/);
  });

  it('should return RED status for failures requiring code changes', async () => {
    const mockReport = {
      schemaVersion: '1.0',
      requestId: 'test-req-red',
      deploymentEnv: 'staging',
      lawbookHash: 'v1.0.0-dev',
      repo: { owner: 'test-owner', repo: 'test-repo' },
      pr: { number: 123, headSha: 'abc123' },
      summary: {
        overall: 'RED',
        failingChecks: 2,
        failingRuns: 1,
      },
      failures: [
        {
          checkName: 'ESLint',
          type: 'lint',
          conclusion: 'failure',
          evidence: {
            url: 'https://github.com/test/url',
            excerpt: 'Error: Unexpected token',
            excerptHash: 'hash123',
          },
          primarySignal: 'Error: Unexpected token',
          recommendation: {
            nextAction: 'PROMPT',
            rationale: 'lint failure likely requires code changes',
          },
        },
      ],
    };

    mockGenerateReport.mockResolvedValue(mockReport);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/triage?owner=test-owner&repo=test-repo',
      {
        method: 'GET',
      }
    );

    const response = await GET(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary.overall).toBe('RED');
    expect(body.failures).toHaveLength(1);
    expect(body.failures[0].recommendation.nextAction).toBe('PROMPT');
  });
});
