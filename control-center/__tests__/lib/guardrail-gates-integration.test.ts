/**
 * Tests for Guardrail Gates Integration (E79.4 / I794)
 * 
 * Validates:
 * - Existing idempotency key formats are accepted by gateIdempotencyKeyFormat
 * - Integration with remediation executor maintains existing behavior
 * - No regressions in key format validation
 */

import {
  gateIdempotencyKeyFormat,
  computeInputsHash,
} from '../../src/lib/guardrail-gates';
import { computeInputsHash as remediationComputeInputsHash } from '../../src/lib/contracts/remediation-playbook';

describe('Guardrail Gates Integration', () => {
  describe('gateIdempotencyKeyFormat - existing key format compatibility', () => {
    describe('run_key format', () => {
      it('should accept standard run_key format: incident:playbook:hash', () => {
        // Format from tests: test:incident:1:restart-service:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        const runKey = 'test:incident:1:restart-service:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        
        const verdict = gateIdempotencyKeyFormat({ key: runKey });
        
        expect(verdict.verdict).toBe('ALLOW');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'KEY_FORMAT_VALID',
            severity: 'INFO',
          })
        );
      });
      
      it('should accept run_key with short playbook names', () => {
        const runKey = 'inc:1:playbook:abc123def456';
        
        const verdict = gateIdempotencyKeyFormat({ key: runKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept run_key with multiple colons in incident key', () => {
        // Some incident keys may have colons
        const runKey = 'org:repo:pr:123:playbook:hash12345';
        
        const verdict = gateIdempotencyKeyFormat({ key: runKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('step idempotency_key format', () => {
      it('should accept standard step key format: ACTION_TYPE:incident:hash', () => {
        // Format from tests: RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        const stepKey = 'RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        
        const verdict = gateIdempotencyKeyFormat({ key: stepKey });
        
        expect(verdict.verdict).toBe('ALLOW');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'KEY_FORMAT_VALID',
          })
        );
      });
      
      it('should accept step key with RESTART_SERVICE action', () => {
        const inputsHash = remediationComputeInputsHash({ service: 'prod-api' });
        const stepKey = `RESTART_SERVICE:test:incident:1:${inputsHash}`;
        
        const verdict = gateIdempotencyKeyFormat({ key: stepKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept step key with ROLLBACK_DEPLOY action', () => {
        const stepKey = 'ROLLBACK_DEPLOY:incident:123:hash-value-here';
        
        const verdict = gateIdempotencyKeyFormat({ key: stepKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('playbook-specific keys', () => {
      it('should accept redeploy-lkg playbook step keys', () => {
        // From redeploy-lkg.ts: uses computeInputsHash({ env: normalizedEnv, service })
        const paramsHash = remediationComputeInputsHash({ env: 'production', service: 'api' });
        const stepKey = `SNAPSHOT_SERVICE_STATE:incident:lkg:${paramsHash}`;
        
        const verdict = gateIdempotencyKeyFormat({ key: stepKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept safe-retry-runner playbook step keys', () => {
        // From safe-retry-runner.ts
        const paramsHash = remediationComputeInputsHash({
          owner: 'test-org',
          repo: 'test-repo',
          runId: 123,
        });
        const stepKey = `POLL_SERVICE_HEALTH:workflow:retry:${paramsHash}`;
        
        const verdict = gateIdempotencyKeyFormat({ key: stepKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
    });
    
    describe('edge cases', () => {
      it('should accept keys with hyphens in all segments', () => {
        const key = 'my-action-type:my-incident-key:my-playbook-id:hash-with-dashes';
        
        const verdict = gateIdempotencyKeyFormat({ key });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept keys with underscores', () => {
        const key = 'ACTION_TYPE:incident_key:playbook_id:hash_value';
        
        const verdict = gateIdempotencyKeyFormat({ key });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept keys mixing hyphens, underscores, and colons', () => {
        const key = 'ACTION_TYPE-v2:incident-key_123:playbook:hash-abc_def';
        
        const verdict = gateIdempotencyKeyFormat({ key });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should accept maximum length keys (256 chars)', () => {
        // Create a key exactly 256 characters
        const longKey = 'a'.repeat(256);
        
        const verdict = gateIdempotencyKeyFormat({ key: longKey });
        
        expect(verdict.verdict).toBe('ALLOW');
      });
      
      it('should reject keys exceeding maximum length', () => {
        const tooLongKey = 'a'.repeat(257);
        
        const verdict = gateIdempotencyKeyFormat({ key: tooLongKey });
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'KEY_TOO_LONG',
            severity: 'ERROR',
          })
        );
      });
      
      it('should reject keys with spaces', () => {
        const keyWithSpaces = 'action type:incident key:playbook:hash';
        
        const verdict = gateIdempotencyKeyFormat({ key: keyWithSpaces });
        
        expect(verdict.verdict).toBe('DENY');
        expect(verdict.reasons).toContainEqual(
          expect.objectContaining({
            code: 'KEY_INVALID_CHARS',
            severity: 'ERROR',
          })
        );
      });
      
      it('should reject keys with special characters', () => {
        const keyWithSpecialChars = 'action@type#incident$playbook%hash';
        
        const verdict = gateIdempotencyKeyFormat({ key: keyWithSpecialChars });
        
        expect(verdict.verdict).toBe('DENY');
      });
    });
  });
  
  describe('computeInputsHash consistency', () => {
    it('should produce same hash as remediation-playbook computeInputsHash', () => {
      const inputs = { a: 1, b: 2, c: 3 };
      
      const gateHash = computeInputsHash(inputs);
      const remediationHash = remediationComputeInputsHash(inputs);
      
      expect(gateHash).toBe(remediationHash);
    });
    
    it('should produce deterministic hashes for nested objects', () => {
      const inputs1 = { a: 1, b: { x: 10, y: 20 }, c: 3 };
      const inputs2 = { c: 3, b: { y: 20, x: 10 }, a: 1 };
      
      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);
      
      expect(hash1).toBe(hash2);
    });
  });
});
