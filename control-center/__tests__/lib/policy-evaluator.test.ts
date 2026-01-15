/**
 * Tests for Automation Policy Evaluator (E87.2)
 * 
 * Tests policy evaluation logic including:
 * - Cooldown enforcement
 * - Rate limiting
 * - Environment checks
 * - Approval requirements
 * - Fail-closed semantics
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  evaluateAutomationPolicy,
  evaluateAndRecordPolicy,
} from '../../src/lib/automation/policy-evaluator';
import { PolicyEvaluationContext } from '../../src/lib/lawbook/automation-policy';
import * as lawbookDb from '../../src/lib/db/lawbook';
import * as auditDb from '../../src/lib/db/automationPolicyAudit';
import { LawbookV1 } from '@/lawbook/schema';

// Mock dependencies
jest.mock('../../src/lib/db/lawbook');
jest.mock('../../src/lib/db/automationPolicyAudit');
jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockGetActiveLawbook = lawbookDb.getActiveLawbook as jest.MockedFunction<typeof lawbookDb.getActiveLawbook>;
const mockGetLastExecution = auditDb.getLastExecution as jest.MockedFunction<typeof auditDb.getLastExecution>;
const mockCountExecutionsInWindow = auditDb.countExecutionsInWindow as jest.MockedFunction<typeof auditDb.countExecutionsInWindow>;
const mockRecordPolicyExecution = auditDb.recordPolicyExecution as jest.MockedFunction<typeof auditDb.recordPolicyExecution>;

describe('Automation Policy Evaluator', () => {
  let mockPool: jest.Mocked<Pool>;

  const createMockLawbook = (overrides?: Partial<LawbookV1>): LawbookV1 => ({
    version: '0.7.0',
    lawbookId: 'AFU9-LAWBOOK',
    lawbookVersion: '2025-12-30.1',
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
          actionType: 'rerun_checks',
          allowedEnvs: ['staging', 'prod'],
          cooldownSeconds: 300,
          maxRunsPerWindow: 3,
          windowSeconds: 3600,
          idempotencyKeyTemplate: ['owner', 'repo', 'prNumber'],
          requiresApproval: false,
        },
        {
          actionType: 'merge_pr',
          allowedEnvs: ['staging'],
          cooldownSeconds: 60,
          idempotencyKeyTemplate: ['owner', 'repo', 'prNumber'],
          requiresApproval: true,
        },
      ],
    },
    evidence: { maxEvidenceItems: 100 },
    enforcement: { requiredFields: [], strictMode: true },
    ui: { displayName: 'Test Lawbook' },
    ...overrides,
  });

  const createMockContext = (overrides?: Partial<PolicyEvaluationContext>): PolicyEvaluationContext => ({
    requestId: 'req-123',
    actionType: 'rerun_checks',
    targetType: 'pr',
    targetIdentifier: 'owner/repo#123',
    deploymentEnv: 'staging',
    actionContext: {
      owner: 'owner',
      repo: 'repo',
      prNumber: 123,
    },
    ...overrides,
  });

  beforeEach(() => {
    mockPool = {} as any;
    jest.clearAllMocks();

    // Default mocks
    mockGetActiveLawbook.mockResolvedValue({
      success: true,
      data: {
        id: 'lawbook-1',
        lawbook_id: 'AFU9-LAWBOOK',
        lawbook_version: '2025-12-30.1',
        created_at: '2025-12-30T10:00:00.000Z',
        created_by: 'system',
        lawbook_json: createMockLawbook(),
        lawbook_hash: 'abc123',
        schema_version: '0.7.0',
      },
    });

    mockGetLastExecution.mockResolvedValue(null);
    mockCountExecutionsInWindow.mockResolvedValue(0);
    mockRecordPolicyExecution.mockResolvedValue({
      success: true,
      data: {} as any,
    });
  });

  describe('Fail-Closed Semantics', () => {
    it('should deny if no lawbook configured', async () => {
      mockGetActiveLawbook.mockResolvedValue({
        success: false,
        error: 'No active lawbook',
        notConfigured: true,
      });

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('No active lawbook');
    });

    it('should deny if policy not found for action type', async () => {
      const context = createMockContext({ actionType: 'unknown_action' });
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('No policy defined');
    });

    it('should deny if evaluation throws error', async () => {
      mockGetActiveLawbook.mockRejectedValue(new Error('Database error'));

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Policy evaluation failed');
    });
  });

  describe('Environment Enforcement', () => {
    it('should allow action in allowed environment', async () => {
      const context = createMockContext({ deploymentEnv: 'staging' });
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(result.allow).toBe(true);
    });

    it('should deny action in disallowed environment', async () => {
      const context = createMockContext({
        deploymentEnv: 'development',
      });
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('not allowed in environment');
    });
  });

  describe('Approval Enforcement', () => {
    it('should deny if approval required but not granted', async () => {
      const context = createMockContext({
        actionType: 'merge_pr',
        hasApproval: false,
      });
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('requires explicit approval');
    });

    it('should allow if approval required and granted', async () => {
      const context = createMockContext({
        actionType: 'merge_pr',
        hasApproval: true,
        approvalFingerprint: 'approval-abc',
      });
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(result.allow).toBe(true);
    });
  });

  describe('Cooldown Enforcement', () => {
    it('should deny if within cooldown period', async () => {
      const now = new Date();
      const lastExecutionTime = new Date(now.getTime() - 60000); // 1 minute ago

      mockGetLastExecution.mockResolvedValue({
        id: 1,
        request_id: 'prev-req',
        action_type: 'rerun_checks',
        target_identifier: 'owner/repo#123',
        decision: 'allowed',
        created_at: lastExecutionTime.toISOString(),
        idempotency_key_hash: 'hash',
        enforcement_data: {},
      } as any);

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Cooldown active');
      expect(result.nextAllowedAt).toBeTruthy();
    });

    it('should allow if cooldown period has passed', async () => {
      const now = new Date();
      const lastExecutionTime = new Date(now.getTime() - 400000); // 6+ minutes ago (cooldown is 5 min)

      mockGetLastExecution.mockResolvedValue({
        id: 1,
        request_id: 'prev-req',
        action_type: 'rerun_checks',
        target_identifier: 'owner/repo#123',
        decision: 'allowed',
        created_at: lastExecutionTime.toISOString(),
        idempotency_key_hash: 'hash',
        enforcement_data: {},
      } as any);

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(result.allow).toBe(true);
    });

    it('should allow if last execution was denied (cooldown only applies to allowed)', async () => {
      const now = new Date();
      const lastExecutionTime = new Date(now.getTime() - 60000); // 1 minute ago

      mockGetLastExecution.mockResolvedValue({
        id: 1,
        request_id: 'prev-req',
        action_type: 'rerun_checks',
        target_identifier: 'owner/repo#123',
        decision: 'denied', // Last was denied
        created_at: lastExecutionTime.toISOString(),
        idempotency_key_hash: 'hash',
        enforcement_data: {},
      } as any);

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(result.allow).toBe(true);
    });
  });

  describe('Rate Limit Enforcement', () => {
    it('should deny if rate limit exceeded', async () => {
      mockCountExecutionsInWindow.mockResolvedValue(3); // Max is 3

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
      expect(result.enforcementData.currentRunCount).toBe(3);
      expect(result.nextAllowedAt).toBeTruthy();
    });

    it('should allow if under rate limit', async () => {
      mockCountExecutionsInWindow.mockResolvedValue(2); // Under max of 3

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(result.allow).toBe(true);
    });

    it('should allow if no rate limit configured', async () => {
      // Use action without rate limit
      const context = createMockContext({
        actionType: 'merge_pr', // This one has no rate limit in mock
      });
      const result = await evaluateAutomationPolicy(context, mockPool);

      // Should pass rate limit check (no rate limit configured)
      expect(mockCountExecutionsInWindow).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency Key Generation', () => {
    it('should generate stable idempotency key', async () => {
      const context1 = createMockContext({
        actionContext: {
          repo: 'repo',
          owner: 'owner',
          prNumber: 123,
        },
      });
      const context2 = createMockContext({
        actionContext: {
          prNumber: 123,
          owner: 'owner',
          repo: 'repo',
        },
      });

      const result1 = await evaluateAutomationPolicy(context1, mockPool);
      const result2 = await evaluateAutomationPolicy(context2, mockPool);

      expect(result1.idempotencyKey).toBe(result2.idempotencyKey);
      expect(result1.idempotencyKeyHash).toBe(result2.idempotencyKeyHash);
    });

    it('should include lawbook version and hash in result', async () => {
      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.lawbookVersion).toBe('2025-12-30.1');
      expect(result.lawbookHash).toBe('abc123');
    });
  });

  describe('evaluateAndRecordPolicy', () => {
    it('should evaluate and record decision in audit trail', async () => {
      const context = createMockContext();
      const result = await evaluateAndRecordPolicy(context, mockPool);

      expect(result.decision).toBe('allowed');
      expect(mockRecordPolicyExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-123',
          actionType: 'rerun_checks',
          targetIdentifier: 'owner/repo#123',
          evaluationResult: expect.objectContaining({
            decision: 'allowed',
          }),
        }),
        mockPool
      );
    });

    it('should record denied decisions', async () => {
      const context = createMockContext({
        deploymentEnv: 'development', // Not allowed
      });
      const result = await evaluateAndRecordPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(mockRecordPolicyExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluationResult: expect.objectContaining({
            decision: 'denied',
          }),
        }),
        mockPool
      );
    });
  });

  describe('Policy Configuration Validation', () => {
    it('should deny if rate limit config is invalid (missing windowSeconds)', async () => {
      mockGetActiveLawbook.mockResolvedValue({
        success: true,
        data: {
          id: 'lawbook-1',
          lawbook_id: 'AFU9-LAWBOOK',
          lawbook_version: '2025-12-30.1',
          created_at: '2025-12-30T10:00:00.000Z',
          created_by: 'system',
          lawbook_json: createMockLawbook({
            automationPolicy: {
              enforcementMode: 'strict',
              policies: [
                {
                  actionType: 'rerun_checks',
                  allowedEnvs: ['staging'],
                  cooldownSeconds: 0,
                  maxRunsPerWindow: 3,
                  // windowSeconds is missing (invalid config)
                  idempotencyKeyTemplate: [],
                  requiresApproval: false,
                },
              ],
            },
          }),
          lawbook_hash: 'abc123',
          schema_version: '0.7.0',
        },
      });

      const context = createMockContext();
      const result = await evaluateAutomationPolicy(context, mockPool);

      expect(result.decision).toBe('denied');
      expect(result.reason).toContain('Invalid policy configuration');
    });
  });
});
