/**
 * Playbook Integration Tests (I772 / E77.2)
 * 
 * Tests for end-to-end playbook execution through I771 framework:
 * - SAFE_RETRY_RUNNER with mocked adapters
 * - RERUN_POST_DEPLOY_VERIFICATION with mocked adapters
 * - Evidence gating
 * - Lawbook gating
 * - Idempotency
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { RemediationPlaybookExecutor } from '@/lib/remediation-executor';
import {
  ExecutePlaybookRequest,
  computeRunKey,
  computeInputsHash,
} from '@/lib/contracts/remediation-playbook';
import { getPlaybookById } from '@/lib/playbooks/registry';
import * as runnerAdapter from '@/lib/github-runner/adapter';
import * as playbookExecutor from '@/lib/playbook-executor';
import * as incidentsDb from '@/lib/db/incidents';

// Mock dependencies
jest.mock('@/lawbook/load', () => ({
  loadGuardrails: jest.fn().mockResolvedValue({
    hash: 'abcd1234567890',
    data: { version: 1, guardrails: [] },
  }),
}));
jest.mock('@/lib/github-runner/adapter');
jest.mock('@/lib/playbook-executor');
jest.mock('@/lib/db/incidents');

const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('Playbook Integration Tests (I772)', () => {
  let executor: RemediationPlaybookExecutor;

  beforeEach(() => {
    executor = new RemediationPlaybookExecutor(mockPool);
    jest.clearAllMocks();
  });

  describe('SAFE_RETRY_RUNNER End-to-End', () => {
    it('should skip execution when evidence is missing', async () => {
      const playbook = getPlaybookById('safe-retry-runner');
      expect(playbook).toBeDefined();

      // Mock incident retrieval with no runner evidence
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              category: 'RUNNER_WORKFLOW_FAILED',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // No evidence
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-1',
              run_key: 'test:incident:1:safe-retry-runner:hash',
              incident_id: 'incident-1',
              playbook_id: 'safe-retry-runner',
              playbook_version: '1.0.0',
              status: 'SKIPPED',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              planned_json: null,
              result_json: {
                skipReason: 'EVIDENCE_MISSING',
                message: 'Required evidence not satisfied',
              },
              lawbook_version: 'abcd1234',
              inputs_hash: 'hash',
            },
          ],
        });

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-1',
        playbookId: 'safe-retry-runner',
      };

      const result = await executor.executePlaybook(
        request,
        playbook!.definition,
        playbook!.stepExecutors,
        playbook!.idempotencyKeyFns
      );

      expect(result.status).toBe('SKIPPED');
      expect(result.skipReason).toBe('EVIDENCE_MISSING');
    });

    it('should execute successfully with valid evidence and mocked adapters', async () => {
      const playbook = getPlaybookById('safe-retry-runner');
      expect(playbook).toBeDefined();

      // Mock GitHub runner adapter responses
      (runnerAdapter.dispatchWorkflow as jest.Mock).mockResolvedValue({
        runId: 12345,
        runUrl: 'https://github.com/test/repo/actions/runs/12345',
        recordId: 'record-1',
        isExisting: false,
      });

      (runnerAdapter.pollRun as jest.Mock).mockResolvedValue({
        runId: 12345,
        status: 'completed',
        conclusion: 'success',
        normalizedStatus: 'completed',
        updatedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
      });

      (runnerAdapter.ingestRun as jest.Mock).mockResolvedValue({
        runId: 12345,
        recordId: 'record-1',
        summary: {
          status: 'completed',
          conclusion: 'success',
          totalJobs: 1,
          successfulJobs: 1,
          failedJobs: 0,
        },
        jobs: [],
        artifacts: [],
        annotations: [],
        logsUrl: 'https://example.com/logs',
      });

      // Mock database queries
      mockQuery
        .mockResolvedValueOnce({
          // getIncident
          rows: [
            {
              id: 'incident-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              category: 'RUNNER_WORKFLOW_FAILED',
            },
          ],
        })
        .mockResolvedValueOnce({
          // getEvidence
          rows: [
            {
              id: 'evidence-1',
              incident_id: 'incident-1',
              kind: 'runner',
              ref: JSON.stringify({
                owner: 'test',
                repo: 'repo',
                workflowIdOrFile: 'test.yml',
                ref: 'main',
                runId: 99999,
              }),
              sha256: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // getRunByKey - no existing run
        .mockResolvedValueOnce({
          // upsertRunByKey - create new run
          rows: [
            {
              id: 'run-1',
              run_key: 'test:incident:1:safe-retry-runner:hash',
              incident_id: 'incident-1',
              playbook_id: 'safe-retry-runner',
              playbook_version: '1.0.0',
              status: 'PLANNED',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              planned_json: {},
              result_json: null,
              lawbook_version: 'abcd1234',
              inputs_hash: 'hash',
            },
          ],
        })
        .mockResolvedValue({
          // All subsequent queries (createStep, updateStepStatus, etc.)
          rows: [{ id: 'step-1', status: 'SUCCEEDED' }],
        });

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-1',
        playbookId: 'safe-retry-runner',
      };

      const result = await executor.executePlaybook(
        request,
        playbook!.definition,
        playbook!.stepExecutors,
        playbook!.idempotencyKeyFns
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(runnerAdapter.dispatchWorkflow).toHaveBeenCalled();
      expect(runnerAdapter.pollRun).toHaveBeenCalled();
      expect(runnerAdapter.ingestRun).toHaveBeenCalled();
    });
  });

  describe('RERUN_POST_DEPLOY_VERIFICATION End-to-End', () => {
    it('should skip execution when evidence is missing', async () => {
      const playbook = getPlaybookById('rerun-post-deploy-verification');
      expect(playbook).toBeDefined();

      // Mock incident retrieval with no verification evidence
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-2',
              incident_key: 'test:incident:2',
              severity: 'RED',
              status: 'OPEN',
              title: 'Deploy Verification Failed',
              category: 'DEPLOY_VERIFICATION_FAILED',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // No evidence
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-2',
              run_key: 'test:incident:2:rerun-post-deploy-verification:hash',
              incident_id: 'incident-2',
              playbook_id: 'rerun-post-deploy-verification',
              playbook_version: '1.0.0',
              status: 'SKIPPED',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              planned_json: null,
              result_json: {
                skipReason: 'EVIDENCE_MISSING',
                message: 'Required evidence not satisfied',
              },
              lawbook_version: 'abcd1234',
              inputs_hash: 'hash',
            },
          ],
        });

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-2',
        playbookId: 'rerun-post-deploy-verification',
      };

      const result = await executor.executePlaybook(
        request,
        playbook!.definition,
        playbook!.stepExecutors,
        playbook!.idempotencyKeyFns
      );

      expect(result.status).toBe('SKIPPED');
      expect(result.skipReason).toBe('EVIDENCE_MISSING');
    });

    it('should execute successfully with valid evidence', async () => {
      const playbook = getPlaybookById('rerun-post-deploy-verification');
      expect(playbook).toBeDefined();

      // Mock playbook executor
      (playbookExecutor.executePlaybook as jest.Mock).mockResolvedValue({
        id: 'playbook-run-1',
        playbookId: 'post-deploy-verification',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'success',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:01:00Z',
        summary: {
          totalSteps: 1,
          successCount: 1,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 60000,
        },
        steps: [],
        createdAt: '2024-01-01T00:00:00Z',
      });

      // Mock incidents DAO
      const mockIncidentDAO = {
        updateIncidentStatus: jest.fn().mockResolvedValue(undefined),
        addEvidence: jest.fn().mockResolvedValue(undefined),
      };
      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);

      // Mock database queries
      mockQuery
        .mockResolvedValueOnce({
          // getIncident
          rows: [
            {
              id: 'incident-2',
              incident_key: 'test:incident:2',
              severity: 'RED',
              status: 'OPEN',
              title: 'Deploy Verification Failed',
              category: 'DEPLOY_VERIFICATION_FAILED',
            },
          ],
        })
        .mockResolvedValueOnce({
          // getEvidence
          rows: [
            {
              id: 'evidence-2',
              incident_id: 'incident-2',
              kind: 'verification',
              ref: JSON.stringify({
                env: 'stage',
                deployId: 'deploy-123',
              }),
              sha256: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // getRunByKey - no existing run
        .mockResolvedValueOnce({
          // upsertRunByKey
          rows: [
            {
              id: 'run-2',
              run_key: 'test:incident:2:rerun-post-deploy-verification:hash',
              incident_id: 'incident-2',
              playbook_id: 'rerun-post-deploy-verification',
              playbook_version: '1.0.0',
              status: 'PLANNED',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              planned_json: {},
              result_json: null,
              lawbook_version: 'abcd1234',
              inputs_hash: 'hash',
            },
          ],
        })
        .mockResolvedValue({
          // All subsequent queries
          rows: [{ id: 'step-1', status: 'SUCCEEDED' }],
        });

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-2',
        playbookId: 'rerun-post-deploy-verification',
      };

      const result = await executor.executePlaybook(
        request,
        playbook!.definition,
        playbook!.stepExecutors,
        playbook!.idempotencyKeyFns
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(playbookExecutor.executePlaybook).toHaveBeenCalled();
      expect(mockIncidentDAO.updateIncidentStatus).toHaveBeenCalledWith('incident-2', 'MITIGATED');
    });
  });

  describe('Idempotency', () => {
    it('should return existing run on repeated execution', async () => {
      const playbook = getPlaybookById('safe-retry-runner');
      expect(playbook).toBeDefined();

      const existingRun = {
        id: 'run-1',
        run_key: 'test:incident:1:safe-retry-runner:hash',
        incident_id: 'incident-1',
        playbook_id: 'safe-retry-runner',
        playbook_version: '1.0.0',
        status: 'SUCCEEDED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        planned_json: {},
        result_json: { success: true },
        lawbook_version: 'abcd1234',
        inputs_hash: 'hash',
      };

      mockQuery
        .mockResolvedValueOnce({
          // getIncident
          rows: [
            {
              id: 'incident-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              category: 'RUNNER_WORKFLOW_FAILED',
            },
          ],
        })
        .mockResolvedValueOnce({
          // getEvidence
          rows: [
            {
              id: 'evidence-1',
              incident_id: 'incident-1',
              kind: 'runner',
              ref: JSON.stringify({
                owner: 'test',
                repo: 'repo',
                workflowIdOrFile: 'test.yml',
                runId: 99999,
              }),
              sha256: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          // getRunByKey - return existing run
          rows: [existingRun],
        })
        .mockResolvedValueOnce({
          // getStepsForRun
          rows: [],
        });

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-1',
        playbookId: 'safe-retry-runner',
      };

      const result = await executor.executePlaybook(
        request,
        playbook!.definition,
        playbook!.stepExecutors,
        playbook!.idempotencyKeyFns
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.runId).toBe('run-1');
      expect(result.message).toContain('Existing run returned');
      // Step executors should not be called
      expect(runnerAdapter.dispatchWorkflow).not.toHaveBeenCalled();
    });
  });
});
