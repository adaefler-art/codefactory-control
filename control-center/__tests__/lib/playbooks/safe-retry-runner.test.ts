/**
 * SAFE_RETRY_RUNNER Playbook Tests (I772 / E77.2)
 * 
 * Tests for the safe retry runner playbook:
 * - Evidence gating (missing evidence → execution fails)
 * - Execution with mocked adapters
 * - Idempotency
 * - Step chaining (dispatch → poll → ingest)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeDispatchRunner,
  executePollRunner,
  executeIngestRunner,
  SAFE_RETRY_RUNNER_PLAYBOOK,
  computeDispatchIdempotencyKey,
  computePollIdempotencyKey,
  computeIngestIdempotencyKey,
} from '@/lib/playbooks/safe-retry-runner';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as runnerAdapter from '@/lib/github-runner/adapter';
import * as authWrapper from '@/lib/github/auth-wrapper';

// Mock the GitHub runner adapter and auth wrapper
jest.mock('@/lib/github-runner/adapter');
jest.mock('@/lib/github/auth-wrapper');

const mockPool = {} as Pool;

describe('SAFE_RETRY_RUNNER Playbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock repo allowlist to allow all repos by default (tests will override as needed)
    (authWrapper.isRepoAllowed as jest.Mock).mockReturnValue(true);
  });

  describe('Playbook Definition', () => {
    it('should have correct metadata', () => {
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.id).toBe('safe-retry-runner');
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.version).toBe('1.0.0');
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.applicableCategories).toContain('RUNNER_WORKFLOW_FAILED');
    });

    it('should require runner or github_run evidence', () => {
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.requiredEvidence).toHaveLength(2);
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.requiredEvidence[0].kind).toBe('runner');
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.requiredEvidence[1].kind).toBe('github_run');
    });

    it('should have three steps', () => {
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.steps).toHaveLength(3);
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.steps[0].stepId).toBe('dispatch-runner');
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.steps[1].stepId).toBe('poll-runner');
      expect(SAFE_RETRY_RUNNER_PLAYBOOK.steps[2].stepId).toBe('ingest-runner');
    });
  });

  describe('Step 1: Dispatch Runner', () => {
    it('should fail when no runner evidence is found', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [], // No evidence
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EVIDENCE_MISSING');
    });

    it('should fail when evidence is missing required fields', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: {}, // Missing owner, repo, workflow, AND headSha/ref
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_EVIDENCE');
    });

    it('should dispatch workflow successfully with valid evidence', async () => {
      const mockDispatchResult = {
        runId: 12345,
        runUrl: 'https://github.com/test/repo/actions/runs/12345',
        recordId: 'record-1',
        isExisting: false,
      };

      (runnerAdapter.dispatchWorkflow as jest.Mock).mockResolvedValue(mockDispatchResult);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: {
              owner: 'test',
              repo: 'repo',
              workflowIdOrFile: 'test.yml',
              ref: 'main',
              runId: 99999,
              headSha: 'abc123def456', // Added for determinism
              inputs: { foo: 'bar' },
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newRunId).toBe(12345);
      expect(result.output?.runUrl).toBe('https://github.com/test/repo/actions/runs/12345');
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalledWith(mockPool, {
        correlationId: 'test:incident:1:retry:99999',
        owner: 'test',
        repo: 'repo',
        workflowIdOrFile: 'test.yml',
        ref: 'abc123def456', // Uses headSha instead of ref
        inputs: { foo: 'bar' },
      });
    });

    it('should handle dispatch errors gracefully', async () => {
      (runnerAdapter.dispatchWorkflow as jest.Mock).mockRejectedValue(
        new Error('GitHub API error')
      );

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: {
              owner: 'test',
              repo: 'repo',
              workflowIdOrFile: 'test.yml',
              runId: 99999,
              headSha: 'abc123', // Added for determinism
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DISPATCH_FAILED');
      expect(result.error?.message).toContain('GitHub API error');
    });
  });

  describe('Step 2: Poll Runner', () => {
    it('should fail when no dispatch step output is provided', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { owner: 'test', repo: 'repo' },
          },
        ],
        inputs: {}, // Missing dispatchStepOutput
      };

      const result = await executePollRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_RUN_ID');
    });

    it('should poll until completion and return result', async () => {
      const mockPollResult = {
        runId: 12345,
        status: 'completed' as const,
        conclusion: 'success' as const,
        normalizedStatus: 'completed' as const,
        updatedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
      };

      (runnerAdapter.pollRun as jest.Mock).mockResolvedValue(mockPollResult);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { owner: 'test', repo: 'repo' },
          },
        ],
        inputs: {
          dispatchStepOutput: {
            newRunId: 12345,
          },
        },
      };

      const result = await executePollRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.runId).toBe(12345);
      expect(result.output?.normalizedStatus).toBe('completed');
      expect(runnerAdapter.pollRun).toHaveBeenCalledWith(mockPool, {
        owner: 'test',
        repo: 'repo',
        runId: 12345,
      });
    });

    it('should handle poll errors gracefully', async () => {
      (runnerAdapter.pollRun as jest.Mock).mockRejectedValue(
        new Error('Poll failed')
      );

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { owner: 'test', repo: 'repo' },
          },
        ],
        inputs: {
          dispatchStepOutput: { newRunId: 12345 },
        },
      };

      const result = await executePollRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('POLL_FAILED');
    });
  });

  describe('Step 3: Ingest Runner', () => {
    it('should fail when no poll step output is provided', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { owner: 'test', repo: 'repo' },
          },
        ],
        inputs: {}, // Missing pollStepOutput
      };

      const result = await executeIngestRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_RUN_ID');
    });

    it('should ingest run successfully', async () => {
      const mockIngestResult = {
        runId: 12345,
        recordId: 'record-1',
        summary: {
          status: 'completed' as const,
          conclusion: 'success' as const,
          totalJobs: 3,
          successfulJobs: 3,
          failedJobs: 0,
          durationMs: 120000,
        },
        jobs: [],
        artifacts: [
          {
            id: 1,
            name: 'test-artifact',
            sizeInBytes: 1024,
            downloadUrl: 'https://example.com/artifact',
            createdAt: '2024-01-01T00:00:00Z',
            expiresAt: '2024-01-08T00:00:00Z',
          },
        ],
        annotations: [],
        logsUrl: 'https://example.com/logs',
      };

      (runnerAdapter.ingestRun as jest.Mock).mockResolvedValue(mockIngestResult);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { owner: 'test', repo: 'repo' },
          },
        ],
        inputs: {
          pollStepOutput: { runId: 12345 },
        },
      };

      const result = await executeIngestRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.runId).toBe(12345);
      expect(result.output?.artifactsCount).toBe(1);
      expect(runnerAdapter.ingestRun).toHaveBeenCalledWith(mockPool, {
        owner: 'test',
        repo: 'repo',
        runId: 12345,
      });
    });
  });

  describe('Idempotency Keys', () => {
    it('should generate consistent dispatch idempotency keys', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: { runId: 99999 },
          },
        ],
        inputs: {
          owner: 'test',
          repo: 'repo',
          workflow: 'test.yml',
          sourceRunId: 99999,
        },
      };

      const key1 = computeDispatchIdempotencyKey(context);
      const key2 = computeDispatchIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toContain('dispatch:test:incident:1:');
    });

    it('should generate consistent poll idempotency keys', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          dispatchStepOutput: { newRunId: 12345 },
        },
      };

      const key1 = computePollIdempotencyKey(context);
      const key2 = computePollIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toBe('poll:test:incident:1:12345');
    });

    it('should generate consistent ingest idempotency keys', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          pollStepOutput: { runId: 12345 },
        },
      };

      const key1 = computeIngestIdempotencyKey(context);
      const key2 = computeIngestIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toBe('ingest:test:incident:1:12345');
    });
  });
});
