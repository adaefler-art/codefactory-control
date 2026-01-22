/**
 * Tests for S1 Step Executor: Pick/Link Issue
 * 
 * E9.1-CTRL-5: Validates idempotent behavior and timeline event creation
 */

import { Pool } from 'pg';
import { executeS1, StepContext, StepExecutionResult } from '../../../src/lib/loop/stepExecutors/s1-pick-issue';
import { BlockerCode } from '../../../src/lib/loop/stateMachine';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('S1 Step Executor: Pick/Link Issue', () => {
  const baseContext: StepContext = {
    issueId: 'test-issue-id',
    runId: 'test-run-id',
    requestId: 'test-request-id',
    actor: 'test-actor',
    mode: 'execute',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Blocked scenarios', () => {
    test('should block with NO_GITHUB_LINK when github_url is null', async () => {
      // Mock issue without github_url
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: null,
            assignee: null,
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS1(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
      expect(result.blockerMessage).toBe('S1 (Pick Issue) requires GitHub issue link');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.stateBefore).toBe('CREATED');
      expect(result.stateAfter).toBe('CREATED');

      // Verify timeline event was logged
      expect(mockQuery).toHaveBeenCalledTimes(2); // 1 for fetch, 1 for timeline
      const timelineCall = mockQuery.mock.calls[1];
      expect(timelineCall[0]).toContain('INSERT INTO issue_timeline');
    });

    test('should block with NO_GITHUB_LINK when github_url is empty string', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: '   ',
            assignee: 'someone',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS1(mockPool, baseContext);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_GITHUB_LINK);
    });
  });

  describe('Idempotent (no-op) scenarios', () => {
    test('should be no-op when all fields are already present', async () => {
      // Mock issue with all required fields
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            assignee: 'existing-assignee',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS1(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.fieldsChanged).toEqual([]);
      expect(result.message).toContain('no-op');

      // Verify no UPDATE was executed (only SELECT and timeline INSERT)
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[0][0]).toContain('SELECT');
      expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO issue_timeline');
    });
  });

  describe('Execution scenarios', () => {
    test('should set assignee when missing in execute mode', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            assignee: null,
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock UPDATE query for assignee
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS1(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.fieldsChanged).toEqual(['assignee']);
      expect(result.message).toContain('Set ownership');

      // Verify UPDATE was executed
      expect(mockQuery).toHaveBeenCalledTimes(3); // SELECT, UPDATE, INSERT timeline
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE afu9_issues');
      expect(updateCall[0]).toContain('SET assignee');
      expect(updateCall[1]).toEqual(['test-actor', 'test-issue-id']);
    });

    test('should not update in dryRun mode', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            assignee: null,
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS1(mockPool, {
        ...baseContext,
        mode: 'dryRun',
      });

      expect(result.success).toBe(true);
      expect(result.fieldsChanged).toEqual([]);

      // Verify no UPDATE was executed in dry run
      expect(mockQuery).toHaveBeenCalledTimes(2); // Only SELECT and timeline INSERT
    });
  });

  describe('Timeline event creation', () => {
    test('should create timeline event with correct structure for success', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            assignee: 'existing',
            handoff_state: 'SYNCED',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS1(mockPool, baseContext);

      const timelineCall = mockQuery.mock.calls[1];
      expect(timelineCall[0]).toContain('INSERT INTO issue_timeline');
      
      // Verify event data structure
      const eventData = JSON.parse(timelineCall[1][2]);
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S1_PICK_ISSUE',
        stateBefore: 'CREATED',
        stateAfter: 'CREATED',
        requestId: 'test-request-id',
        blocked: false,
        mode: 'execute',
      });
    });

    test('should create timeline event with blocker info when blocked', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: null,
            assignee: null,
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS1(mockPool, baseContext);

      const timelineCall = mockQuery.mock.calls[1];
      const eventData = JSON.parse(timelineCall[1][2]);
      
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S1_PICK_ISSUE',
        blocked: true,
        blockerCode: BlockerCode.NO_GITHUB_LINK,
      });
    });
  });

  describe('Error scenarios', () => {
    test('should throw error when issue not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      await expect(executeS1(mockPool, baseContext)).rejects.toThrow(
        'Issue not found: test-issue-id'
      );
    });
  });
});
