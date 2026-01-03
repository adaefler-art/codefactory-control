/**
 * RERUN_POST_DEPLOY_VERIFICATION Hardening Tests (E77.2)
 * 
 * Tests for hardening requirements:
 * - Environment normalization (prod/production, stage/staging)
 * - MITIGATED semantics (only when env matches)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeIngestIncidentUpdate,
} from '@/lib/playbooks/rerun-post-deploy-verification';
import { StepContext } from '@/lib/contracts/remediation-playbook';
import * as incidentsDb from '@/lib/db/incidents';

// Mock the incidents DB
jest.mock('@/lib/db/incidents');

const mockPool = {} as Pool;

describe('RERUN_POST_DEPLOY_VERIFICATION Hardening', () => {
  let mockIncidentDAO: any;

  beforeEach(() => {
    mockIncidentDAO = {
      getIncident: jest.fn(),
      getEvidence: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      addEvidence: jest.fn().mockResolvedValue(undefined),
    };
    (incidentsDb.getIncidentDAO as jest.Mock).mockReturnValue(mockIncidentDAO);
    jest.clearAllMocks();
  });

  describe('Environment Normalization', () => {
    it('should normalize prod/production to prod', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'production' }, // Production (should normalize to prod)
        },
      ]);

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
            env: 'prod', // prod (normalized)
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });

    it('should normalize stage/staging to stage', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'staging' }, // Staging (should normalize to stage)
        },
      ]);

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
            env: 'stage', // stage (normalized)
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });
  });

  describe('MITIGATED Semantics - Environment Matching', () => {
    it('should NOT mark MITIGATED when verification env differs from incident env', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'prod' }, // Incident is for prod
        },
      ]);

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
            env: 'stage', // Verification is for stage (different!)
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.currentStatus).toBe('unchanged');
      expect(result.output?.envMismatch).toBe(true);
      expect(result.output?.message).toContain('not marking MITIGATED');
      expect(result.output?.incidentEnv).toBe('prod');
      expect(result.output?.verificationEnv).toBe('stage');
      
      // Verify incident was NOT updated
      expect(mockIncidentDAO.updateStatus).not.toHaveBeenCalled();
      expect(mockIncidentDAO.addEvidence).not.toHaveBeenCalled();
    });

    it('should mark MITIGATED when verification env matches incident env', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'prod' }, // Incident is for prod
        },
      ]);

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
            env: 'prod', // Verification is also for prod (match!)
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(result.output?.env).toBe('prod');
      
      // Verify incident WAS updated
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
      expect(mockIncidentDAO.addEvidence).toHaveBeenCalled();
    });

    it('should mark MITIGATED when verification env matches (with normalization)', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'production' }, // Incident uses 'production'
        },
      ]);

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
            env: 'prod', // Verification uses 'prod' (same after normalization)
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(result.output?.env).toBe('prod');
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });

    it('should mark MITIGATED when incident env is unknown (backward compatibility)', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      // No deploy_status evidence, so incident env is unknown
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'log_pointer',
          ref: {},
        },
      ]);

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
            env: 'prod',
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      // When incident env is unknown, we allow MITIGATED (backward compatibility)
      expect(result.success).toBe(true);
      expect(result.output?.newStatus).toBe('MITIGATED');
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
    });

    it('should fail when verification env is invalid/unknown', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([]);

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
            env: 'unknown-env', // Invalid environment
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_VERIFICATION_ENV');
      expect(mockIncidentDAO.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('Explicit PASS Requirement', () => {
    it('should NOT mark MITIGATED when verification status is not success', async () => {
      mockIncidentDAO.getIncident.mockResolvedValue({
        id: 'incident-1',
        incident_key: 'test:incident:1',
        status: 'OPEN',
      });
      
      mockIncidentDAO.getEvidence.mockResolvedValue([
        {
          kind: 'deploy_status',
          ref: { env: 'prod' },
        },
      ]);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          verificationStepOutput: {
            status: 'failed', // Failed (not success)
            playbookRunId: 'playbook-run-1',
            reportHash: 'abc123',
            env: 'prod',
            deployId: 'deploy-123',
          },
        },
      };

      const result = await executeIngestIncidentUpdate(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.currentStatus).toBe('unchanged');
      expect(mockIncidentDAO.updateStatus).not.toHaveBeenCalled();
    });
  });
});
