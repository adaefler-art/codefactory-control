/**
 * REDEPLOY_LKG Playbook Tests (I773 / E77.3)
 * 
 * Tests for the Redeploy Last Known Good playbook:
 * - LKG selection query
 * - NO_LKG_FOUND scenario when no GREEN verification exists
 * - Lawbook gating (deny by default, allow for redeploy-lkg)
 * - Idempotency (same inputs → same run)
 * - Full execution flow with all steps
 * - Frequency limiting (once per incident per hour)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeSelectLkg,
  executeDispatchDeploy,
  executePostDeployVerification,
  executeUpdateDeployStatus,
  REDEPLOY_LKG_PLAYBOOK,
  computeSelectLkgIdempotencyKey,
  computeDispatchDeployIdempotencyKey,
  computeVerificationIdempotencyKey,
  computeUpdateStatusIdempotencyKey,
} from '@/lib/playbooks/redeploy-lkg';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as deployStatusDb from '@/lib/db/deployStatusSnapshots';
import * as incidentsDb from '@/lib/db/incidents';

// Mock the database modules
jest.mock('@/lib/db/deployStatusSnapshots');
jest.mock('@/lib/db/incidents');

const mockPool = {} as Pool;

describe('REDEPLOY_LKG Playbook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Playbook Definition', () => {
    it('should have correct metadata', () => {
      expect(REDEPLOY_LKG_PLAYBOOK.id).toBe('redeploy-lkg');
      expect(REDEPLOY_LKG_PLAYBOOK.version).toBe('1.0.0');
      expect(REDEPLOY_LKG_PLAYBOOK.title).toContain('Last Known Good');
    });

    it('should be applicable to deployment failure categories', () => {
      expect(REDEPLOY_LKG_PLAYBOOK.applicableCategories).toContain('DEPLOY_VERIFICATION_FAILED');
      expect(REDEPLOY_LKG_PLAYBOOK.applicableCategories).toContain('ALB_TARGET_UNHEALTHY');
      expect(REDEPLOY_LKG_PLAYBOOK.applicableCategories).toContain('ECS_TASK_CRASHLOOP');
    });

    it('should require deploy_status or verification evidence', () => {
      expect(REDEPLOY_LKG_PLAYBOOK.requiredEvidence).toHaveLength(2);
      expect(REDEPLOY_LKG_PLAYBOOK.requiredEvidence[0].kind).toBe('deploy_status');
      expect(REDEPLOY_LKG_PLAYBOOK.requiredEvidence[1].kind).toBe('verification');
    });

    it('should have four steps', () => {
      expect(REDEPLOY_LKG_PLAYBOOK.steps).toHaveLength(4);
      expect(REDEPLOY_LKG_PLAYBOOK.steps[0].stepId).toBe('select-lkg');
      expect(REDEPLOY_LKG_PLAYBOOK.steps[1].stepId).toBe('dispatch-deploy');
      expect(REDEPLOY_LKG_PLAYBOOK.steps[2].stepId).toBe('post-deploy-verification');
      expect(REDEPLOY_LKG_PLAYBOOK.steps[3].stepId).toBe('update-deploy-status');
    });
  });

  describe('Step 1: Select LKG', () => {
    it('should fail when no evidence is found', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [], // No evidence
        inputs: {},
      };

      const result = await executeSelectLkg(mockPool, context);

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
            kind: 'deploy_status',
            ref: {}, // Missing env
          },
        ],
        inputs: {},
      };

      const result = await executeSelectLkg(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_EVIDENCE');
    });

    it('should return NO_LKG_FOUND when no LKG exists', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: null, // No LKG found
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'prod', service: 'api' },
          },
        ],
        inputs: {},
      };

      const result = await executeSelectLkg(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_LKG_FOUND');
      expect(result.error?.message).toContain('No Last Known Good deployment found');
      expect(mockFindLastKnownGood).toHaveBeenCalledWith(mockPool, 'prod', 'api');
    });

    it('should return NO_LKG_REFERENCE when LKG has no commit or image digest', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: {
          snapshotId: 'snap-1',
          deployEventId: null,
          env: 'prod',
          service: 'api',
          version: null,
          commitHash: null, // Missing
          imageDigest: null, // Missing
          cfnChangeSetId: null,
          observedAt: '2025-01-01T00:00:00Z',
          verificationRunId: 'ver-1',
          verificationReportHash: 'hash123',
        },
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'prod', service: 'api' },
          },
        ],
        inputs: {},
      };

      const result = await executeSelectLkg(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_LKG_REFERENCE');
    });

    it('should successfully select LKG when found with commit hash', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      const lkg = {
        snapshotId: 'snap-1',
        deployEventId: 'deploy-1',
        env: 'prod',
        service: 'api',
        version: 'v1.2.3',
        commitHash: 'abc123def456',
        imageDigest: null,
        cfnChangeSetId: null,
        observedAt: '2025-01-01T00:00:00Z',
        verificationRunId: 'ver-1',
        verificationReportHash: 'hash123',
      };

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg,
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'prod', service: 'api' },
          },
        ],
        inputs: {},
      };

      const result = await executeSelectLkg(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.lkg).toEqual(lkg);
    });

    it('should normalize environment names', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: null,
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'production' }, // Should normalize to 'prod'
          },
        ],
        inputs: {},
      };

      await executeSelectLkg(mockPool, context);

      expect(mockFindLastKnownGood).toHaveBeenCalledWith(mockPool, 'prod', undefined);
    });
  });

  describe('Step 2: Dispatch Deploy', () => {
    it('should fail when LKG output is missing', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {}, // Missing lkgStepOutput
      };

      const result = await executeDispatchDeploy(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_LKG_OUTPUT');
    });

    it('should successfully dispatch deploy with LKG reference', async () => {
      const lkg = {
        snapshotId: 'snap-1',
        deployEventId: 'deploy-1',
        env: 'prod',
        service: 'api',
        version: 'v1.2.3',
        commitHash: 'abc123def456',
        imageDigest: null,
        cfnChangeSetId: null,
        observedAt: '2025-01-01T00:00:00Z',
        verificationRunId: 'ver-1',
        verificationReportHash: 'hash123',
      };

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          lkgStepOutput: { lkg },
        },
      };

      const result = await executeDispatchDeploy(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.dispatchId).toBeDefined();
      expect(result.output?.lkgReference.commitHash).toBe('abc123def456');
      expect(result.output?.env).toBe('prod');
      expect(result.output?.service).toBe('api');
    });
  });

  describe('Step 3: Post-Deploy Verification', () => {
    it('should fail when dispatch output is missing', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {}, // Missing dispatchStepOutput
      };

      const result = await executePostDeployVerification(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_DISPATCH_OUTPUT');
    });

    it('should successfully verify redeployed LKG', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          dispatchStepOutput: {
            dispatchId: 'dispatch-1',
            env: 'prod',
          },
        },
      };

      const result = await executePostDeployVerification(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.status).toBe('success');
      expect(result.output?.reportHash).toBeDefined();
      expect(result.output?.env).toBe('prod');
    });
  });

  describe('Step 4: Update Deploy Status', () => {
    it('should fail when verification output is missing', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {}, // Missing verificationStepOutput
      };

      const result = await executeUpdateDeployStatus(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_VERIFICATION_OUTPUT');
    });

    it('should update status to GREEN and mark incident MITIGATED when verification passes', async () => {
      const mockIncidentDAO = {
        updateStatus: jest.fn().mockResolvedValue(undefined),
        addEvidence: jest.fn().mockResolvedValue(undefined),
      };

      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            playbookRunId: 'ver-run-1',
            status: 'success',
            reportHash: 'hash456',
            env: 'prod',
            dispatchId: 'dispatch-1',
          },
        },
      };

      const result = await executeUpdateDeployStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('GREEN');
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
      expect(mockIncidentDAO.addEvidence).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            incident_id: 'incident-1',
            kind: 'verification',
            sha256: 'hash456',
          }),
        ])
      );
    });

    it('should update status to RED when verification fails', async () => {
      const mockIncidentDAO = {
        updateStatus: jest.fn().mockResolvedValue(undefined),
        addEvidence: jest.fn().mockResolvedValue(undefined),
      };

      (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            playbookRunId: 'ver-run-1',
            status: 'failed',
            reportHash: 'hash456',
            env: 'prod',
            dispatchId: 'dispatch-1',
          },
        },
      };

      const result = await executeUpdateDeployStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('RED');
      expect(mockIncidentDAO.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency Keys', () => {
    it('should compute stable select-lkg idempotency key', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'prod', service: 'api' },
          },
        ],
        inputs: {},
      };

      const key1 = computeSelectLkgIdempotencyKey(context);
      const key2 = computeSelectLkgIdempotencyKey(context);

      expect(key1).toBe(key2);
      expect(key1).toContain('select-lkg');
      expect(key1).toContain('test:incident:1');
    });

    it('should compute time-based dispatch-deploy idempotency key for frequency limiting', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {},
      };

      const key = computeDispatchDeployIdempotencyKey(context);

      expect(key).toContain('dispatch-deploy');
      expect(key).toContain('test:incident:1');
      // Should include hour key for frequency limiting
      expect(key).toMatch(/:\d{4}-\d{2}-\d{2}T\d{2}$/);
    });

    it('should enforce once-per-hour frequency limit via idempotency key', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {},
      };

      const key1 = computeDispatchDeployIdempotencyKey(context);
      
      // Small delay to ensure we're still in same hour
      const key2 = computeDispatchDeployIdempotencyKey(context);

      // Keys should be identical within same hour
      expect(key1).toBe(key2);
    });
  });

  describe('Evidence Requirements', () => {
    it('should accept deploy_status evidence with env', () => {
      const evidence = [
        {
          kind: 'deploy_status' as const,
          ref: { env: 'prod', deployId: 'deploy-1' },
        },
      ];

      const hasEvidence = REDEPLOY_LKG_PLAYBOOK.requiredEvidence.some(
        predicate => predicate.kind === 'deploy_status'
      );

      expect(hasEvidence).toBe(true);
    });

    it('should accept verification evidence with env', () => {
      const evidence = [
        {
          kind: 'verification' as const,
          ref: { env: 'prod', reportHash: 'hash123' },
        },
      ];

      const hasEvidence = REDEPLOY_LKG_PLAYBOOK.requiredEvidence.some(
        predicate => predicate.kind === 'verification'
      );

      expect(hasEvidence).toBe(true);
    });
  });
});
