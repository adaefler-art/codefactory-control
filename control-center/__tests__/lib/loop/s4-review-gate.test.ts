/**
 * Unit Tests: S4 Review Gate Step Executor (E9.3-CTRL-01 + E9.3-CTRL-03)
 * 
 * Tests the S4 step executor for explicit review request gate with
 * combined Review + Checks gate decision.
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  executeS4,
  type StepContext,
} from '../../../src/lib/loop/stepExecutors/s4-review-gate';
import { IssueState, LoopStep, BlockerCode } from '../../../src/lib/loop/stateMachine';
import { getLoopEventStore } from '../../../src/lib/loop/eventStore';
import { captureSnapshotForPR } from '../../../src/lib/github/checks-mirror-service';
import { makeS4GateDecision, S4BlockReason } from '../../../src/lib/loop/s4-gate-decision';

// Mock dependencies
jest.mock('../../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../../src/lib/loop/eventStore', () => ({
  getLoopEventStore: jest.fn(),
  LoopEventType: {
    REVIEW_REQUESTED: 'loop_review_requested',
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
  S4BlockReason: {
    NO_REVIEW_APPROVAL: 'NO_REVIEW_APPROVAL',
    CHANGES_REQUESTED: 'CHANGES_REQUESTED',
    CHECKS_PENDING: 'CHECKS_PENDING',
    CHECKS_FAILED: 'CHECKS_FAILED',
    NO_CHECKS_FOUND: 'NO_CHECKS_FOUND',
    SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
    SNAPSHOT_FETCH_FAILED: 'SNAPSHOT_FETCH_FAILED',
    PR_FETCH_FAILED: 'PR_FETCH_FAILED',
  },
}));

describe('E9.3-CTRL-01 + E9.3-CTRL-03: S4 Review Gate Step Executor', () => {
  let mockPool: jest.Mocked<Pool>;
  let mockEventStore: any;

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
        event_type: 'loop_review_requested',
        event_data: {},
        occurred_at: new Date(),
      }),
    };

    (getLoopEventStore as jest.Mock).mockReturnValue(mockEventStore);
  });

  describe('Validation', () => {
    test('should block S4 when issue is not in IMPLEMENTING_PREP state', async () => {
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
          status: IssueState.CREATED,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
    });

    test('should block S4 when GitHub link is missing', async () => {
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
          github_url: null,
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
    });

    test('should block S4 when PR is not linked', async () => {
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
          pr_url: null,
        }],
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
    });
  });

  describe('Dry-run Mode', () => {
    test('should validate without state changes in dry-run mode', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'dryRun',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.IMPLEMENTING_PREP,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
    });
  });

  describe('Successful Execution', () => {
    test('should execute S4 successfully when gate decision passes', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      const mockSnapshot = {
        id: 'snap-123',
        run_id: 'run-123',
        issue_id: 'issue-123',
        repo_owner: 'org',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T10:00:00Z',
        checks: [],
        total_checks: 5,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash123',
        request_id: 'req-123',
        created_at: '2026-02-04T10:00:00Z',
        updated_at: '2026-02-04T10:00:00Z',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.IMPLEMENTING_PREP,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: IssueState.REVIEW_READY }],
        });

      (captureSnapshotForPR as jest.Mock).mockResolvedValue({
        success: true,
        snapshot: mockSnapshot,
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValue({
        verdict: 'PASS',
        reviewStatus: 'APPROVED',
        checksStatus: 'PASS',
        snapshot: mockSnapshot,
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
      expect(captureSnapshotForPR).toHaveBeenCalledWith(
        mockPool,
        'org',
        'repo',
        456,
        expect.objectContaining({
          run_id: 'run-123',
          issue_id: 'issue-123',
          request_id: 'req-123',
        })
      );
      expect(makeS4GateDecision).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          owner: 'org',
          repo: 'repo',
          prNumber: 456,
          snapshotId: 'snap-123',
          requestId: 'req-123',
        })
      );
    });

    test('should block S4 when gate decision fails due to no review approval', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      const mockSnapshot = {
        id: 'snap-123',
        run_id: 'run-123',
        issue_id: 'issue-123',
        repo_owner: 'org',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T10:00:00Z',
        checks: [],
        total_checks: 5,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash123',
        request_id: 'req-123',
        created_at: '2026-02-04T10:00:00Z',
        updated_at: '2026-02-04T10:00:00Z',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.IMPLEMENTING_PREP,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValue({
        success: true,
        snapshot: mockSnapshot,
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValue({
        verdict: 'FAIL',
        blockReason: S4BlockReason.NO_REVIEW_APPROVAL,
        blockMessage: 'PR review not approved',
        reviewStatus: 'NOT_APPROVED',
        checksStatus: 'PASS',
        snapshot: mockSnapshot,
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockReason.NO_REVIEW_APPROVAL);
      expect(result.blockerMessage).toBe('PR review not approved');
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.IMPLEMENTING_PREP);
    });

    test('should block S4 when gate decision fails due to checks failed', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      const mockSnapshot = {
        id: 'snap-123',
        run_id: 'run-123',
        issue_id: 'issue-123',
        repo_owner: 'org',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T10:00:00Z',
        checks: [],
        total_checks: 5,
        failed_checks: 2,
        pending_checks: 0,
        snapshot_hash: 'hash123',
        request_id: 'req-123',
        created_at: '2026-02-04T10:00:00Z',
        updated_at: '2026-02-04T10:00:00Z',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rows: [{
          id: 'issue-123',
          status: IssueState.IMPLEMENTING_PREP,
          github_url: 'https://github.com/org/repo/issues/123',
          pr_url: 'https://github.com/org/repo/pull/456',
        }],
      });

      (captureSnapshotForPR as jest.Mock).mockResolvedValue({
        success: true,
        snapshot: mockSnapshot,
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValue({
        verdict: 'FAIL',
        blockReason: S4BlockReason.CHECKS_FAILED,
        blockMessage: '2 check(s) failed',
        reviewStatus: 'APPROVED',
        checksStatus: 'FAIL',
        snapshot: mockSnapshot,
      });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockReason.CHECKS_FAILED);
      expect(result.blockerMessage).toBe('2 check(s) failed');
    });

    test('should record review-intent event with gate decision data', async () => {
      const ctx: StepContext = {
        issueId: 'issue-123',
        runId: 'run-123',
        requestId: 'req-123',
        actor: 'test-actor',
        mode: 'execute',
      };

      const mockSnapshot = {
        id: 'snap-123',
        run_id: 'run-123',
        issue_id: 'issue-123',
        repo_owner: 'org',
        repo_name: 'repo',
        ref: 'abc123',
        captured_at: '2026-02-04T10:00:00Z',
        checks: [],
        total_checks: 5,
        failed_checks: 0,
        pending_checks: 0,
        snapshot_hash: 'hash123',
        request_id: 'req-123',
        created_at: '2026-02-04T10:00:00Z',
        updated_at: '2026-02-04T10:00:00Z',
      };

      (mockPool.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'issue-123',
            status: IssueState.IMPLEMENTING_PREP,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: IssueState.REVIEW_READY }],
        });

      (captureSnapshotForPR as jest.Mock).mockResolvedValue({
        success: true,
        snapshot: mockSnapshot,
      });

      (makeS4GateDecision as jest.Mock).mockResolvedValue({
        verdict: 'PASS',
        reviewStatus: 'APPROVED',
        checksStatus: 'PASS',
        snapshot: mockSnapshot,
      });

      await executeS4(mockPool, ctx);

      expect(mockEventStore.createEvent).toHaveBeenCalledWith({
        issueId: 'issue-123',
        runId: 'run-123',
        eventType: 'loop_review_requested',
        eventData: expect.objectContaining({
          runId: 'run-123',
          step: LoopStep.S4_REVIEW,
          stateBefore: IssueState.IMPLEMENTING_PREP,
          requestId: 'req-123',
          prUrl: 'https://github.com/org/repo/pull/456',
          gateDecision: {
            verdict: 'PASS',
            reviewStatus: 'APPROVED',
            checksStatus: 'PASS',
            snapshotId: 'snap-123',
          },
        }),
      });
    });
  });
});
