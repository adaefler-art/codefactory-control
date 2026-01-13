/**
 * Tests for Job Rerun Service (E84.3)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { rerunFailedJobs } from '../../src/lib/github/job-rerun-service';
import { JobRerunInput } from '../../src/lib/types/job-rerun';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
  RepoAccessDeniedError: class RepoAccessDeniedError extends Error {
    repository: string;
    constructor(repository: string) {
      super(`Repository access denied: ${repository}`);
      this.repository = repository;
    }
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/lib/github/retry-policy', () => ({
  withRetry: jest.fn((fn) => fn()),
  DEFAULT_RETRY_CONFIG: {},
}));

describe('Job Rerun Service', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockOctokit: any;
  let mockQuery: jest.Mock;

  beforeEach(() => {
    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
    } as any;

    // Mock Octokit responses
    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
        actions: {
          reRunWorkflowFailedJobs: jest.fn(),
          listWorkflowRunsForRepo: jest.fn(),
        },
      },
    };

    const { createAuthenticatedClient } = require('../../src/lib/github/auth-wrapper');
    createAuthenticatedClient.mockResolvedValue(mockOctokit);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Attempt counter logic', () => {
    it('should allow rerun on first attempt', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs with one timed_out job
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 789,
              name: 'test-job',
              conclusion: 'timed_out',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock attempt count query (no previous attempts)
      mockQuery.mockResolvedValueOnce({ rows: [{ total_attempts: '0' }] });

      // Mock insert queries
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await rerunFailedJobs(input, mockPool);

      expect(result.decision).toBe('RERUN_TRIGGERED');
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].action).toBe('RERUN');
      expect(result.jobs[0].attemptNumber).toBe(1);
      expect(result.metadata.rerunJobs).toBe(1);
      expect(result.metadata.blockedJobs).toBe(0);
    });

    it('should allow rerun on second attempt (within limit)', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 789,
              name: 'test-job',
              conclusion: 'timed_out',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock attempt count query (1 previous attempt)
      mockQuery.mockResolvedValueOnce({ rows: [{ total_attempts: '1' }] });

      // Mock insert queries
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await rerunFailedJobs(input, mockPool);

      expect(result.decision).toBe('RERUN_TRIGGERED');
      expect(result.jobs[0].action).toBe('RERUN');
      expect(result.jobs[0].attemptNumber).toBe(2);
      expect(result.metadata.rerunJobs).toBe(1);
    });

    it('should block rerun when max attempts exceeded', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 789,
              name: 'test-job',
              conclusion: 'timed_out',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock attempt count query (2 previous attempts = max)
      mockQuery.mockResolvedValueOnce({ rows: [{ total_attempts: '2' }] });

      // Mock insert queries
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await rerunFailedJobs(input, mockPool);

      expect(result.decision).toBe('BLOCKED');
      expect(result.jobs[0].action).toBe('BLOCKED');
      expect(result.jobs[0].reasonCode).toBe('max_attempts_exceeded');
      expect(result.metadata.blockedJobs).toBe(1);
      expect(result.metadata.rerunJobs).toBe(0);
      expect(result.reasons).toContain(
        "Job 'test-job' blocked: max attempts (2) exceeded"
      );
    });
  });

  describe('Deterministic job selection', () => {
    it('should only rerun jobs with eligible failure classes', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs with different failure types
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'timeout-job',
              conclusion: 'timed_out',
              check_suite: { id: 456 },
            },
            {
              id: 2,
              name: 'lint-failure',
              conclusion: 'failure',
              check_suite: { id: 456 },
            },
            {
              id: 3,
              name: 'success-job',
              conclusion: 'success',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock attempt count queries
      mockQuery.mockResolvedValue({ rows: [{ total_attempts: '0' }] });

      const result = await rerunFailedJobs(input, mockPool);

      // timeout-job should be RERUN (infra transient)
      const timeoutJob = result.jobs.find(j => j.jobName === 'timeout-job');
      expect(timeoutJob?.action).toBe('RERUN');
      expect(timeoutJob?.reasonCode).toBe('infra_transient');

      // lint-failure should be SKIP (not eligible)
      const lintJob = result.jobs.find(j => j.jobName === 'lint-failure');
      expect(lintJob?.action).toBe('SKIP');
      expect(lintJob?.reasonCode).toBe('not_eligible');

      // success-job should be SKIP (not failed)
      const successJob = result.jobs.find(j => j.jobName === 'success-job');
      expect(successJob?.action).toBe('SKIP');
      expect(successJob?.reasonCode).toBe('not_failed');

      expect(result.metadata.rerunJobs).toBe(1);
      expect(result.metadata.skippedJobs).toBe(2);
    });

    it('should skip all jobs when mode is FAILED_ONLY and all pass', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs (all passing)
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 1,
              name: 'test-1',
              conclusion: 'success',
              check_suite: { id: 456 },
            },
            {
              id: 2,
              name: 'test-2',
              conclusion: 'success',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock insert queries
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await rerunFailedJobs(input, mockPool);

      expect(result.decision).toBe('NOOP');
      expect(result.metadata.rerunJobs).toBe(0);
      expect(result.metadata.skippedJobs).toBe(2);
      expect(result.reasons).toContain('No jobs eligible for rerun');
    });
  });

  describe('Audit event creation', () => {
    it('should record attempt in database', async () => {
      const input: JobRerunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        mode: 'FAILED_ONLY',
        maxAttempts: 2,
      };

      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          head: { sha: 'abc123' },
        },
      });

      // Mock check runs
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 789,
              name: 'test-job',
              conclusion: 'timed_out',
              check_suite: { id: 456 },
            },
          ],
        },
      });

      // Mock queries
      mockQuery.mockResolvedValue({ rows: [{ total_attempts: '0' }] });

      await rerunFailedJobs(input, mockPool);

      // Verify INSERT into job_rerun_attempts was called
      const insertCalls = mockQuery.mock.calls.filter(
        call => call[0].includes('INSERT INTO job_rerun_attempts')
      );
      expect(insertCalls.length).toBeGreaterThan(0);

      // Verify INSERT into workflow_action_audit was called
      const auditCalls = mockQuery.mock.calls.filter(
        call => call[0].includes('INSERT INTO workflow_action_audit')
      );
      expect(auditCalls.length).toBe(1);
    });
  });
});
