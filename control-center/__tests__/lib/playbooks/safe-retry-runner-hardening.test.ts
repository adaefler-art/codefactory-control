/**
 * SAFE_RETRY_RUNNER Hardening Tests (E77.2)
 * 
 * Tests for hardening requirements:
 * - Deterministic retry (headSha/ref required, no default branch)
 * - Repo allowlist enforcement (I711 policy)
 * - Secret sanitization (no tokens in persisted outputs)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeDispatchRunner,
  executePollRunner,
  executeIngestRunner,
} from '@/lib/playbooks/safe-retry-runner';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as runnerAdapter from '@/lib/github-runner/adapter';
import * as authWrapper from '@/lib/github/auth-wrapper';

// Mock the GitHub runner adapter and auth wrapper
jest.mock('@/lib/github-runner/adapter');
jest.mock('@/lib/github/auth-wrapper');

const mockPool = {} as Pool;

describe('SAFE_RETRY_RUNNER Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: allow all repos (tests will override as needed)
    (authWrapper.isRepoAllowed as jest.Mock).mockReturnValue(true);
  });

  describe('Deterministic Retry', () => {
    it('should require headSha or explicit ref (no default branch)', async () => {
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
              // Missing headSha AND ref/branch
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DETERMINISM_REQUIRED');
      expect(result.error?.message).toContain('headSha or explicit ref');
      expect(runnerAdapter.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('should accept headSha for deterministic retry', async () => {
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
              runId: 99999,
              headSha: 'abc123def456',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalledWith(mockPool, expect.objectContaining({
        ref: 'abc123def456', // headSha used
      }));
    });

    it('should accept explicit ref when headSha not available', async () => {
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
              runId: 99999,
              ref: 'refs/heads/feature-branch',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalledWith(mockPool, expect.objectContaining({
        ref: 'refs/heads/feature-branch', // explicit ref used
      }));
    });

    it('should prefer headSha over ref when both present', async () => {
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
              runId: 99999,
              headSha: 'abc123def456',
              ref: 'refs/heads/main', // Should be ignored in favor of headSha
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalledWith(mockPool, expect.objectContaining({
        ref: 'abc123def456', // headSha preferred
      }));
    });
  });

  describe('Repo Allowlist Enforcement (I711)', () => {
    it('should fail when repository is not in allowlist', async () => {
      // Mock: repo NOT allowed
      (authWrapper.isRepoAllowed as jest.Mock).mockReturnValue(false);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'runner',
            ref: {
              owner: 'forbidden',
              repo: 'repo',
              workflowIdOrFile: 'test.yml',
              runId: 99999,
              headSha: 'abc123',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REPO_NOT_ALLOWED');
      expect(result.error?.message).toContain('forbidden/repo');
      expect(result.error?.message).toContain('allowlist');
      expect(runnerAdapter.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('should succeed when repository is in allowlist', async () => {
      // Mock: repo allowed
      (authWrapper.isRepoAllowed as jest.Mock).mockReturnValue(true);

      const mockDispatchResult = {
        runId: 12345,
        runUrl: 'https://github.com/allowed/repo/actions/runs/12345',
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
              owner: 'allowed',
              repo: 'repo',
              workflowIdOrFile: 'test.yml',
              runId: 99999,
              headSha: 'abc123',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      expect(authWrapper.isRepoAllowed).toHaveBeenCalledWith('allowed', 'repo');
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalled();
    });

    it('should check allowlist before dispatch (fail-closed)', async () => {
      (authWrapper.isRepoAllowed as jest.Mock).mockReturnValue(false);

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
              headSha: 'abc123',
            },
          },
        ],
        inputs: {},
      };

      await executeDispatchRunner(mockPool, context);

      // Verify isRepoAllowed was called
      expect(authWrapper.isRepoAllowed).toHaveBeenCalledWith('test', 'repo');
      
      // Verify dispatch was NOT called
      expect(runnerAdapter.dispatchWorkflow).not.toHaveBeenCalled();
    });
  });

  describe('Secret Sanitization', () => {
    it('should not persist download URLs with tokens (ingest step)', async () => {
      const mockIngestResult = {
        runId: 12345,
        recordId: 'record-1',
        summary: {
          status: 'completed' as const,
          conclusion: 'success' as const,
          totalJobs: 1,
          successfulJobs: 1,
          failedJobs: 0,
          durationMs: 60000,
        },
        jobs: [],
        artifacts: [
          {
            id: 1,
            name: 'test-artifact',
            sizeInBytes: 1024,
            downloadUrl: 'https://api.github.com/download?token=' + ('ghs_' + 'secrettoken123'), // Contains token
            createdAt: '2024-01-01T00:00:00Z',
            expiresAt: '2024-01-08T00:00:00Z',
          },
        ],
        annotations: [],
        logsUrl: 'https://api.github.com/logs?Authorization=Bearer ' + ('ghs_' + 'token'), // Contains token
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
      
      // Verify downloadUrl is NOT in output
      expect(result.output?.artifacts[0]).not.toHaveProperty('downloadUrl');
      
      // Verify logsUrl is NOT in output
      expect(result.output).not.toHaveProperty('logsUrl');
      
      // Verify we only have safe artifact metadata
      expect(result.output?.artifacts[0]).toEqual({
        id: 1,
        name: 'test-artifact',
        sizeInBytes: 1024,
      });
    });

    it('should not persist raw API responses (dispatch step)', async () => {
      const mockDispatchResult = {
        runId: 12345,
        runUrl: 'https://github.com/test/repo/actions/runs/12345',
        recordId: 'record-1',
        isExisting: false,
        // Simulate raw API response fields that should be filtered
        _rawResponse: { headers: { authorization: 'Bearer token' } },
        _metadata: { apiVersion: '2022-11-28' },
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
              runId: 99999,
              headSha: 'abc123',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeDispatchRunner(mockPool, context);

      expect(result.success).toBe(true);
      
      // Verify only minimal fields are in output
      expect(result.output).toEqual({
        newRunId: 12345,
        runUrl: 'https://github.com/test/repo/actions/runs/12345',
        recordId: 'record-1',
        isExisting: false,
      });
      
      // Verify no raw response fields
      expect(result.output).not.toHaveProperty('_rawResponse');
      expect(result.output).not.toHaveProperty('_metadata');
    });

    it('should not persist sensitive headers (poll step)', async () => {
      const mockPollResult = {
        runId: 12345,
        status: 'completed' as const,
        conclusion: 'success' as const,
        normalizedStatus: 'completed' as const,
        updatedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        // Simulate fields that might contain sensitive data
        _headers: { authorization: 'Bearer token' },
        _cookies: { session: 'abc123' },
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
          dispatchStepOutput: { newRunId: 12345 },
        },
      };

      const result = await executePollRunner(mockPool, context);

      expect(result.success).toBe(true);
      
      // Verify only minimal fields are in output
      expect(result.output).toEqual({
        runId: 12345,
        status: 'completed',
        conclusion: 'success',
        normalizedStatus: 'completed',
        updatedAt: '2024-01-01T00:00:00Z',
      });
      
      // Verify no sensitive fields
      expect(result.output).not.toHaveProperty('_headers');
      expect(result.output).not.toHaveProperty('_cookies');
    });
  });
});
