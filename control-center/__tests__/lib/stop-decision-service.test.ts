/**
 * Tests for Stop Decision Service (E84.4)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { makeStopDecision } from '../../src/lib/github/stop-decision-service';
import { StopDecisionContext } from '../../src/lib/types/stop-decision';
import { LawbookV1 } from '../../src/lawbook/schema';

// Mock dependencies
jest.mock('../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/lib/db/lawbook', () => ({
  getActiveLawbookVersion: jest.fn(),
}));

describe('Stop Decision Service', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockQuery: jest.Mock;
  let mockLawbook: LawbookV1;

  beforeEach(() => {
    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery,
    } as any;

    // Mock default lawbook with stop rules
    mockLawbook = {
      version: '0.7.0',
      lawbookId: 'TEST-LAWBOOK',
      lawbookVersion: '2025-01-13.1',
      createdAt: new Date().toISOString(),
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
      stopRules: {
        maxRerunsPerJob: 2,
        maxTotalRerunsPerPr: 5,
        maxWaitMinutesForGreen: 60,
        cooldownMinutes: 5,
        blockOnFailureClasses: ['build deterministic', 'lint error', 'syntax error'],
        noSignalChangeThreshold: 2,
      },
      evidence: {},
      enforcement: {
        requiredFields: [],
        strictMode: true,
      },
      ui: {},
    };

    const { getActiveLawbookVersion } = require('../../src/lib/db/lawbook');
    getActiveLawbookVersion.mockResolvedValue(mockLawbook);

    // Mock audit insert (always succeeds)
    mockQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('CONTINUE decision', () => {
    it('should allow continuation when all checks pass', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
      expect(result.recommendedNextStep).toBe('PROMPT');
      expect(result.reasons).toContain('All stop condition checks passed - safe to continue automation');
      expect(result.evidence.appliedRules).toContain('all_checks_passed');
    });

    it('should allow continuation when under thresholds', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 3,
        },
        failureClass: 'flaky probable',
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
      expect(result.evidence.thresholds.maxRerunsPerJob).toBe(2);
      expect(result.evidence.thresholds.maxTotalRerunsPerPr).toBe(5);
    });
  });

  describe('HOLD decision - max attempts', () => {
    it('should HOLD when max attempts per job reached', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 2, // Equals maxRerunsPerJob
          totalPrAttempts: 2,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('MAX_ATTEMPTS');
      expect(result.recommendedNextStep).toBe('MANUAL_REVIEW');
      expect(result.reasons[0]).toContain('maximum rerun attempts');
      expect(result.evidence.appliedRules).toContain('maxRerunsPerJob');
    });

    it('should HOLD when max total PR attempts reached', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 5, // Equals maxTotalRerunsPerPr
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('MAX_TOTAL_RERUNS');
      expect(result.recommendedNextStep).toBe('MANUAL_REVIEW');
      expect(result.reasons[0]).toContain('maximum total reruns');
      expect(result.evidence.appliedRules).toContain('maxTotalRerunsPerPr');
    });
  });

  describe('HOLD decision - non-retriable failure', () => {
    it('should HOLD for build deterministic failure', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        failureClass: 'build deterministic',
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('NON_RETRIABLE');
      expect(result.recommendedNextStep).toBe('FIX_REQUIRED');
      expect(result.reasons[0]).toContain('non-retriable');
      expect(result.evidence.appliedRules).toContain('blockOnFailureClasses');
    });

    it('should HOLD for lint error failure', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        failureClass: 'lint error',
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('NON_RETRIABLE');
    });

    it('should HOLD for syntax error failure', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        failureClass: 'syntax error in tests',
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('NON_RETRIABLE');
    });
  });

  describe('HOLD decision - no signal change', () => {
    it('should HOLD when same failure signal repeats threshold times', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 2,
        },
        previousFailureSignals: ['hash1', 'hash1', 'hash1'], // Same signal 3 times
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('NO_SIGNAL_CHANGE');
      expect(result.recommendedNextStep).toBe('MANUAL_REVIEW');
      expect(result.reasons[0]).toContain('No signal change detected');
      expect(result.evidence.appliedRules).toContain('noSignalChangeThreshold');
    });

    it('should CONTINUE when signals are changing', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 2,
        },
        previousFailureSignals: ['hash1', 'hash2', 'hash3'], // Different signals
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
    });
  });

  describe('HOLD decision - cooldown', () => {
    it('should HOLD when within cooldown period', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 1,
        },
        lastChangedAt: twoMinutesAgo.toISOString(), // 2 minutes ago, cooldown is 5
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('COOLDOWN_ACTIVE');
      expect(result.recommendedNextStep).toBe('WAIT');
      expect(result.reasons[0]).toContain('Cooldown period active');
      expect(result.evidence.appliedRules).toContain('cooldownMinutes');
    });

    it('should CONTINUE when cooldown has passed', async () => {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 1,
        },
        lastChangedAt: tenMinutesAgo.toISOString(), // 10 minutes ago, cooldown is 5
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
    });
  });

  describe('KILL decision - timeout', () => {
    it('should KILL when max wait time exceeded', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 120 * 60 * 1000);

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 2,
        },
        firstFailureAt: twoHoursAgo.toISOString(), // 120 minutes ago, max is 60
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('KILL');
      expect(result.reasonCode).toBe('TIMEOUT');
      expect(result.recommendedNextStep).toBe('MANUAL_REVIEW');
      expect(result.reasons[0]).toContain('Maximum wait time exceeded');
      expect(result.evidence.appliedRules).toContain('maxWaitMinutesForGreen');
    });

    it('should CONTINUE when within max wait time', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 1,
          totalPrAttempts: 1,
        },
        firstFailureAt: thirtyMinutesAgo.toISOString(), // 30 minutes ago, max is 60
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
    });
  });

  describe('Rule priority', () => {
    it('should prioritize non-retriable over max attempts', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        failureClass: 'build deterministic',
        attemptCounts: {
          currentJobAttempts: 3, // Over max attempts
          totalPrAttempts: 3,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('NON_RETRIABLE'); // Not MAX_ATTEMPTS
    });
  });

  describe('Audit trail', () => {
    it('should record audit event with all required fields', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 2,
          totalPrAttempts: 2,
        },
      };

      await makeStopDecision(context, mockPool);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO stop_decision_audit'),
        expect.arrayContaining([
          'test-owner',
          'test-repo',
          123,
          456,
          expect.any(String), // request_id
          'HOLD', // decision
          'MAX_ATTEMPTS', // reason_code
          expect.any(String), // reasons JSON
          'MANUAL_REVIEW', // recommended_next_step
          null, // failure_class
          2, // current_job_attempts
          2, // total_pr_attempts
          expect.any(String), // lawbook_hash
          expect.any(String), // lawbook_version
          expect.any(String), // applied_rules JSON
          expect.any(String), // evidence JSON
        ])
      );
    });

    it('should not fail if audit insert fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Database error'));

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('CONTINUE');
      // Should still return result even if audit fails
    });
  });

  describe('Default rules fallback', () => {
    it('should use default rules if lawbook fails to load', async () => {
      const { getActiveLawbookVersion } = require('../../src/lib/db/lawbook');
      getActiveLawbookVersion.mockRejectedValueOnce(new Error('Lawbook load failed'));

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        attemptCounts: {
          currentJobAttempts: 2, // Default max is 2
          totalPrAttempts: 2,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.reasonCode).toBe('MAX_ATTEMPTS');
      expect(result.evidence.thresholds.maxRerunsPerJob).toBe(2); // Default value
    });

    it('should use default rules if lawbook has no stopRules', async () => {
      const lawbookWithoutStopRules = { ...mockLawbook };
      delete (lawbookWithoutStopRules as any).stopRules;

      const { getActiveLawbookVersion } = require('../../src/lib/db/lawbook');
      getActiveLawbookVersion.mockResolvedValueOnce(lawbookWithoutStopRules);

      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        attemptCounts: {
          currentJobAttempts: 2, // Default max is 2
          totalPrAttempts: 2,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result.decision).toBe('HOLD');
      expect(result.evidence.thresholds.maxRerunsPerJob).toBe(2);
    });
  });

  describe('Response structure', () => {
    it('should return all required fields in StopDecisionV1', async () => {
      const context: StopDecisionContext = {
        owner: 'test-owner',
        repo: 'test-repo',
        prNumber: 123,
        runId: 456,
        attemptCounts: {
          currentJobAttempts: 0,
          totalPrAttempts: 0,
        },
      };

      const result = await makeStopDecision(context, mockPool);

      expect(result).toMatchObject({
        schemaVersion: '1.0',
        requestId: expect.any(String),
        lawbookHash: expect.any(String),
        deploymentEnv: expect.stringMatching(/^(staging|prod)$/),
        target: {
          prNumber: 123,
          runId: 456,
        },
        decision: expect.stringMatching(/^(CONTINUE|HOLD|KILL)$/),
        reasons: expect.any(Array),
        recommendedNextStep: expect.stringMatching(/^(PROMPT|MANUAL_REVIEW|FIX_REQUIRED|WAIT)$/),
        evidence: {
          attemptCounts: expect.any(Object),
          thresholds: expect.any(Object),
          appliedRules: expect.any(Array),
        },
        metadata: {
          evaluatedAt: expect.any(String),
        },
      });
    });
  });
});
