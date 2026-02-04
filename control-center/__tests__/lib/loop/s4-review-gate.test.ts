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
  S4BlockerCode,
  type IssueForS4,
  type ExecuteS4Params,
} from '../../../src/lib/loop/stepExecutors/s4-review-gate';
import { IssueState, LoopStep } from '../../../src/lib/loop/stateMachine';
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
    // Reset mocks
    jest.clearAllMocks();

    // Mock pool
    mockPool = {
      query: jest.fn(),
    } as any;

    // Mock event store
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
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.CREATED,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockerCode.NO_PR_LINKED);
      expect(result.blockerMessage).toContain('IMPLEMENTING_PREP');
    });

    test('should block S4 when GitHub link is missing', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: null,
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockerCode.NO_GITHUB_LINK);
      expect(result.blockerMessage).toContain('GitHub issue link');
    });

    test('should block S4 when PR is not linked', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: null,
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockerCode.NO_PR_LINKED);
      expect(result.blockerMessage).toContain('PR to be linked');
    });

    test('should block S4 when PR URL is empty string', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: '   ',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(S4BlockerCode.NO_PR_LINKED);
    });
  });

  describe('Dry-run Mode', () => {
    test('should validate without state changes in dry-run mode', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'dryRun',
      };

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(true);
      expect(result.step).toBe('S4_REVIEW');
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
      
      // Should not modify database in dry-run
      expect(mockPool.query).not.toHaveBeenCalled();
      expect(mockEventStore.createEvent).not.toHaveBeenCalled();
    });
  });

  describe('Successful Execution', () => {
    test('should execute S4 successfully and transition to REVIEW_READY', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      // Mock successful state update
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ status: IssueState.REVIEW_READY }],
      });

      const result = await executeS4(mockPool, params);

      expect(result.success).toBe(true);
      expect(result.step).toBe('S4_REVIEW');
      expect(result.stateBefore).toBe(IssueState.IMPLEMENTING_PREP);
      expect(result.stateAfter).toBe(IssueState.REVIEW_READY);
      expect(result.reviewIntent.eventId).toBe('event-123');
      expect(result.reviewIntent.prUrl).toBe('https://github.com/org/repo/pull/456');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('should record review-intent event with correct payload', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ status: IssueState.REVIEW_READY }],
      });

      await executeS4(mockPool, params);

      // Verify event was created with correct payload
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

    test('should update issue status to REVIEW_READY', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ status: IssueState.REVIEW_READY }],
      });

      await executeS4(mockPool, params);

      // Verify database update
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE afu9_issues'),
        [IssueState.REVIEW_READY, 'issue-123']
      );
    });

    test('should throw error if database update fails', async () => {
      const issue: IssueForS4 = {
        id: 'issue-123',
        status: IssueState.IMPLEMENTING_PREP,
        github_url: 'https://github.com/org/repo/issues/123',
        pr_url: 'https://github.com/org/repo/pull/456',
      };

      const params: ExecuteS4Params = {
        issue,
        runId: 'run-123',
        requestId: 'req-123',
        mode: 'execute',
      };

      // Mock failed update (no rows affected)
      (mockPool.query as jest.Mock).mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      await expect(executeS4(mockPool, params)).rejects.toThrow('Failed to update issue state');
    });
  });
});
