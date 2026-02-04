/**
 * Unit Tests: S4 Review Gate Step Executor (E9.3-CTRL-01)
 * 
 * Tests the S4 step executor for explicit review request gate.
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

describe('E9.3-CTRL-01: S4 Review Gate Step Executor', () => {
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
    test('should execute S4 successfully and transition to REVIEW_READY', async () => {
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
            status: IssueState.IMPLEMENTING_PREP,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: IssueState.REVIEW_READY }],
        });

      const result = await executeS4(mockPool, ctx);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
    });

    test('should record review-intent event with correct payload', async () => {
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
            status: IssueState.IMPLEMENTING_PREP,
            github_url: 'https://github.com/org/repo/issues/123',
            pr_url: 'https://github.com/org/repo/pull/456',
          }],
        })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: IssueState.REVIEW_READY }],
        });

      await executeS4(mockPool, ctx);

      expect(mockEventStore.createEvent).toHaveBeenCalledWith({
        issueId: 'issue-123',
        runId: 'run-123',
        eventType: 'loop_review_requested',
        eventData: {
          runId: 'run-123',
          step: LoopStep.S4_REVIEW,
          stateBefore: IssueState.IMPLEMENTING_PREP,
          requestId: 'req-123',
          prUrl: 'https://github.com/org/repo/pull/456',
        },
      });
    });
  });
});
