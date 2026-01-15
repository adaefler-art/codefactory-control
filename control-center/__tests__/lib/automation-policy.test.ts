/**
 * Tests for Automation Policy Module (E87.2)
 * 
 * Tests policy definitions, idempotency key generation,
 * action fingerprints, and helper functions.
 * 
 * @jest-environment node
 */

import {
  generateIdempotencyKey,
  hashIdempotencyKey,
  generateActionFingerprint,
  findPolicyForAction,
  isActionAllowedInEnv,
  validateRateLimitConfig,
} from '../../src/lib/lawbook/automation-policy';
import { LawbookAutomationPolicy, AutomationPolicyAction } from '@/lawbook/schema';

describe('Automation Policy Module', () => {
  describe('generateIdempotencyKey', () => {
    it('should generate stable key from template and context', () => {
      const template = ['owner', 'repo', 'prNumber'];
      const context = {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        prNumber: 123,
        extraField: 'ignored',
      };

      const key = generateIdempotencyKey(template, context);
      expect(key).toBe('owner=adaefler-art::prNumber=123::repo=codefactory-control');
    });

    it('should generate identical keys for same input (determinism)', () => {
      const template = ['repo', 'owner', 'prNumber']; // Different order
      const context1 = {
        prNumber: 123,
        owner: 'adaefler-art',
        repo: 'codefactory-control',
      };
      const context2 = {
        owner: 'adaefler-art',
        repo: 'codefactory-control',
        prNumber: 123,
      };

      const key1 = generateIdempotencyKey(template, context1);
      const key2 = generateIdempotencyKey(template, context2);

      expect(key1).toBe(key2);
    });

    it('should handle missing fields gracefully', () => {
      const template = ['owner', 'repo', 'prNumber'];
      const context = {
        owner: 'adaefler-art',
        // repo is missing
        prNumber: 123,
      };

      const key = generateIdempotencyKey(template, context);
      expect(key).toBe('owner=adaefler-art::prNumber=123');
    });

    it('should handle empty template', () => {
      const template: string[] = [];
      const context = { owner: 'test', repo: 'test' };

      const key = generateIdempotencyKey(template, context);
      expect(key).toBe('');
    });

    it('should serialize object values deterministically', () => {
      const template = ['config'];
      const context1 = {
        config: { b: 2, a: 1 },
      };
      const context2 = {
        config: { a: 1, b: 2 },
      };

      const key1 = generateIdempotencyKey(template, context1);
      const key2 = generateIdempotencyKey(template, context2);

      // Should be identical due to sorted keys
      expect(key1).toBe(key2);
    });
  });

  describe('hashIdempotencyKey', () => {
    it('should generate SHA-256 hash', () => {
      const key = 'owner=test::repo=test';
      const hash = hashIdempotencyKey(key);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate identical hashes for same key (determinism)', () => {
      const key = 'owner=test::repo=test';
      const hash1 = hashIdempotencyKey(key);
      const hash2 = hashIdempotencyKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different keys', () => {
      const hash1 = hashIdempotencyKey('key1');
      const hash2 = hashIdempotencyKey('key2');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateActionFingerprint', () => {
    it('should generate deterministic fingerprint', () => {
      const actionType = 'rerun_checks';
      const targetIdentifier = 'owner/repo#123';
      const params = { runId: 456, mode: 'FAILED_ONLY' };

      const fingerprint = generateActionFingerprint(actionType, targetIdentifier, params);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate identical fingerprints for same inputs (determinism)', () => {
      const actionType = 'rerun_checks';
      const targetIdentifier = 'owner/repo#123';
      const params1 = { mode: 'FAILED_ONLY', runId: 456 };
      const params2 = { runId: 456, mode: 'FAILED_ONLY' };

      const fp1 = generateActionFingerprint(actionType, targetIdentifier, params1);
      const fp2 = generateActionFingerprint(actionType, targetIdentifier, params2);

      expect(fp1).toBe(fp2);
    });

    it('should work without params', () => {
      const fingerprint = generateActionFingerprint('merge_pr', 'owner/repo#123');
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different fingerprints for different actions', () => {
      const fp1 = generateActionFingerprint('rerun_checks', 'owner/repo#123');
      const fp2 = generateActionFingerprint('merge_pr', 'owner/repo#123');

      expect(fp1).not.toBe(fp2);
    });
  });

  describe('findPolicyForAction', () => {
    const mockPolicy: AutomationPolicyAction = {
      actionType: 'rerun_checks',
      allowedEnvs: ['staging'],
      cooldownSeconds: 300,
      maxRunsPerWindow: 3,
      windowSeconds: 3600,
      idempotencyKeyTemplate: ['owner', 'repo', 'prNumber'],
      requiresApproval: false,
    };

    const automationPolicy: LawbookAutomationPolicy = {
      enforcementMode: 'strict',
      policies: [mockPolicy],
    };

    it('should find policy by action type', () => {
      const found = findPolicyForAction('rerun_checks', automationPolicy);
      expect(found).toEqual(mockPolicy);
    });

    it('should return null if policy not found', () => {
      const found = findPolicyForAction('nonexistent_action', automationPolicy);
      expect(found).toBeNull();
    });

    it('should return null if automationPolicy is undefined', () => {
      const found = findPolicyForAction('rerun_checks', undefined);
      expect(found).toBeNull();
    });

    it('should return null if policies array is empty', () => {
      const emptyPolicy: LawbookAutomationPolicy = {
        enforcementMode: 'strict',
        policies: [],
      };
      const found = findPolicyForAction('rerun_checks', emptyPolicy);
      expect(found).toBeNull();
    });
  });

  describe('isActionAllowedInEnv', () => {
    const policy: AutomationPolicyAction = {
      actionType: 'test_action',
      allowedEnvs: ['staging', 'prod'],
      cooldownSeconds: 0,
      idempotencyKeyTemplate: [],
      requiresApproval: false,
    };

    it('should allow action in allowed environment', () => {
      expect(isActionAllowedInEnv(policy, 'staging')).toBe(true);
      expect(isActionAllowedInEnv(policy, 'prod')).toBe(true);
    });

    it('should deny action in disallowed environment', () => {
      expect(isActionAllowedInEnv(policy, 'development')).toBe(false);
    });

    it('should allow if no env specified and staging is allowed', () => {
      expect(isActionAllowedInEnv(policy, undefined)).toBe(true);
    });

    it('should deny if no env specified and only prod is allowed', () => {
      const prodOnlyPolicy: AutomationPolicyAction = {
        ...policy,
        allowedEnvs: ['prod'],
      };
      expect(isActionAllowedInEnv(prodOnlyPolicy, undefined)).toBe(false);
    });

    it('should allow if no env specified and development is allowed', () => {
      const devPolicy: AutomationPolicyAction = {
        ...policy,
        allowedEnvs: ['development'],
      };
      expect(isActionAllowedInEnv(devPolicy, undefined)).toBe(true);
    });
  });

  describe('validateRateLimitConfig', () => {
    it('should validate when both maxRunsPerWindow and windowSeconds are defined', () => {
      const policy: AutomationPolicyAction = {
        actionType: 'test',
        allowedEnvs: ['staging'],
        cooldownSeconds: 0,
        maxRunsPerWindow: 3,
        windowSeconds: 3600,
        idempotencyKeyTemplate: [],
        requiresApproval: false,
      };

      const result = validateRateLimitConfig(policy);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate when both maxRunsPerWindow and windowSeconds are undefined', () => {
      const policy: AutomationPolicyAction = {
        actionType: 'test',
        allowedEnvs: ['staging'],
        cooldownSeconds: 0,
        idempotencyKeyTemplate: [],
        requiresApproval: false,
      };

      const result = validateRateLimitConfig(policy);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail when only maxRunsPerWindow is defined', () => {
      const policy: AutomationPolicyAction = {
        actionType: 'test',
        allowedEnvs: ['staging'],
        cooldownSeconds: 0,
        maxRunsPerWindow: 3,
        // windowSeconds is undefined
        idempotencyKeyTemplate: [],
        requiresApproval: false,
      };

      const result = validateRateLimitConfig(policy);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must both be defined');
    });

    it('should fail when only windowSeconds is defined', () => {
      const policy: AutomationPolicyAction = {
        actionType: 'test',
        allowedEnvs: ['staging'],
        cooldownSeconds: 0,
        // maxRunsPerWindow is undefined
        windowSeconds: 3600,
        idempotencyKeyTemplate: [],
        requiresApproval: false,
      };

      const result = validateRateLimitConfig(policy);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must both be defined');
    });
  });
});
