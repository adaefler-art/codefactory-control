/**
 * Tests for POST /api/github/prs/{prNumber}/checks/rerun
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../../app/api/github/prs/[prNumber]/checks/rerun/route';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/github/job-rerun-service', () => ({
  rerunFailedJobs: jest.fn(),
}));

jest.mock('../../src/lib/automation/policy-evaluator', () => ({
  evaluateAndRecordPolicy: jest.fn(),
}));

jest.mock('../../src/lib/repo-actions-registry-service', () => ({
  RepoActionsRegistryService: jest.fn().mockImplementation(() => ({
    getActiveRegistry: jest.fn(),
  })),
}));

jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/lib/touchpoints/manual-touchpoints', () => ({
  recordDebugInterventionTouchpoint: jest.fn(),
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

describe('POST /api/github/prs/{prNumber}/checks/rerun', () => {
  let mockRerunFailedJobs: any;
  let mockGetActiveRegistry: any;

  beforeEach(() => {
    const { rerunFailedJobs } = require('../../src/lib/github/job-rerun-service');
    mockRerunFailedJobs = rerunFailedJobs;

    const { RepoActionsRegistryService } = require('../../src/lib/repo-actions-registry-service');
    mockGetActiveRegistry = jest.fn();
    RepoActionsRegistryService.mockImplementation(() => ({
      getActiveRegistry: mockGetActiveRegistry,
    }));

    const { evaluateAndRecordPolicy } = require('../../src/lib/automation/policy-evaluator');
    evaluateAndRecordPolicy.mockResolvedValue({
      allow: true,
      decision: 'allowed',
      reason: null,
      nextAllowedAt: null,
      requiresApproval: false,
      idempotencyKey: 'policy-key',
      idempotencyKeyHash: 'policy-key-hash',
      policyName: 'rerun_checks',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DEPLOY_ENV;
  });

  it('should return 200 with rerun result for valid request in staging', async () => {
    process.env.DEPLOY_ENV = 'staging';

    const mockResult = {
      schemaVersion: '1.0' as const,
      requestId: 'test-req-1',
      lawbookHash: 'v1.0.0-dev',
      deploymentEnv: 'staging' as const,
      target: { prNumber: 123, runId: 456 },
      decision: 'RERUN_TRIGGERED' as const,
      reasons: ['Successfully triggered rerun'],
      jobs: [
        {
          jobName: 'test-job',
          jobId: 789,
          priorConclusion: 'timed_out',
          action: 'RERUN' as const,
          attemptNumber: 1,
          reasonCode: 'infra_transient',
        },
      ],
      metadata: {
        totalJobs: 1,
        rerunJobs: 1,
        blockedJobs: 0,
        skippedJobs: 0,
      },
    };

    mockRerunFailedJobs.mockResolvedValue(mockResult);
    mockGetActiveRegistry.mockResolvedValue(null); // No registry in staging

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'test-req-1',
        },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          runId: 456,
          mode: 'FAILED_ONLY',
          maxAttempts: 2,
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockResult);
    expect(mockRerunFailedJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      })
    );
  });

  it('should return 409 when repository not in registry (production)', async () => {
    process.env.DEPLOY_ENV = 'prod';

    mockGetActiveRegistry.mockResolvedValue(null); // No registry

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('REGISTRY_NOT_FOUND');
    expect(body.details.policy).toBe('fail-closed');
  });

  it('should return 403 when action not allowed by registry', async () => {
    const mockRegistry = {
      id: 'reg-1',
      registryId: 'test-registry',
      repository: 'test-owner/test-repo',
      version: '1.0.0',
      content: {
        version: '1.0.0',
        registryId: 'test-registry',
        repository: 'test-owner/test-repo',
        allowedActions: [
          {
            actionType: 'merge_pr',
            enabled: true,
          },
        ],
        failClosed: true,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
      },
      active: true,
      createdAt: new Date(),
      createdBy: 'admin',
    };

    mockGetActiveRegistry.mockResolvedValue(mockRegistry);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe('ACTION_NOT_ALLOWED');
    expect(body.details.action).toBe('rerun_failed_jobs');
  });

  it('should respect registry maxRetries limit', async () => {
    const mockRegistry = {
      id: 'reg-1',
      registryId: 'test-registry',
      repository: 'test-owner/test-repo',
      version: '1.0.0',
      content: {
        version: '1.0.0',
        registryId: 'test-registry',
        repository: 'test-owner/test-repo',
        allowedActions: [
          {
            actionType: 'rerun_failed_jobs',
            enabled: true,
            maxRetries: 1, // Registry limits to 1 retry
          },
        ],
        failClosed: true,
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
      },
      active: true,
      createdAt: new Date(),
      createdBy: 'admin',
    };

    mockGetActiveRegistry.mockResolvedValue(mockRegistry);

    const mockResult = {
      schemaVersion: '1.0' as const,
      requestId: 'test-req-1',
      lawbookHash: 'v1.0.0-dev',
      deploymentEnv: 'staging' as const,
      target: { prNumber: 123 },
      decision: 'NOOP' as const,
      reasons: [],
      jobs: [],
      metadata: {
        totalJobs: 0,
        rerunJobs: 0,
        blockedJobs: 0,
        skippedJobs: 0,
      },
    };

    mockRerunFailedJobs.mockResolvedValue(mockResult);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          maxAttempts: 5, // Request 5, but registry limits to 1
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    expect(mockRerunFailedJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 1, // Should be adjusted to registry limit
      })
    );
  });

  it('should return 400 for invalid PR number', async () => {
    const request = new NextRequest(
      'http://localhost/api/github/prs/invalid/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: 'invalid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('INVALID_PR_NUMBER');
  });

  it('should return 400 for missing owner/repo', async () => {
    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('MISSING_PARAMS');
  });

  it('should use default values for optional parameters', async () => {
    process.env.DEPLOY_ENV = 'staging';

    mockGetActiveRegistry.mockResolvedValue(null);

    const mockResult = {
      schemaVersion: '1.0' as const,
      requestId: 'test-req-1',
      lawbookHash: 'v1.0.0-dev',
      deploymentEnv: 'staging' as const,
      target: { prNumber: 123 },
      decision: 'NOOP' as const,
      reasons: [],
      jobs: [],
      metadata: {
        totalJobs: 0,
        rerunJobs: 0,
        blockedJobs: 0,
        skippedJobs: 0,
      },
    };

    mockRerunFailedJobs.mockResolvedValue(mockResult);

    const request = new NextRequest(
      'http://localhost/api/github/prs/123/checks/rerun',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ prNumber: '123' }),
    });

    expect(response.status).toBe(200);
    expect(mockRerunFailedJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'FAILED_ONLY', // Default
        maxAttempts: 2, // Default
      })
    );
  });
});
