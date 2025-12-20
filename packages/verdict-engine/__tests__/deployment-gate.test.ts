/**
 * AFU-9 Deployment Gate Tests
 * 
 * Issue B3: Verdict als Gate vor Deploy
 * 
 * Tests for deployment gating logic to ensure:
 * - Only GREEN verdicts allow deployment
 * - RED, HOLD, RETRY verdicts block deployment
 * - Clear error messages explain why deployment is blocked
 */

import {
  checkDeploymentGate,
  validateDeploymentGate,
  isDeploymentAllowed,
  getDeploymentStatus,
  DeploymentGateResult,
} from '../src/deployment-gate';
import {
  VerdictType,
  SimpleVerdict,
  SimpleAction,
  Verdict,
} from '../src/types';

describe('Deployment Gate', () => {
  describe('checkDeploymentGate', () => {
    describe('with SimpleVerdict', () => {
      it('should allow deployment for GREEN verdict', () => {
        const result = checkDeploymentGate(SimpleVerdict.GREEN);
        
        expect(result.allowed).toBe(true);
        expect(result.verdict).toBe(SimpleVerdict.GREEN);
        expect(result.action).toBe(SimpleAction.ADVANCE);
        expect(result.reason).toContain('Deployment allowed');
        expect(result.reason).toContain('GREEN');
      });

      it('should block deployment for RED verdict', () => {
        const result = checkDeploymentGate(SimpleVerdict.RED);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RED);
        expect(result.action).toBe(SimpleAction.ABORT);
        expect(result.reason).toContain('BLOCKED');
        expect(result.reason).toContain('RED');
        expect(result.reason).toContain('ABORT');
      });

      it('should block deployment for HOLD verdict', () => {
        const result = checkDeploymentGate(SimpleVerdict.HOLD);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.HOLD);
        expect(result.action).toBe(SimpleAction.FREEZE);
        expect(result.reason).toContain('BLOCKED');
        expect(result.reason).toContain('HOLD');
        expect(result.reason).toContain('human review');
        expect(result.reason).toContain('FREEZE');
      });

      it('should block deployment for RETRY verdict', () => {
        const result = checkDeploymentGate(SimpleVerdict.RETRY);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RETRY);
        expect(result.action).toBe(SimpleAction.RETRY_OPERATION);
        expect(result.reason).toContain('BLOCKED');
        expect(result.reason).toContain('RETRY');
        expect(result.reason).toContain('RETRY_OPERATION');
      });
    });

    describe('with VerdictType', () => {
      it('should allow deployment for APPROVED verdict type', () => {
        const result = checkDeploymentGate(VerdictType.APPROVED);
        
        expect(result.allowed).toBe(true);
        expect(result.verdict).toBe(SimpleVerdict.GREEN);
        expect(result.action).toBe(SimpleAction.ADVANCE);
        expect(result.originalVerdictType).toBe(VerdictType.APPROVED);
      });

      it('should allow deployment for WARNING verdict type (proceed with caution)', () => {
        const result = checkDeploymentGate(VerdictType.WARNING);
        
        expect(result.allowed).toBe(true);
        expect(result.verdict).toBe(SimpleVerdict.GREEN);
        expect(result.action).toBe(SimpleAction.ADVANCE);
        expect(result.originalVerdictType).toBe(VerdictType.WARNING);
      });

      it('should block deployment for REJECTED verdict type', () => {
        const result = checkDeploymentGate(VerdictType.REJECTED);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RED);
        expect(result.action).toBe(SimpleAction.ABORT);
        expect(result.originalVerdictType).toBe(VerdictType.REJECTED);
      });

      it('should block deployment for ESCALATED verdict type', () => {
        const result = checkDeploymentGate(VerdictType.ESCALATED);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.HOLD);
        expect(result.action).toBe(SimpleAction.FREEZE);
        expect(result.originalVerdictType).toBe(VerdictType.ESCALATED);
      });

      it('should block deployment for BLOCKED verdict type', () => {
        const result = checkDeploymentGate(VerdictType.BLOCKED);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.HOLD);
        expect(result.action).toBe(SimpleAction.FREEZE);
        expect(result.originalVerdictType).toBe(VerdictType.BLOCKED);
      });

      it('should block deployment for DEFERRED verdict type', () => {
        const result = checkDeploymentGate(VerdictType.DEFERRED);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RETRY);
        expect(result.action).toBe(SimpleAction.RETRY_OPERATION);
        expect(result.originalVerdictType).toBe(VerdictType.DEFERRED);
      });

      it('should block deployment for PENDING verdict type', () => {
        const result = checkDeploymentGate(VerdictType.PENDING);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RETRY);
        expect(result.action).toBe(SimpleAction.RETRY_OPERATION);
        expect(result.originalVerdictType).toBe(VerdictType.PENDING);
      });
    });

    describe('with full Verdict object', () => {
      it('should allow deployment for verdict with APPROVED type', () => {
        const verdict: Verdict = {
          id: 'verdict-1',
          execution_id: 'exec-1',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp-1',
          error_class: 'UNKNOWN',
          service: 'test-service',
          confidence_score: 95,
          proposed_action: 'WAIT_AND_RETRY',
          verdict_type: VerdictType.APPROVED,
          tokens: [],
          signals: [],
          created_at: new Date().toISOString(),
        };

        const result = checkDeploymentGate(verdict);
        
        expect(result.allowed).toBe(true);
        expect(result.verdict).toBe(SimpleVerdict.GREEN);
        expect(result.originalVerdictType).toBe(VerdictType.APPROVED);
      });

      it('should block deployment for verdict with REJECTED type', () => {
        const verdict: Verdict = {
          id: 'verdict-2',
          execution_id: 'exec-2',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp-2',
          error_class: 'MISSING_SECRET',
          service: 'test-service',
          confidence_score: 90,
          proposed_action: 'OPEN_ISSUE',
          verdict_type: VerdictType.REJECTED,
          tokens: [],
          signals: [],
          created_at: new Date().toISOString(),
        };

        const result = checkDeploymentGate(verdict);
        
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe(SimpleVerdict.RED);
        expect(result.originalVerdictType).toBe(VerdictType.REJECTED);
      });
    });

    describe('result structure', () => {
      it('should include all required fields in result', () => {
        const result = checkDeploymentGate(SimpleVerdict.GREEN);
        
        expect(result).toHaveProperty('allowed');
        expect(result).toHaveProperty('verdict');
        expect(result).toHaveProperty('action');
        expect(result).toHaveProperty('reason');
        expect(typeof result.allowed).toBe('boolean');
        expect(typeof result.verdict).toBe('string');
        expect(typeof result.action).toBe('string');
        expect(typeof result.reason).toBe('string');
      });

      it('should include originalVerdictType when input is VerdictType', () => {
        const result = checkDeploymentGate(VerdictType.APPROVED);
        
        expect(result.originalVerdictType).toBe(VerdictType.APPROVED);
      });

      it('should not include originalVerdictType when input is SimpleVerdict', () => {
        const result = checkDeploymentGate(SimpleVerdict.GREEN);
        
        expect(result.originalVerdictType).toBeUndefined();
      });
    });
  });

  describe('validateDeploymentGate', () => {
    it('should not throw for GREEN verdict', () => {
      expect(() => {
        validateDeploymentGate(SimpleVerdict.GREEN);
      }).not.toThrow();
    });

    it('should throw for RED verdict', () => {
      expect(() => {
        validateDeploymentGate(SimpleVerdict.RED);
      }).toThrow('Deployment gate check failed');
    });

    it('should throw for HOLD verdict', () => {
      expect(() => {
        validateDeploymentGate(SimpleVerdict.HOLD);
      }).toThrow('Deployment gate check failed');
    });

    it('should throw for RETRY verdict', () => {
      expect(() => {
        validateDeploymentGate(SimpleVerdict.RETRY);
      }).toThrow('Deployment gate check failed');
    });

    it('should include verdict details in error message', () => {
      try {
        validateDeploymentGate(SimpleVerdict.RED);
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('RED');
        expect(error.message).toContain('ABORT');
      }
    });

    it('should work with VerdictType', () => {
      expect(() => {
        validateDeploymentGate(VerdictType.APPROVED);
      }).not.toThrow();

      expect(() => {
        validateDeploymentGate(VerdictType.REJECTED);
      }).toThrow('Deployment gate check failed');
    });
  });

  describe('isDeploymentAllowed', () => {
    it('should return true for GREEN verdict', () => {
      expect(isDeploymentAllowed(SimpleVerdict.GREEN)).toBe(true);
    });

    it('should return false for RED verdict', () => {
      expect(isDeploymentAllowed(SimpleVerdict.RED)).toBe(false);
    });

    it('should return false for HOLD verdict', () => {
      expect(isDeploymentAllowed(SimpleVerdict.HOLD)).toBe(false);
    });

    it('should return false for RETRY verdict', () => {
      expect(isDeploymentAllowed(SimpleVerdict.RETRY)).toBe(false);
    });

    it('should work with VerdictType', () => {
      expect(isDeploymentAllowed(VerdictType.APPROVED)).toBe(true);
      expect(isDeploymentAllowed(VerdictType.WARNING)).toBe(true);
      expect(isDeploymentAllowed(VerdictType.REJECTED)).toBe(false);
      expect(isDeploymentAllowed(VerdictType.ESCALATED)).toBe(false);
      expect(isDeploymentAllowed(VerdictType.BLOCKED)).toBe(false);
      expect(isDeploymentAllowed(VerdictType.DEFERRED)).toBe(false);
      expect(isDeploymentAllowed(VerdictType.PENDING)).toBe(false);
    });

    it('should work with full Verdict object', () => {
      const greenVerdict: Verdict = {
        id: 'v1',
        execution_id: 'e1',
        policy_snapshot_id: 'p1',
        fingerprint_id: 'f1',
        error_class: 'UNKNOWN',
        service: 'test',
        confidence_score: 95,
        proposed_action: 'WAIT_AND_RETRY',
        verdict_type: VerdictType.APPROVED,
        tokens: [],
        signals: [],
        created_at: new Date().toISOString(),
      };

      const redVerdict: Verdict = {
        ...greenVerdict,
        verdict_type: VerdictType.REJECTED,
      };

      expect(isDeploymentAllowed(greenVerdict)).toBe(true);
      expect(isDeploymentAllowed(redVerdict)).toBe(false);
    });
  });

  describe('getDeploymentStatus', () => {
    it('should return success message for GREEN verdict', () => {
      const status = getDeploymentStatus(SimpleVerdict.GREEN);
      
      expect(status).toContain('✅');
      expect(status).toContain('Deployment allowed');
      expect(status).toContain('GREEN');
    });

    it('should return failure message for RED verdict', () => {
      const status = getDeploymentStatus(SimpleVerdict.RED);
      
      expect(status).toContain('❌');
      expect(status).toContain('BLOCKED');
      expect(status).toContain('RED');
    });

    it('should return failure message for HOLD verdict', () => {
      const status = getDeploymentStatus(SimpleVerdict.HOLD);
      
      expect(status).toContain('❌');
      expect(status).toContain('BLOCKED');
      expect(status).toContain('HOLD');
    });

    it('should return failure message for RETRY verdict', () => {
      const status = getDeploymentStatus(SimpleVerdict.RETRY);
      
      expect(status).toContain('❌');
      expect(status).toContain('BLOCKED');
      expect(status).toContain('RETRY');
    });

    it('should work with all VerdictTypes', () => {
      const approvedStatus = getDeploymentStatus(VerdictType.APPROVED);
      expect(approvedStatus).toContain('✅');

      const rejectedStatus = getDeploymentStatus(VerdictType.REJECTED);
      expect(rejectedStatus).toContain('❌');
    });
  });

  describe('Issue B3 acceptance criteria', () => {
    it('should ensure no deployment without GREEN verdict', () => {
      // GREEN allows deployment
      expect(isDeploymentAllowed(SimpleVerdict.GREEN)).toBe(true);
      
      // All non-GREEN verdicts block deployment
      expect(isDeploymentAllowed(SimpleVerdict.RED)).toBe(false);
      expect(isDeploymentAllowed(SimpleVerdict.HOLD)).toBe(false);
      expect(isDeploymentAllowed(SimpleVerdict.RETRY)).toBe(false);
    });

    it('should make manual deploy without GREEN impossible', () => {
      // Attempting to deploy with non-GREEN verdict should throw
      expect(() => {
        validateDeploymentGate(SimpleVerdict.RED);
      }).toThrow();

      expect(() => {
        validateDeploymentGate(SimpleVerdict.HOLD);
      }).toThrow();

      expect(() => {
        validateDeploymentGate(SimpleVerdict.RETRY);
      }).toThrow();
    });

    it('should provide clear reasons for blocking deployment', () => {
      const redResult = checkDeploymentGate(SimpleVerdict.RED);
      expect(redResult.reason).toContain('critical failure');
      expect(redResult.reason).toContain('ABORT');

      const holdResult = checkDeploymentGate(SimpleVerdict.HOLD);
      expect(holdResult.reason).toContain('human review');
      expect(holdResult.reason).toContain('FREEZE');

      const retryResult = checkDeploymentGate(SimpleVerdict.RETRY);
      expect(retryResult.reason).toContain('transient condition');
      expect(retryResult.reason).toContain('RETRY_OPERATION');
    });

    it('should use SimpleVerdict (not ECS/Diff/Health) for decision', () => {
      // The gate checks SimpleVerdict, not raw ECS/Diff/Health data
      // Those inputs are used to generate the verdict, but the verdict makes the final decision
      
      const result = checkDeploymentGate(SimpleVerdict.RED);
      
      // The decision is based on verdict, not on raw signals
      expect(result.verdict).toBe(SimpleVerdict.RED);
      expect(result.allowed).toBe(false);
    });

    it('should work with all verdict types consistently', () => {
      // Test every VerdictType to ensure consistent behavior
      const verdictTypes = [
        VerdictType.APPROVED,
        VerdictType.WARNING,
        VerdictType.REJECTED,
        VerdictType.ESCALATED,
        VerdictType.BLOCKED,
        VerdictType.DEFERRED,
        VerdictType.PENDING,
      ];

      for (const vt of verdictTypes) {
        const result = checkDeploymentGate(vt);
        
        // Result should always be deterministic
        expect(result).toHaveProperty('allowed');
        expect(result).toHaveProperty('verdict');
        expect(result).toHaveProperty('action');
        expect(result).toHaveProperty('reason');
        
        // Original verdict type should be preserved
        expect(result.originalVerdictType).toBe(vt);
      }
    });
  });
});
