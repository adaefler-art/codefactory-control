/**
 * Unit Tests: S5 Merge Step Executor (E9.3-CTRL-04)
 * 
 * Tests the S5 step executor for controlled merge with gate verdict validation.
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeS5,
  type StepContext,
} from '../../../src/lib/loop/stepExecutors/s5-merge';
import { IssueState, LoopStep, BlockerCode } from '../../../src/lib/loop/stateMachine';
import { getLoopEventStore } from '../../../src/lib/loop/eventStore';
import { captureSnapshotForPR } from '../../../src/lib/github/checks-mirror-service';
import { makeS4GateDecision } from '../../../src/lib/loop/s4-gate-decision';
import { createAuthenticatedClient } from '../../../src/lib/github/auth-wrapper';

// Mock dependencies
jest.mock('../../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../../src/lib/loop/eventStore', () => ({
  getLoopEventStore: jest.fn(),
  LoopEventType: {
    MERGED: 'loop_merged',
  },
}));

jest.mock('../../../src/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../../src/lib/github/checks-mirror-service', () => ({
  captureSnapshotForPR: jest.fn(),
}));

jest.mock('../../../src/lib/loop/s4-gate-decision', () => ({
  makeS4GateDecision: jest.fn(),
}));

jest.mock('../../../src/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
}));

describe('E9.3-CTRL-04: S5 Merge Step Executor', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockEventStore: any;
  let mockOctokit: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPool = {
      query: jest.fn(),
    } as any;

    mockEventStore = {
      createEvent: jest.fn().mockResolvedValue({
        id: 'event-123',
        issue_id: 'issue-123',
        run_id: 'run-123',
        event_type: 'loop_merged',
        event_data: {},
        occurred_at: new Date(),
      }),
    };

    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
          merge: jest.fn(),
        },
      },
    };

    (getLoopEventStore as jest.Mock).mockReturnValue(mockEventStore);
    (createAuthenticatedClient as jest.Mock).mockResolvedValue(mockOctokit);
  });

  describe('Validation', () => {
    test('should block S5 when issue is not in REVIEW_READY state', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.IMPLEMENTING_PREP,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.IMPLEMENTING_PREP);
    });

    test('should block S5 when no PR is linked', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.REVIEW_READY,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: null,
        }],
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_PR_LINKED);
    });

    test('should block S5 when PR is closed', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.REVIEW_READY,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'closed',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.PR_CLOSED);
    });
  });

  describe('Gate Decision', () => {
    test('should block S5 when gate decision is FAIL (no approval)', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValueOnce({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          total_checks: 2,
          failed_checks: 0,
          pending_checks: 0,
        },
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValueOnce({
        verdict: 'FAIL',
        blockReason: 'NO_REVIEW_APPROVAL',
        blockMessage: 'PR review not approved',
        reviewStatus: 'NOT_APPROVED',
        checksStatus: 'PASS',
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_REVIEW_APPROVAL);
      expect(mockEventStore.createEvent).toHaveBeenCalled();
    });

    test('should block S5 when gate decision is FAIL (checks failed)', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValueOnce({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          total_checks: 2,
          failed_checks: 1,
          pending_checks: 0,
        },
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValueOnce({
        verdict: 'FAIL',
        blockReason: 'CHECKS_FAILED',
        blockMessage: 'Checks failed',
        reviewStatus: 'APPROVED',
        checksStatus: 'FAIL',
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.CHECKS_FAILED);
    });
  });

  describe('Idempotency', () => {
    test('should return success if PR is already merged (idempotent)', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'closed',
          merged: true,
          merge_commit_sha: 'merge-sha-123',
          head: { sha: 'abc123' },
        },
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateAfter).toBe(IssueState.DONE);
      expect(mockEventStore.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: expect.stringContaining('merged'),
          eventData: expect.objectContaining({
            mergeSha: 'merge-sha-123',
            idempotent: true,
          }),
        })
      );
      // Merge should NOT be called again
      expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
    });
  });

  describe('Successful Merge', () => {
    test('should successfully merge PR when gate verdict is PASS', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rows: [],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValueOnce({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          total_checks: 2,
          failed_checks: 0,
          pending_checks: 0,
        },
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValueOnce({
        verdict: 'PASS',
        reviewStatus: 'APPROVED',
        checksStatus: 'PASS',
      });

      mockOctokit.rest.pulls.merge.mockResolvedValueOnce({
        data: {
          sha: 'merge-sha-456',
          merged: true,
        },
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe(IssueState.REVIEW_READY);
      expect(result.stateAfter).toBe(IssueState.DONE);
      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
        owner: 'org',
        repo: 'repo',
        pull_number: 456,
        merge_method: 'squash',
      });
      expect(mockEventStore.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: expect.stringContaining('merged'),
          eventData: expect.objectContaining({
            mergeSha: 'merge-sha-456',
            mode: 'execute',
          }),
        })
      );
    });

    test('should simulate merge in dry-run mode', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'dryRun',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValueOnce({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          total_checks: 2,
          failed_checks: 0,
          pending_checks: 0,
        },
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValueOnce({
        verdict: 'PASS',
        reviewStatus: 'APPROVED',
        checksStatus: 'PASS',
      });

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      // In dry-run mode, merge should NOT be called
      expect(mockOctokit.rest.pulls.merge).not.toHaveBeenCalled();
      expect(mockEventStore.createEvent).toHaveBeenCalled();
    });
  });

  describe('Merge Failures', () => {
    test('should block S5 when merge fails due to conflict', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.REVIEW_READY,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        });

      mockOctokit.rest.pulls.get.mockResolvedValueOnce({
        data: {
          state: 'open',
          merged: false,
          head: { sha: 'abc123' },
        },
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValueOnce({
        success: true,
        snapshot: {
          id: 'snapshot-123',
          total_checks: 2,
          failed_checks: 0,
          pending_checks: 0,
        },
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValueOnce({
        verdict: 'PASS',
        reviewStatus: 'APPROVED',
        checksStatus: 'PASS',
      });

      mockOctokit.rest.pulls.merge.mockRejectedValueOnce(
        new Error('Merge conflict detected')
      );

      const result = await executeS5(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.MERGE_CONFLICT);
    });
  });
});
