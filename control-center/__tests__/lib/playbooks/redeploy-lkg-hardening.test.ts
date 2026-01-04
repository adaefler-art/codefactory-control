/**
 * REDEPLOY_LKG Playbook Hardening Tests (E77.3)
 * 
 * Tests for hardening requirements:
 * 1. Deterministic redeploy pinning (imageDigest required)
 * 2. Policy enforcement (I711 repo allowlist)
 * 3. Secrets/tokens sanitization
 * 4. Environment semantics (canonical normalization)
 * 5. Frequency limiting correctness (env-scoped)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeSelectLkg,
  executeDispatchDeploy,
  executeUpdateDeployStatus,
  computeDispatchDeployIdempotencyKey,
} from '@/lib/playbooks/redeploy-lkg';
import { StepContext, sanitizeRedact } from '@/lib/contracts/remediation-playbook';
import * as deployStatusDb from '@/lib/db/deployStatusSnapshots';
import * as incidentsDb from '@/lib/db/incidents';
import * as authWrapper from '@/lib/github/auth-wrapper';

// Mock the database modules and auth wrapper
jest.mock('@/lib/db/deployStatusSnapshots');
jest.mock('@/lib/db/incidents');
jest.mock('@/lib/github/auth-wrapper');

const mockPool = {} as Pool;

describe('REDEPLOY_LKG Hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================
  // HARDENING 1: Deterministic Redeploy Pinning
  // ========================================
  
  describe('1. Deterministic Redeploy Pinning', () => {
    it('should require immutable artifact pin (imageDigest or cfnChangeSetId)', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      // LKG with only commit_hash (no imageDigest or cfnChangeSetId)
      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: {
          snapshotId: 'snap-1',
          deployEventId: 'deploy-1',
          env: 'production',
          service: 'api',
          version: 'v1.2.3',
          commitHash: 'abc123def456', // Only commit_hash
          imageDigest: null, // Missing immutable pin
          imageDigests: null, // Missing per-container digests
          cfnChangeSetId: null, // Missing immutable pin
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
      expect(result.error?.code).toBe('DETERMINISM_REQUIRED');
      expect(result.error?.message).toContain('immutable artifact pin');
    });

    it('should accept LKG with imageDigest (immutable)', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: {
          snapshotId: 'snap-1',
          deployEventId: 'deploy-1',
          env: 'production',
          service: 'api',
          version: 'v1.2.3',
          commitHash: 'abc123def456',
          imageDigest: 'sha256:abcd1234...', // Immutable pin
          imageDigests: null,
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

      expect(result.success).toBe(true);
      expect(result.output?.lkg.imageDigest).toBe('sha256:abcd1234...');
    });

    it('should REJECT LKG with only cfnChangeSetId (may reference mutable tags)', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: {
          snapshotId: 'snap-1',
          deployEventId: 'deploy-1',
          env: 'production',
          service: 'api',
          version: 'v1.2.3',
          commitHash: null,
          imageDigest: null, // No imageDigest
          imageDigests: null, // No per-container digests
          cfnChangeSetId: 'arn:aws:cloudformation:...', // CFN alone insufficient
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

      // REJECT: cfnChangeSetId may reference mutable tags like :latest
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DETERMINISM_REQUIRED');
      expect(result.error?.message).toContain('cfnChangeSetId but no imageDigest');
      expect(result.error?.message).toContain('mutable tags');
    });
    
    it('should accept LKG with imageDigests array (per-container, preferred)', async () => {
      const mockFindLastKnownGood = deployStatusDb.findLastKnownGood as jest.MockedFunction<
        typeof deployStatusDb.findLastKnownGood
      >;

      mockFindLastKnownGood.mockResolvedValue({
        success: true,
        lkg: {
          snapshotId: 'snap-1',
          deployEventId: 'deploy-1',
          env: 'production',
          service: 'api',
          version: 'v1.2.3',
          commitHash: 'abc123',
          imageDigest: null,
          imageDigests: null,
          imageDigests: ['sha256:abc111', 'sha256:abc222'], // Complete per-container digests
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

      expect(result.success).toBe(true);
      expect(result.output?.lkg.imageDigests).toEqual(['sha256:abc111', 'sha256:abc222']);
    });
  });

  // ========================================
  // HARDENING 2: Policy Enforcement (I711)
  // ========================================
  
  describe('2. Policy Enforcement (I711 Repo Allowlist)', () => {
    it('should enforce repo allowlist before dispatch', async () => {
      const mockIsRepoAllowed = authWrapper.isRepoAllowed as jest.MockedFunction<
        typeof authWrapper.isRepoAllowed
      >;

      mockIsRepoAllowed.mockReturnValue(false); // Repo not allowed

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          owner: 'untrusted',
          repo: 'malicious-repo',
          lkgStepOutput: {
            lkg: {
              snapshotId: 'snap-1',
              deployEventId: 'deploy-1',
              env: 'production',
              service: 'api',
              version: 'v1.2.3',
              commitHash: 'abc123',
              imageDigest: 'sha256:abcd1234',
              imageDigests: null,
              cfnChangeSetId: null,
              observedAt: '2025-01-01T00:00:00Z',
              verificationRunId: 'ver-1',
              verificationReportHash: 'hash123',
            },
          },
        },
      };

      const result = await executeDispatchDeploy(mockPool, context);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REPO_NOT_ALLOWED');
      expect(mockIsRepoAllowed).toHaveBeenCalledWith('untrusted', 'malicious-repo');
    });

    it('should allow dispatch when repo is in allowlist', async () => {
      const mockIsRepoAllowed = authWrapper.isRepoAllowed as jest.MockedFunction<
        typeof authWrapper.isRepoAllowed
      >;

      mockIsRepoAllowed.mockReturnValue(true); // Repo allowed

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          owner: 'trusted',
          repo: 'approved-repo',
          lkgStepOutput: {
            lkg: {
              snapshotId: 'snap-1',
              deployEventId: 'deploy-1',
              env: 'production',
              service: 'api',
              version: 'v1.2.3',
              commitHash: 'abc123',
              imageDigest: 'sha256:abcd1234',
              imageDigests: null,
              cfnChangeSetId: null,
              observedAt: '2025-01-01T00:00:00Z',
              verificationRunId: 'ver-1',
              verificationReportHash: 'hash123',
            },
          },
        },
      };

      const result = await executeDispatchDeploy(mockPool, context);

      expect(result.success).toBe(true);
      expect(mockIsRepoAllowed).toHaveBeenCalledWith('trusted', 'approved-repo');
    });
  });

  // ========================================
  // HARDENING 3: Secrets/Tokens Sanitization
  // ========================================
  
  describe('3. Secrets/Tokens Sanitization', () => {
    it('should not persist URLs with tokens in dispatch output', async () => {
      const mockIsRepoAllowed = authWrapper.isRepoAllowed as jest.MockedFunction<
        typeof authWrapper.isRepoAllowed
      >;
      mockIsRepoAllowed.mockReturnValue(true);

      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [],
        inputs: {
          lkgStepOutput: {
            lkg: {
              snapshotId: 'snap-1',
              deployEventId: 'deploy-1',
              env: 'production',
              service: 'api',
              version: 'v1.2.3',
              commitHash: 'abc123',
              imageDigest: 'sha256:abcd1234',
              imageDigests: null,
              cfnChangeSetId: null,
              observedAt: '2025-01-01T00:00:00Z',
              verificationRunId: 'ver-1',
              verificationReportHash: 'hash123',
            },
          },
        },
      };

      const result = await executeDispatchDeploy(mockPool, context);

      expect(result.success).toBe(true);
      const outputStr = JSON.stringify(result.output);
      
      // No URLs with query strings (potential tokens)
      expect(outputStr).not.toMatch(/https:\/\/.*\?/);
      
      // No sensitive field names
      expect(outputStr).not.toMatch(/(token|secret|password|key|authorization|cookie|bearer|signature)/i);
      
      // Contains only safe fields
      expect(result.output).toHaveProperty('dispatchId');
      expect(result.output).toHaveProperty('env');
      expect(result.output).toHaveProperty('service');
      expect(result.output).toHaveProperty('timestamp');
    });

    it('should sanitize URLs with query strings using sanitizeRedact', () => {
      const input = {
        logsUrl: 'https://api.github.com/repos/owner/repo/actions/runs/123/logs?token=abc123',
        downloadUrl: 'https://example.com/artifacts?key=secret123',
        safeUrl: 'https://example.com/artifacts',
        runId: '12345',
      };

      const result = sanitizeRedact(input);

      expect(result.logsUrl).toBe('********');
      expect(result.downloadUrl).toBe('********');
      expect(result.safeUrl).toBe('https://example.com/artifacts'); // No query string, safe
      expect(result.runId).toBe('12345');
    });

    it('should sanitize signature field names', () => {
      const input = {
        signature: 'some-signature-value',
        data: 'safe-data',
      };

      const result = sanitizeRedact(input);

      expect(result.signature).toBe('********');
      expect(result.data).toBe('safe-data');
    });
  });

  // ========================================
  // HARDENING 4: Environment Semantics
  // ========================================
  
  describe('4. Environment Semantics (Canonical Normalization)', () => {
    it('should not mark MITIGATED if verification env differs from incident env', async () => {
      const mockIncidentDAO = {
        getIncident: jest.fn().mockResolvedValue({
          id: 'incident-1',
          incident_key: 'test:incident:1',
        }),
        getEvidence: jest.fn().mockResolvedValue([
          {
            kind: 'deploy_status',
            ref: { env: 'staging' }, // Incident is for staging
          },
        ]),
        updateStatus: jest.fn(),
        addEvidence: jest.fn(),
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
            env: 'production', // Verification is for production
            dispatchId: 'dispatch-1',
          },
        },
      };

      const result = await executeUpdateDeployStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(result.output?.envMismatch).toBe(true);
      expect(mockIncidentDAO.updateStatus).not.toHaveBeenCalled();
      expect(result.output?.message).toContain('not marking MITIGATED');
    });

    it('should mark MITIGATED when envs match after normalization', async () => {
      const mockIncidentDAO = {
        getIncident: jest.fn().mockResolvedValue({
          id: 'incident-1',
          incident_key: 'test:incident:1',
        }),
        getEvidence: jest.fn().mockResolvedValue([
          {
            kind: 'deploy_status',
            ref: { env: 'prod' }, // Normalized to 'production'
          },
        ]),
        updateStatus: jest.fn(),
        addEvidence: jest.fn(),
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
            env: 'production', // Verification is for production
            dispatchId: 'dispatch-1',
          },
        },
      };

      const result = await executeUpdateDeployStatus(mockPool, context);

      expect(result.success).toBe(true);
      expect(mockIncidentDAO.updateStatus).toHaveBeenCalledWith('incident-1', 'MITIGATED');
      expect(result.output?.message).toContain('marked MITIGATED');
    });
  });

  // ========================================
  // HARDENING 5: Frequency Limiting Correctness
  // ========================================
  
  describe('5. Frequency Limiting (Env-Scoped)', () => {
    it('should include env in idempotency key to avoid cross-env blocking', () => {
      const contextProd: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'production' },
          },
        ],
        inputs: {},
      };

      const contextStage: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-2',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'staging' },
          },
        ],
        inputs: {},
      };

      const keyProd = computeDispatchDeployIdempotencyKey(contextProd);
      const keyStage = computeDispatchDeployIdempotencyKey(contextStage);

      // Keys should differ by environment
      expect(keyProd).not.toBe(keyStage);
      expect(keyProd).toContain('production');
      expect(keyStage).toContain('staging');
    });

    it('should use same key within same hour for same incident+env', () => {
      const context: StepContext = {
        incidentId: 'incident-1',
        incidentKey: 'test:incident:1',
        runId: 'run-1',
        lawbookVersion: 'v1',
        evidence: [
          {
            kind: 'deploy_status',
            ref: { env: 'production' },
          },
        ],
        inputs: {},
      };

      const key1 = computeDispatchDeployIdempotencyKey(context);
      const key2 = computeDispatchDeployIdempotencyKey(context);

      // Same incident + env + hour = same key
      expect(key1).toBe(key2);
    });
  });
});
