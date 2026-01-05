/**
 * Tests for Guardrail Gates Library (E79.4 / I794)
 * 
 * Validates:
 * - Deny-by-default behavior
 * - Deterministic verdict generation
 * - Transparent reasons and rule IDs
 * - All gate functions work correctly
 */

import {
  gatePlaybookAllowed,
  gateActionAllowed,
  gateEvidence,
  gateDeterminismRequired,
  gateIdempotencyKeyFormat,
  GateVerdict,
  computeInputsHash,
} from '../../src/lib/guardrail-gates';
import { createMinimalLawbook, LawbookV1 } from '../../src/lawbook/schema';

describe('Guardrail Gates Library', () => {
  describe('computeInputsHash', () => {
    it('should produce deterministic hash for same inputs', () => {
      const inputs1 = { a: 1, b: 2, c: 3 };
      const inputs2 = { c: 3, a: 1, b: 2 }; // Different order
      
      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });
    
    it('should produce different hash for different inputs', () => {
      const inputs1 = { a: 1, b: 2 };
      const inputs2 = { a: 1, b: 3 };
      
      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      
      expect(hash1).not.toBe(hash2);
    });
    
    it('should handle nested objects deterministically', () => {
      const inputs1 = { a: 1, b: { x: 10, y: 20 }, c: 3 };
      const inputs2 = { c: 3, b: { y: 20, x: 10 }, a: 1 }; // Different order at all levels
      
      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      
      expect(hash1).toBe(hash2);
    });
    
    it('should handle arrays in inputs', () => {
      const inputs1 = { a: [1, 2, 3], b: 'test' };
      const inputs2 = { b: 'test', a: [1, 2, 3] };
      
      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      
      expect(hash1).toBe(hash2);
    });
  });
  
  describe('gatePlaybookAllowed', () => {
    let lawbook: LawbookV1;
    
    beforeEach(() => {
      lawbook = createMinimalLawbook({
        remediation: {
          enabled: true,
          allowedPlaybooks: ['SAFE_RETRY_RUNNER', 'RERUN_VERIFICATION'],
          allowedActions: ['runner_dispatch', 'verification_run'],
          maxRunsPerIncident: 3,
          cooldownMinutes: 15,
        },
        evidence: {
          requiredKindsByCategory: {
            'workflow_failure': ['github_workflow_run', 'error_log'],
          },
        },
      });
    });
    
    describe('deny-by-default', () => {
      it('should DENY when no lawbook provided', () => {
        const verdict = gatePlaybookAllowed(
          { playbookId: 'SAFE_RETRY_RUNNER' },
          null
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.lawbookVersion).toBeNull();
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'LAWBOOK_MISSING',
            severity: 'ERROR',
          })
        );
      });
      
      it('should DENY when remediation disabled', () => {
        const disabledLawbook = createMinimalLawbook({
          remediation: {
            enabled: false,
            allowedPlaybooks: ['SAFE_RETRY_RUNNER'],
            allowedActions: [],
          },
        });
        
        const verdict = gatePlaybookAllowed(
          { playbookId: 'SAFE_RETRY_RUNNER' },
          disabledLawbook
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'REMEDIATION_DISABLED',
            ruleId: 'remediation.enabled',
            severity: 'ERROR',
          })
        );
      });
      
      it('should DENY when playbook not in allowed list', () => {
        const verdict = gatePlaybookAllowed(
          { playbookId: 'UNKNOWN_PLAYBOOK' },
          lawbook
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'PLAYBOOK_NOT_ALLOWED',
            ruleId: 'remediation.allowedPlaybooks',
            severity: 'ERROR',
          })
        );
      });
    });
    
    describe('evidence gating', () => {
      it('should DENY when required evidence missing', () => {
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            incidentCategory: 'workflow_failure',
            evidenceKinds: ['github_workflow_run'], // Missing error_log
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'EVIDENCE_MISSING',
            message: expect.stringContaining('error_log'),
            ruleId: 'evidence.requiredKindsByCategory.workflow_failure',
            severity: 'ERROR',
          })
        );
      });
      
      it('should ALLOW when all required evidence present', () => {
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            incidentCategory: 'workflow_failure',
            evidenceKinds: ['github_workflow_run', 'error_log'],
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('maxRunsPerIncident policy', () => {
      it('should DENY when max runs exceeded', () => {
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            currentRunCount: 3,
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'MAX_RUNS_EXCEEDED',
            ruleId: 'remediation.maxRunsPerIncident',
            severity: 'ERROR',
          })
        );
      });
      
      it('should ALLOW when under max runs', () => {
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            currentRunCount: 2,
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('cooldown policy', () => {
      it('should DENY when cooldown active', () => {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            lastRunTimestamp: fiveMinutesAgo,
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'COOLDOWN_ACTIVE',
            ruleId: 'remediation.cooldownMinutes',
            severity: 'ERROR',
          })
        );
      });
      
      it('should ALLOW when cooldown expired', () => {
        const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        
        const verdict = gatePlaybookAllowed(
          {
            playbookId: 'SAFE_RETRY_RUNNER',
            lastRunTimestamp: twentyMinutesAgo,
          },
          lawbook
        );
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('determinism', () => {
      it('should produce deterministic verdicts for same inputs', () => {
        const params1 = { playbookId: 'SAFE_RETRY_RUNNER' };
        const params2 = { playbookId: 'SAFE_RETRY_RUNNER' };
        
        const verdict1 = gatePlaybookAllowed(params1, lawbook);
        const verdict2 = gatePlaybookAllowed(params2, lawbook);
        
        expect(verdict1.inputsHash).toBe(verdict2.inputsHash);
        expect(verdict1.verdict).toBe(verdict2.verdict);
        // Reasons should be sorted consistently
        expect(verdict1.reasons).toEqual(verdict2.reasons);
      });
    });
    
    it('should include lawbookVersion in verdict', () => {
      const verdict = gatePlaybookAllowed(
        { playbookId: 'SAFE_RETRY_RUNNER' },
        lawbook
      );
      
      expect(verdict.lawbookVersion).toBe(lawbook.lawbookVersion);
    });
    
    it('should include generatedAt timestamp', () => {
      const verdict = gatePlaybookAllowed(
        { playbookId: 'SAFE_RETRY_RUNNER' },
        lawbook
      );
      
      expect(verdict.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
  
  describe('gateActionAllowed', () => {
    let lawbook: LawbookV1;
    
    beforeEach(() => {
      lawbook = createMinimalLawbook({
        remediation: {
          enabled: true,
          allowedPlaybooks: [],
          allowedActions: ['runner_dispatch', 'verification_run', 'ecs_force_new_deploy'],
        },
      });
    });
    
    it('should DENY when no lawbook provided', () => {
      const verdict = gateActionAllowed(
        { actionType: 'runner_dispatch' },
        null
      );
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.lawbookVersion).toBeNull();
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'LAWBOOK_MISSING',
          severity: 'ERROR',
        })
      );
    });
    
    it('should DENY when action not in allowed list', () => {
      const verdict = gateActionAllowed(
        { actionType: 'dangerous_action' },
        lawbook
      );
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'ACTION_NOT_ALLOWED',
          ruleId: 'remediation.allowedActions',
          severity: 'ERROR',
        })
      );
    });
    
    it('should ALLOW when action in allowed list', () => {
      const verdict = gateActionAllowed(
        { actionType: 'runner_dispatch' },
        lawbook
      );
      
      expect(verdict.verdict).toBe('ALLOW');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'ACTION_ALLOWED',
          severity: 'INFO',
        })
      );
    });
    
    it('should produce deterministic verdicts', () => {
      const verdict1 = gateActionAllowed({ actionType: 'runner_dispatch' }, lawbook);
      const verdict2 = gateActionAllowed({ actionType: 'runner_dispatch' }, lawbook);
      
      expect(verdict1.inputsHash).toBe(verdict2.inputsHash);
      expect(verdict1.verdict).toBe(verdict2.verdict);
    });
  });
  
  describe('gateEvidence', () => {
    it('should DENY when required evidence missing', () => {
      const verdict = gateEvidence({
        requiredKinds: ['github_workflow_run', 'error_log', 'stack_trace'],
        presentKinds: ['github_workflow_run'],
      });
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'EVIDENCE_MISSING',
          severity: 'ERROR',
        })
      );
      // Check that missing kinds are sorted deterministically
      const message = verdict.reasons[0].message;
      expect(message).toContain('error_log');
      expect(message).toContain('stack_trace');
    });
    
    it('should ALLOW when all evidence present', () => {
      const verdict = gateEvidence({
        requiredKinds: ['github_workflow_run', 'error_log'],
        presentKinds: ['github_workflow_run', 'error_log', 'stack_trace'],
      });
      
      expect(verdict.verdict).toBe('ALLOW');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'EVIDENCE_SATISFIED',
          severity: 'INFO',
        })
      );
    });
    
    it('should produce deterministic verdicts with sorted missing kinds', () => {
      // Test with different order of missing kinds
      const verdict1 = gateEvidence({
        requiredKinds: ['a', 'b', 'c'],
        presentKinds: [],
      });
      const verdict2 = gateEvidence({
        requiredKinds: ['c', 'a', 'b'],
        presentKinds: [],
      });
      
      // Even though input order is different, missing kinds should be sorted
      expect(verdict1.reasons[0].message).toBe(verdict2.reasons[0].message);
    });
    
    it('should not require lawbook', () => {
      const verdict = gateEvidence({
        requiredKinds: [],
        presentKinds: [],
      });
      
      expect(verdict.lawbookVersion).toBeNull();
    });
  });
  
  describe('gateDeterminismRequired', () => {
    let lawbook: LawbookV1;
    
    beforeEach(() => {
      lawbook = createMinimalLawbook({
        determinism: {
          requireDeterminismGate: true,
          requirePostDeployVerification: true,
        },
      });
    });
    
    it('should DENY when no lawbook provided', () => {
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: true, determinismReportStatus: 'PASS' },
        null
      );
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.lawbookVersion).toBeNull();
    });
    
    it('should ALLOW when determinism not required', () => {
      const noGateLawbook = createMinimalLawbook({
        determinism: {
          requireDeterminismGate: false,
          requirePostDeployVerification: false,
        },
      });
      
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: false },
        noGateLawbook
      );
      
      expect(verdict.verdict).toBe('ALLOW');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'DETERMINISM_NOT_REQUIRED',
        })
      );
    });
    
    it('should HOLD when determinism required but report missing', () => {
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: false },
        lawbook
      );
      
      expect(verdict.verdict).toBe('HOLD');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'DETERMINISM_REPORT_MISSING',
          ruleId: 'determinism.requireDeterminismGate',
          severity: 'ERROR',
        })
      );
    });
    
    it('should HOLD when report pending', () => {
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: true, determinismReportStatus: 'PENDING' },
        lawbook
      );
      
      expect(verdict.verdict).toBe('HOLD');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'DETERMINISM_REPORT_PENDING',
          severity: 'WARNING',
        })
      );
    });
    
    it('should DENY when report failed', () => {
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: true, determinismReportStatus: 'FAIL' },
        lawbook
      );
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'DETERMINISM_REPORT_FAILED',
          severity: 'ERROR',
        })
      );
    });
    
    it('should ALLOW when report passed', () => {
      const verdict = gateDeterminismRequired(
        { hasDeterminismReport: true, determinismReportStatus: 'PASS' },
        lawbook
      );
      
      expect(verdict.verdict).toBe('ALLOW');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'DETERMINISM_REPORT_PASSED',
          severity: 'INFO',
        })
      );
    });
    
    it('should produce deterministic verdicts', () => {
      const params = { hasDeterminismReport: true, determinismReportStatus: 'PASS' as const };
      const verdict1 = gateDeterminismRequired(params, lawbook);
      const verdict2 = gateDeterminismRequired(params, lawbook);
      
      expect(verdict1.inputsHash).toBe(verdict2.inputsHash);
      expect(verdict1.verdict).toBe(verdict2.verdict);
    });
  });
  
  describe('gateIdempotencyKeyFormat', () => {
    it('should DENY when key too long', () => {
      const longKey = 'a'.repeat(257);
      const verdict = gateIdempotencyKeyFormat({ key: longKey });
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'KEY_TOO_LONG',
          severity: 'ERROR',
        })
      );
    });
    
    it('should DENY when key contains invalid characters', () => {
      const verdict = gateIdempotencyKeyFormat({ key: 'key with spaces' });
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'KEY_INVALID_CHARS',
          severity: 'ERROR',
        })
      );
    });
    
    it('should DENY when key contains special characters', () => {
      const verdict = gateIdempotencyKeyFormat({ key: 'key@with#special$chars' });
      
      expect(verdict.verdict).toBe('DENY');
    });
    
    it('should ALLOW valid alphanumeric key', () => {
      const verdict = gateIdempotencyKeyFormat({ key: 'validKey123' });
      
      expect(verdict.verdict).toBe('ALLOW');
      expect(verdict.reasons).toContainEqual(
        expect.objectContaining({
          code: 'KEY_FORMAT_VALID',
          severity: 'INFO',
        })
      );
    });
    
    it('should ALLOW key with hyphens, underscores, and colons', () => {
      const verdict = gateIdempotencyKeyFormat({ key: 'valid-key_123:abc' });
      
      expect(verdict.verdict).toBe('ALLOW');
    });
    
    it('should respect custom maxLength', () => {
      const verdict = gateIdempotencyKeyFormat({
        key: 'a'.repeat(50),
        maxLength: 40,
      });
      
      expect(verdict.verdict).toBe('DENY');
      expect(verdict.reasons[0].message).toContain('40');
    });
    
    it('should produce deterministic verdicts', () => {
      const verdict1 = gateIdempotencyKeyFormat({ key: 'test-key-123' });
      const verdict2 = gateIdempotencyKeyFormat({ key: 'test-key-123' });
      
      expect(verdict1.inputsHash).toBe(verdict2.inputsHash);
      expect(verdict1.verdict).toBe(verdict2.verdict);
    });
    
    it('should not require lawbook', () => {
      const verdict = gateIdempotencyKeyFormat({ key: 'valid-key' });
      
      expect(verdict.lawbookVersion).toBeNull();
    });
  });
  
  describe('GateVerdict schema', () => {
    it('should have deterministic reason ordering', () => {
      // Create a lawbook without required evidence for incident category
      const lawbook = createMinimalLawbook();
      
      const verdict = gatePlaybookAllowed(
        { playbookId: 'SAFE_RETRY_RUNNER' },
        lawbook
      );
      
      // Reasons should be sorted by code
      const codes = verdict.reasons.map(r => r.code);
      const sortedCodes = [...codes].sort();
      expect(codes).toEqual(sortedCodes);
    });
  });
});
