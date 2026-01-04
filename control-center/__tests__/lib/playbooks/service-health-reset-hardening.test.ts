/**
 * SERVICE_HEALTH_RESET Hardening Tests (E77.4)
 * 
 * Tests for hardening requirements:
 * - Target allowlist enforcement (cluster+service per environment)
 * - Deterministic ALB evidence mapping (no heuristics)
 * - Canonical environment matching for MITIGATED status
 * - Frequency limiting (hourly idempotency)
 * - Secret sanitization (no URLs with query strings or tokens in outputs)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeSnapshotState,
  executeApplyReset,
  executeUpdateStatus,
  computeResetIdempotencyKey,
} from '@/lib/playbooks/service-health-reset';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as ecsAdapter from '@/lib/ecs/adapter';
import * as incidentsDb from '@/lib/db/incidents';

// Mock the ECS adapter and incidents DB
jest.mock('@/lib/ecs/adapter');
jest.mock('@/lib/db/incidents');

const mockPool = {
  query: jest.fn(),
} as unknown as Pool;

describe('SERVICE_HEALTH_RESET Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Target Allowlist Enforcement', () => {
    it('should deny target not in allowlist', async () => {
      // Mock lawbook query to return empty (no allowlist)
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

      (ecsAdapter.forceNewDeployment as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          code: 'TARGET_NOT_ALLOWED',
          message: 'ECS target {cluster: prod-cluster, service: api-service} is not allowlisted for environment production',
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
            cluster: 'prod-cluster',
            service: 'api-service',
            env: 'production',
          },
        },
      };

      const result = await executeApplyReset(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TARGET_NOT_ALLOWED');
      expect(ecsAdapter.forceNewDeployment).toHaveBeenCalledWith(mockPool, expect.objectContaining({
        cluster: 'prod-cluster',
        service: 'api-service',
        env: 'production',
      }));
    });

    it('should allow target in allowlist', async () => {
      // Mock lawbook query to return allowlist
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [
          { key: 'ecs_allowed_clusters_production', value: ['prod-cluster'] },
          { key: 'ecs_allowed_services_production', value: ['api-service'] },
        ],
      });

      (ecsAdapter.forceNewDeployment as jest.Mock).mockResolvedValue({
        success: true,
        serviceArn: 'arn:aws:ecs:us-east-1:123:service/prod-cluster/api-service',
        deploymentId: 'deploy-123',
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            cluster: 'prod-cluster',
            service: 'api-service',
            env: 'production',
          },
        },
      };

      const result = await executeApplyReset(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should require environment for allowlist validation', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            cluster: 'prod-cluster',
            service: 'api-service',
            // Missing env
          },
        },
      };

      const result = await executeApplyReset(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENVIRONMENT_REQUIRED');
      expect(ecsAdapter.forceNewDeployment).not.toHaveBeenCalled();
    });
  });

  describe('Deterministic ALB Evidence Mapping', () => {
    it('should fail-close when ALB evidence lacks cluster/service and no mapping', async () => {
      // Mock lawbook query to return empty (no mapping)
      (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'alb',
            ref: {
              targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/abc',
              env: 'production',
              // Missing cluster and service
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ALB_MAPPING_REQUIRED');
      expect(result.error?.message).toContain('No lawbook mapping found');
      expect(ecsAdapter.describeService).not.toHaveBeenCalled();
    });

    it('should use lawbook mapping for ALB evidence', async () => {
      // Mock lawbook query to return mapping
      (mockPool.query as jest.Mock).mockResolvedValue({
        rows: [
          {
            key: 'alb_to_ecs_mapping_production',
            value: {
              'arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/abc': {
                cluster: 'prod-cluster',
                service: 'api-service',
              },
            },
          },
        ],
      });

      (ecsAdapter.describeService as jest.Mock).mockResolvedValue({
        success: true,
        service: {
          serviceArn: 'arn:aws:ecs:us-east-1:123:service/prod-cluster/api-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123:cluster/prod-cluster',
          desiredCount: 2,
          runningCount: 2,
          taskDefinition: 'task:1',
          deployments: [],
        },
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'alb',
            ref: {
              targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/abc',
              env: 'production',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.cluster).toBe('prod-cluster');
      expect(result.output?.service).toBe('api-service');
      expect(ecsAdapter.describeService).toHaveBeenCalledWith('prod-cluster', 'api-service');
    });

    it('should accept ALB evidence with explicit cluster/service (no mapping needed)', async () => {
      (ecsAdapter.describeService as jest.Mock).mockResolvedValue({
        success: true,
        service: {
          serviceArn: 'arn:aws:ecs:us-east-1:123:service/prod-cluster/api-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123:cluster/prod-cluster',
          desiredCount: 2,
          runningCount: 2,
          taskDefinition: 'task:1',
          deployments: [],
        },
      });

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'alb',
            ref: {
              targetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/abc',
              cluster: 'prod-cluster',
              service: 'api-service',
              env: 'production',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.cluster).toBe('prod-cluster');
      expect(result.output?.service).toBe('api-service');
      // Should not query lawbook for mapping
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  describe('Canonical Environment Semantics', () => {
    it('should require environment for snapshot', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'ecs',
            ref: {
              cluster: 'prod-cluster',
              service: 'api-service',
              // Missing env
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ENVIRONMENT_REQUIRED');
    });

    it('should normalize environment aliases (prod -> production)', async () => {
      (ecsAdapter.describeService as jest.Mock).mockResolvedValue({
        success: true,
        service: {
          serviceArn: 'arn:aws:ecs:us-east-1:123:service/prod-cluster/api-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123:cluster/prod-cluster',
          desiredCount: 2,
          runningCount: 2,
          taskDefinition: 'task:1',
          deployments: [],
        },
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
              cluster: 'prod-cluster',
              service: 'api-service',
              env: 'prod', // Alias
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.env).toBe('production'); // Normalized
    });

    it('should only mark MITIGATED when verification env matches target env', async () => {
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
          snapshotOutput: {
            env: 'production',
          },
          observeOutput: {
            stable: true,
          },
          verificationOutput: {
            status: 'success',
            env: 'production', // Matches
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.incidentStatus).toBe('MITIGATED');
      expect(result.output?.envMatches).toBe(true);
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });

    it('should not mark MITIGATED when verification env does not match', async () => {
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
          snapshotOutput: {
            env: 'production',
          },
          observeOutput: {
            stable: true,
          },
          verificationOutput: {
            status: 'success',
            env: 'staging', // Does not match
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.incidentStatus).toBe('ACKED'); // Not MITIGATED
      expect(result.output?.envMatches).toBe(false);
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'ACKED');
    });

    it('should handle environment alias matching (prod vs production)', async () => {
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
          snapshotOutput: {
            env: 'prod', // Alias
          },
          observeOutput: {
            stable: true,
          },
          verificationOutput: {
            status: 'success',
            env: 'production', // Canonical
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.incidentStatus).toBe('MITIGATED'); // Should match after normalization
      expect(result.output?.envMatches).toBe(true);
    });

    it('should fail-close on invalid verification env', async () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            env: 'production',
          },
          observeOutput: {
            stable: true,
          },
          verificationOutput: {
            status: 'success',
            env: 'invalid-env', // Invalid
          },
        },
      };

      const result = await executeUpdateStatus(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_ENV');
    });
  });

  describe('Frequency Limiting', () => {
    it('should include hour key in reset idempotency key', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            env: 'production',
          },
        },
      };

      const key1 = computeResetIdempotencyKey(context);
      const key2 = computeResetIdempotencyKey(context);

      // Should be consistent within same call
      expect(key1).toBe(key2);
      
      // Should include incident key, env, and hour
      expect(key1).toContain('test:incident:1');
      expect(key1).toContain('production');
      expect(key1).toContain('reset');
      
      // Should include hour key (YYYY-MM-DD-HH format)
      expect(key1).toMatch(/\d{4}-\d{2}-\d{2}-\d{2}/);
    });

    it('should generate different keys for different environments', () => {
      const context1: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          snapshotOutput: {
            env: 'production',
          },
        },
      };

      const context2: StepContext = {
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

      const key1 = computeResetIdempotencyKey(context1);
      const key2 = computeResetIdempotencyKey(context2);

      expect(key1).not.toBe(key2);
      expect(key1).toContain('production');
      expect(key2).toContain('staging');
    });
  });

  describe('Secret Sanitization', () => {
    it('should sanitize outputs to prevent token persistence', async () => {
      (ecsAdapter.describeService as jest.Mock).mockResolvedValue({
        success: true,
        service: {
          serviceArn: 'arn:aws:ecs:us-east-1:123:service/prod-cluster/api-service',
          clusterArn: 'arn:aws:ecs:us-east-1:123:cluster/prod-cluster',
          desiredCount: 2,
          runningCount: 2,
          taskDefinition: 'task:1',
          deployments: [],
        },
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
              cluster: 'prod-cluster',
              service: 'api-service',
              env: 'production',
            },
          },
        ],
        inputs: {},
      };

      const result = await executeSnapshotState(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      
      // Verify output doesn't contain URLs with query strings
      const outputStr = JSON.stringify(result.output);
      expect(outputStr).not.toMatch(/https?:\/\/.*\?/);
    });
  });
});
