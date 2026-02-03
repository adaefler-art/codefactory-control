/**
 * Tests for Lawbook Schema with Automation Policy (E87.2)
 * 
 * Tests schema validation, canonicalization, and deterministic hashing
 * for the automation policy section.
 * 
 * @jest-environment node
 */

import {
  LawbookV1Schema,
  AutomationPolicyActionSchema,
  LawbookAutomationPolicySchema,
  canonicalizeLawbook,
  computeLawbookHash,
  parseLawbook,
  safeParseLawbook,
  createMinimalLawbook,
} from '@/lawbook/schema';

describe('Lawbook Schema - Automation Policy', () => {
  describe('AutomationPolicyActionSchema', () => {
    it('should validate valid policy action', () => {
      const policy = {
        actionType: 'rerun_checks',
        allowedEnvs: ['staging', 'prod'],
        cooldownSeconds: 300,
        maxRunsPerWindow: 3,
        windowSeconds: 3600,
        idempotencyKeyTemplate: ['owner', 'repo', 'prNumber'],
        requiresApproval: false,
        description: 'Rerun failed checks',
      };

      const result = AutomationPolicyActionSchema.safeParse(policy);
      expect(result.success).toBe(true);
    });

    it('should apply defaults for optional fields', () => {
      const policy = {
        actionType: 'test_action',
      };

      const result = AutomationPolicyActionSchema.parse(policy);
      expect(result.allowedEnvs).toEqual(['staging']);
      expect(result.cooldownSeconds).toBe(0);
      expect(result.idempotencyKeyTemplate).toEqual([]);
      expect(result.requiresApproval).toBe(false);
    });

    it('should reject invalid environment', () => {
      const policy = {
        actionType: 'test_action',
        allowedEnvs: ['invalid_env'], // Not in enum
      };

      const result = AutomationPolicyActionSchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it('should reject negative cooldownSeconds', () => {
      const policy = {
        actionType: 'test_action',
        cooldownSeconds: -10,
      };

      const result = AutomationPolicyActionSchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it('should reject invalid maxRunsPerWindow', () => {
      const policy = {
        actionType: 'test_action',
        maxRunsPerWindow: 0, // Must be positive
        windowSeconds: 3600,
      };

      const result = AutomationPolicyActionSchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it('should reject empty actionType', () => {
      const policy = {
        actionType: '',
      };

      const result = AutomationPolicyActionSchema.safeParse(policy);
      expect(result.success).toBe(false);
    });
  });

  describe('LawbookAutomationPolicySchema', () => {
    it('should validate valid automation policy section', () => {
      const automationPolicy = {
        enforcementMode: 'strict',
        policies: [
          {
            actionType: 'rerun_checks',
            allowedEnvs: ['staging'],
            cooldownSeconds: 300,
            idempotencyKeyTemplate: [],
            requiresApproval: false,
          },
        ],
      };

      const result = LawbookAutomationPolicySchema.safeParse(automationPolicy);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const automationPolicy = {};

      const result = LawbookAutomationPolicySchema.parse(automationPolicy);
      expect(result.enforcementMode).toBe('strict');
      expect(result.policies).toEqual([]);
    });

    it('should reject invalid enforcement mode', () => {
      const automationPolicy = {
        enforcementMode: 'invalid',
      };

      const result = LawbookAutomationPolicySchema.safeParse(automationPolicy);
      expect(result.success).toBe(false);
    });
  });

  describe('LawbookV1Schema with automationPolicy', () => {
    it('should validate lawbook with automation policy', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'rerun_checks',
              allowedEnvs: ['staging'],
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['owner', 'repo'],
              requiresApproval: false,
            },
          ],
        },
      });

      const result = LawbookV1Schema.safeParse(lawbook);
      expect(result.success).toBe(true);
    });

    it('should allow lawbook without automation policy (optional)', () => {
      const lawbook = createMinimalLawbook();
      delete (lawbook as any).automationPolicy;

      const result = LawbookV1Schema.safeParse(lawbook);
      expect(result.success).toBe(true);
    });
  });

  describe('canonicalizeLawbook with automation policy', () => {
    it('should sort policies by actionType', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'zzz_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 0,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
            {
              actionType: 'aaa_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 0,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
      });

      const canonical = canonicalizeLawbook(lawbook);
      const parsed = JSON.parse(canonical);

      expect(parsed.automationPolicy.policies[0].actionType).toBe('aaa_action');
      expect(parsed.automationPolicy.policies[1].actionType).toBe('zzz_action');
    });

    it('should sort allowedEnvs within each policy', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging', 'prod', 'development'], // Unsorted
              cooldownSeconds: 0,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
      });

      const canonical = canonicalizeLawbook(lawbook);
      const parsed = JSON.parse(canonical);

      expect(parsed.automationPolicy.policies[0].allowedEnvs).toEqual([
        'development',
        'prod',
        'staging',
      ]);
    });

    it('should sort idempotencyKeyTemplate', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 0,
              idempotencyKeyTemplate: ['repo', 'owner', 'prNumber'], // Unsorted
              requiresApproval: false,
            },
          ],
        },
      });

      const canonical = canonicalizeLawbook(lawbook);
      const parsed = JSON.parse(canonical);

      expect(parsed.automationPolicy.policies[0].idempotencyKeyTemplate).toEqual([
        'owner',
        'prNumber',
        'repo',
      ]);
    });

    it('should produce identical canonicalization for equivalent lawbooks', () => {
      const fixedCreatedAt = '2026-01-01T00:00:00.000Z';
      const lawbook1 = createMinimalLawbook({
        createdAt: fixedCreatedAt,
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'action_b',
              allowedEnvs: ['prod', 'staging'],
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['repo', 'owner'],
              requiresApproval: false,
            },
            {
              actionType: 'action_a',
              allowedEnvs: ['staging'],
              cooldownSeconds: 0,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
      });

      const lawbook2 = createMinimalLawbook({
        createdAt: fixedCreatedAt,
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'action_a',
              allowedEnvs: ['staging'],
              cooldownSeconds: 0,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
            {
              actionType: 'action_b',
              allowedEnvs: ['staging', 'prod'], // Different order
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['owner', 'repo'], // Different order
              requiresApproval: false,
            },
          ],
        },
      });

      const canonical1 = canonicalizeLawbook(lawbook1);
      const canonical2 = canonicalizeLawbook(lawbook2);

      expect(canonical1).toBe(canonical2);
    });
  });

  describe('computeLawbookHash with automation policy', () => {
    it('should compute deterministic hash', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['owner', 'repo'],
              requiresApproval: false,
            },
          ],
        },
      });

      const hash1 = computeLawbookHash(lawbook);
      const hash2 = computeLawbookHash(lawbook);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should compute identical hash for equivalent lawbooks (determinism)', () => {
      const fixedCreatedAt = '2026-01-01T00:00:00.000Z';
      const lawbook1 = createMinimalLawbook({
        createdAt: fixedCreatedAt,
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['prod', 'staging'], // Different order
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['repo', 'owner'], // Different order
              requiresApproval: false,
            },
          ],
        },
      });

      const lawbook2 = createMinimalLawbook({
        createdAt: fixedCreatedAt,
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging', 'prod'], // Different order
              cooldownSeconds: 300,
              idempotencyKeyTemplate: ['owner', 'repo'], // Different order
              requiresApproval: false,
            },
          ],
        },
      });

      const hash1 = computeLawbookHash(lawbook1);
      const hash2 = computeLawbookHash(lawbook2);

      expect(hash1).toBe(hash2);
    });

    it('should compute different hash if policy changes', () => {
      const lawbook1 = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 300,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
      });

      const lawbook2 = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 600, // Different cooldown
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
      });

      const hash1 = computeLawbookHash(lawbook1);
      const hash2 = computeLawbookHash(lawbook2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('parseLawbook', () => {
    it('should parse valid lawbook with automation policy', () => {
      const data = {
        version: '0.7.0',
        lawbookId: 'TEST-LAWBOOK',
        lawbookVersion: '1.0.0',
        createdAt: '2025-12-30T10:00:00.000Z',
        createdBy: 'system',
        github: { allowedRepos: [] },
        determinism: {
          requireDeterminismGate: true,
          requirePostDeployVerification: true,
        },
        remediation: {
          enabled: true,
          allowedPlaybooks: [],
          allowedActions: [],
        },
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [
            {
              actionType: 'test_action',
              allowedEnvs: ['staging'],
              cooldownSeconds: 300,
              idempotencyKeyTemplate: [],
              requiresApproval: false,
            },
          ],
        },
        evidence: {},
        enforcement: { requiredFields: [], strictMode: true },
        ui: {},
      };

      const lawbook = parseLawbook(data);
      expect(lawbook.automationPolicy).toBeDefined();
      expect(lawbook.automationPolicy?.policies).toHaveLength(1);
    });

    it('should throw on invalid automation policy', () => {
      const data = {
        version: '0.7.0',
        lawbookId: 'TEST-LAWBOOK',
        lawbookVersion: '1.0.0',
        createdAt: '2025-12-30T10:00:00.000Z',
        createdBy: 'system',
        github: { allowedRepos: [] },
        determinism: {
          requireDeterminismGate: true,
          requirePostDeployVerification: true,
        },
        remediation: {
          enabled: true,
          allowedPlaybooks: [],
          allowedActions: [],
        },
        automationPolicy: {
          enforcementMode: 'invalid_mode', // Invalid
          policies: [],
        },
        evidence: {},
        enforcement: { requiredFields: [], strictMode: true },
        ui: {},
      };

      expect(() => parseLawbook(data)).toThrow();
    });
  });

  describe('safeParseLawbook', () => {
    it('should return success for valid lawbook', () => {
      const lawbook = createMinimalLawbook({
        automationPolicy: {
          enforcementMode: 'strict',
          policies: [],
        },
      });

      const result = safeParseLawbook(lawbook);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid lawbook', () => {
      const invalidLawbook = {
        version: '0.7.0',
        lawbookId: 'TEST',
        automationPolicy: {
          enforcementMode: 'invalid',
        },
      };

      const result = safeParseLawbook(invalidLawbook);
      expect(result.success).toBe(false);
    });
  });
});
