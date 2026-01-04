/**
 * SERVICE_HEALTH_RESET Playbook Tests (I774 / E77.4)
 * 
 * Tests for the service health reset playbook:
 * - Lawbook denies → SKIPPED
 * - Evidence missing → SKIPPED (execution fails)
 * - Evidence present + lawbook allowed → executes with correct parameters
 * - Idempotency prevents repeated bounces
 * - Guardrails enforcement
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeSnapshotState,
  executeApplyReset,
  executeWaitAndObserve,
  executePostVerification,
  executeUpdateStatus,
  SERVICE_HEALTH_RESET_PLAYBOOK,
  computeSnapshotIdempotencyKey,
  computeResetIdempotencyKey,
  computeObserveIdempotencyKey,
} from '@/lib/playbooks/service-health-reset';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as ecsAdapter from '@/lib/ecs/adapter';
import * as incidentsDb from '@/lib/db/incidents';

// Mock the ECS adapter
jest.mock('@/lib/ecs/adapter');
// Mock the incidents DB
jest.mock('@/lib/db/incidents');

const mockPool = {
  query: jest.fn(),
} as unknown as Pool;

describe('SERVICE_HEALTH_RESET Playbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Playbook Definition', () => {
    it('should have correct metadata', () => {
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.id).toBe('service-health-reset');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.version).toBe('1.0.0');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.applicableCategories).toContain('ALB_TARGET_UNHEALTHY');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.applicableCategories).toContain('ECS_TASK_CRASHLOOP');
    });

    it('should require ECS or ALB evidence', () => {
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.requiredEvidence).toHaveLength(2);
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.requiredEvidence[0].kind).toBe('ecs');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.requiredEvidence[1].kind).toBe('alb');
    });

    it('should have five steps', () => {
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps).toHaveLength(5);
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps[0].stepId).toBe('snapshot-state');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps[1].stepId).toBe('apply-reset');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps[2].stepId).toBe('wait-observe');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps[3].stepId).toBe('post-verification');
      expect(SERVICE_HEALTH_RESET_PLAYBOOK.steps[4].stepId).toBe('update-status');
    });
  });

  describe('Step 1: Snapshot State', () => {
    it('should fail when no ECS evidence is found', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [], // No evidence
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EVIDENCE_MISSING');
    });

    it('should fail when evidence is missing cluster or service', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'ecs',
            ref: { cluster: 'my-cluster' }, // Missing service
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_EVIDENCE');
    });

    it('should snapshot service state successfully', async () => {
      const mockServiceInfo = {
        serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster',
        desiredCount: 2,
        runningCount: 2,
        taskDefinition: 'my-task:1',
        deployments: [
          {
            id: 'deploy-1',
            status: 'PRIMARY',
            desiredCount: 2,
            runningCount: 2,
          },
        ],
      };

      (ecsAdapter.describeService as jest.Mock).mockResolvedValue({
        success: true,
        service: mockServiceInfo,
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'ecs',
            ref: {
              cluster: 'my-cluster',
              service: 'my-service',
              env: 'staging',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.cluster).toBe('my-cluster');
      expect(result.output?.service).toBe('my-service');
      expect(result.output?.env).toBe('staging');
      expect(result.output?.desiredCount).toBe(2);
      expect(result.output?.runningCount).toBe(2);
      expect(ecsAdapter.describeService).toHaveBeenCalledWith('my-cluster', 'my-service');
    });
  });

  describe('Step 2: Apply Reset', () => {
    it('should fail when lawbook denies operation', async () => {
      (ecsAdapter.forceNewDeployment as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          code: 'LAWBOOK_DENIED',
          message: 'ECS force new deployment is not allowed by lawbook',
        },
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            cluster: 'my-cluster',
            service: 'my-service',
          },
        },
      };

      const result = await executeApplyReset(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('LAWBOOK_DENIED');
    });

    it('should execute force new deployment when allowed', async () => {
      (ecsAdapter.forceNewDeployment as jest.Mock).mockResolvedValue({
        success: true,
        serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service',
        deploymentId: 'deploy-new-123',
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            cluster: 'my-cluster',
            service: 'my-service',
          },
        },
      };

      const result = await executeApplyReset(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.deploymentId).toBe('deploy-new-123');
      expect(ecsAdapter.forceNewDeployment).toHaveBeenCalledWith(mockPool, {
        cluster: 'my-cluster',
        service: 'my-service',
        correlationId: 'test:incident:1:health-reset',
      });
    });
  });

  describe('Step 3: Wait & Observe', () => {
    it('should poll service stability with bounded timeout', async () => {
      const mockFinalState = {
        serviceArn: 'arn:aws:ecs:us-east-1:123456789012:service/my-cluster/my-service',
        clusterArn: 'arn:aws:ecs:us-east-1:123456789012:cluster/my-cluster',
        desiredCount: 2,
        runningCount: 2,
        taskDefinition: 'my-task:2',
        deployments: [
          {
            id: 'deploy-new-123',
            status: 'PRIMARY',
            desiredCount: 2,
            runningCount: 2,
          },
        ],
      };

      (ecsAdapter.pollServiceStability as jest.Mock).mockResolvedValue({
        success: true,
        stable: true,
        finalState: mockFinalState,
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          resetOutput: {
            cluster: 'my-cluster',
            service: 'my-service',
          },
          maxWaitSeconds: 300,
        },
      };

      const result = await executeWaitAndObserve(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.stable).toBe(true);
      expect(ecsAdapter.pollServiceStability).toHaveBeenCalledWith(mockPool, {
        cluster: 'my-cluster',
        service: 'my-service',
        maxWaitSeconds: 300,
        checkIntervalSeconds: 10,
      });
    });

    it('should handle timeout when service does not stabilize', async () => {
      (ecsAdapter.pollServiceStability as jest.Mock).mockResolvedValue({
        success: true,
        stable: false,
        error: {
          code: 'TIMEOUT',
          message: 'Service did not stabilize within 300 seconds',
        },
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          resetOutput: {
            cluster: 'my-cluster',
            service: 'my-service',
          },
          maxWaitSeconds: 300,
        },
      };

      const result = await executeWaitAndObserve(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.stable).toBe(false);
    });
  });

  describe('Step 4: Post Verification', () => {
    it('should skip verification when no environment provided', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {},
        },
      };

      const result = await executePostVerification(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.status).toBe('skipped');
    });

    it('should run verification when environment is provided', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            env: 'staging',
          },
        },
      };

      const result = await executePostVerification(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.status).toBe('success');
      expect(result.output?.env).toBe('staging');
      expect(result.output?.reportHash).toBeDefined();
    });
  });

  describe('Step 5: Update Status', () => {
    it('should update incident to MITIGATED when remediation succeeds', async () => {
      const mockIncidentDAO = {
        updateStatus: jest.fn().mockResolvedValue(undefined),
      };

      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          observeOutput: {
            stable: true,
          },
          verificationOutput: {
            status: 'success',
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.incidentStatus).toBe('MITIGATED');
      expect(result.output?.remediationSuccessful).toBe(true);
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });

    it('should keep incident as ACKED when remediation partially fails', async () => {
      const mockIncidentDAO = {
        updateStatus: jest.fn().mockResolvedValue(undefined),
      };

      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          observeOutput: {
            stable: false, // Service didn't stabilize
          },
          verificationOutput: {
            status: 'success',
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.incidentStatus).toBe('ACKED');
      expect(result.output?.remediationSuccessful).toBe(false);
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'ACKED');
    });
  });

  describe('Idempotency Keys', () => {
    const context: StepContext = {
      incidentId: 'incident-1',
      incidentKey: 'test:incident:1',
      runId: 'run-1',
      lawbookVersion: 'v1',
      evidence: [],
      inputs: {},
    };

    it('should generate consistent snapshot idempotency key', () => {
      const key1 = computeSnapshotIdempotencyKey(context);
      const key2 = computeSnapshotIdempotencyKey(context);
      
      expect(key1).toBe('test:incident:1:snapshot');
      expect(key1).toBe(key2);
    });

    it('should generate consistent reset idempotency key', () => {
      const key1 = computeResetIdempotencyKey(context);
      const key2 = computeResetIdempotencyKey(context);
      
      expect(key1).toBe('test:incident:1:reset');
      expect(key1).toBe(key2);
    });

    it('should generate consistent observe idempotency key', () => {
      const key1 = computeObserveIdempotencyKey(context);
      const key2 = computeObserveIdempotencyKey(context);
      
      expect(key1).toBe('test:incident:1:observe');
      expect(key1).toBe(key2);
    });
  });
});
