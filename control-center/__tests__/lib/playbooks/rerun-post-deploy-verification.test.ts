/**
 * RERUN_POST_DEPLOY_VERIFICATION Playbook Tests (I772 / E77.2)
 * 
 * Tests for the rerun post-deploy verification playbook:
 * - Evidence gating (missing evidence → execution fails)
 * - Execution with mocked E65.2 playbook executor
 * - Idempotency
 * - Incident status updates
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeRunVerification,
  executeIngestIncidentUpdate,
  RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK,
  computeVerificationIdempotencyKey,
  computeIncidentUpdateIdempotencyKey,
} from '@/lib/playbooks/rerun-post-deploy-verification';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as playbookExecutor from '@/lib/playbook-executor';
import * as incidentsDb from '@/lib/db/incidents';

// Mock the playbook executor and incidents DB
jest.mock('@/lib/playbook-executor');
jest.mock('@/lib/db/incidents');

const mockPool = {} as Pool;

describe('RERUN_POST_DEPLOY_VERIFICATION Playbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Playbook Definition', () => {
    it('should have correct metadata', () => {
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.id).toBe('rerun-post-deploy-verification');
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.version).toBe('1.0.0');
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.applicableCategories).toContain('DEPLOY_VERIFICATION_FAILED');
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.applicableCategories).toContain('ALB_TARGET_UNHEALTHY');
    });

    it('should require verification or deploy_status evidence', () => {
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.requiredEvidence).toHaveLength(2);
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.requiredEvidence[0].kind).toBe('verification');
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.requiredEvidence[1].kind).toBe('deploy_status');
    });

    it('should have two steps', () => {
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.steps).toHaveLength(2);
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.steps[0].stepId).toBe('run-verification');
      expect(RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK.steps[1].stepId).toBe('ingest-incident-update');
    });
  });

  describe('Step 1: Run Verification', () => {
    it('should fail when no verification evidence is found', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [], // No evidence
        inputs: {},
      };

      const result = await executeRunVerification(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EVIDENCE_MISSING');
    });

    it('should fail when evidence is missing env', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'verification',
            ref: {}, // Missing env
          },
        ],
        inputs: {},
      };

      const result = await executeRunVerification(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_EVIDENCE');
    });

    it('should execute verification successfully when it passes', async () => {
      const mockPlaybookResult = {
        id: 'playbook-run-1',
        playbookId: 'post-deploy-verification',
        playbookVersion: '1.0.0',
        env: 'stage' as const,
        status: 'success' as const,
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
      };

      (playbookExecutor.executePlaybook as jest.Mock).mockResolvedValue(mockPlaybookResult);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'verification',
            ref: {
              env: 'stage',
              deployId: 'deploy-123',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeRunVerification(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.status).toBe('success');
      expect(result.output?.env).toBe('stage');
      expect(result.output?.playbookRunId).toBe('playbook-run-1');
      expect(result.output?.reportHash).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return failure when verification fails', async () => {
      const mockPlaybookResult = {
        id: 'playbook-run-1',
        playbookId: 'post-deploy-verification',
        playbookVersion: '1.0.0',
        env: 'stage' as const,
        status: 'failed' as const,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:01:00Z',
        summary: {
          totalSteps: 1,
          successCount: 0,
          failedCount: 1,
          skippedCount: 0,
          durationMs: 60000,
        },
        steps: [],
        createdAt: '2024-01-01T00:00:00Z',
      };

      (playbookExecutor.executePlaybook as jest.Mock).mockResolvedValue(mockPlaybookResult);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'verification',
            ref: { env: 'stage' },
          },
        ],
        inputs: {},
      };

      const result = await executeRunVerification(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VERIFICATION_FAILED');
    });

    it('should handle execution errors gracefully', async () => {
      (playbookExecutor.executePlaybook as jest.Mock).mockRejectedValue(
        new Error('Playbook execution failed')
      );

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'verification',
            ref: { env: 'stage' },
          },
        ],
        inputs: {},
      };

      const result = await executeRunVerification(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VERIFICATION_EXECUTION_ERROR');
    });
  });

  describe('Step 2: Ingest Incident Update', () => {
    let mockIncidentDAO: any;

    beforeEach(() => {
      mockIncidentDAO = {
        updateIncidentStatus: jest.fn().mockResolvedValue(undefined),
        addEvidence: jest.fn().mockResolvedValue(undefined),
      };
      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);
    });

    it('should fail when no verification step output is provided', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {}, // Missing verificationStepOutput
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_VERIFICATION_OUTPUT');
    });

    it('should skip update when verification did not pass', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            status: 'failed',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.currentStatus).toBe('unchanged');
      expect(mockIncidentDAO.updateIncidentStatus).not.toHaveBeenCalled();
    });

    it('should update incident status to MITIGATED when verification passes', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            status: 'success',
            playbookRunId: 'playbook-run-1',
            reportHash: 'abc123',
            env: 'stage',
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(mockIncidentDAO.updateIncidentStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
      expect(mockIncidentDAO.addEvidence).toHaveBeenCalledWith('incident-1', {
        kind: 'verification',
        ref: {
          playbookRunId: 'playbook-run-1',
          reportHash: 'abc123',
          env: 'stage',
          deployId: 'deploy-123',
          status: 'success',
        },
        sha256: 'abc123',
      });
    });

    it('should handle update errors gracefully', async () => {
      mockIncidentDAO.updateIncidentStatus.mockRejectedValue(
        new Error('Database error')
      );

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            status: 'success',
            playbookRunId: 'playbook-run-1',
            reportHash: 'abc123',
            env: 'stage',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INCIDENT_UPDATE_FAILED');
    });
  });

  describe('Idempotency Keys', () => {
    it('should generate consistent verification idempotency keys', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'verification',
            ref: {
              env: 'stage',
              deployId: 'deploy-123',
            },
          },
        ],
        inputs: {},
      };

      const key1 = computeVerificationIdempotencyKey(context);
      const key2 = computeVerificationIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toContain('verification:test:incident:1:');
    });

    it('should generate consistent incident update idempotency keys', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {},
      };

      const key1 = computeIncidentUpdateIdempotencyKey(context);
      const key2 = computeIncidentUpdateIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toBe('incident-update:test:incident:1');
    });
  });
});
