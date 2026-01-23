/**
 * Tests for S3 Step Executor: Implement Prep
 * 
 * E9.1-CTRL-7: Validates state transition to IMPLEMENTING_PREP only when SPEC_READY
 */

import { Pool } from 'pg';
import { executeS3, StepContext, StepExecutionResult } from '../../../src/lib/loop/stepExecutors/s3-implement-prep';
import { BlockerCode, IssueState } from '../../../src/lib/loop/stateMachine';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('S3 Step Executor: Implement Prep', () => {
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

  describe('Success scenarios', () => {
    test('should transition from SPEC_READY to IMPLEMENTING_PREP in execute mode', async () => {
      // Mock issue in SPEC_READY state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'SPEC_READY',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock status update
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe('SPEC_READY');
      expect(result.stateAfter).toBe('IMPLEMENTING_PREP');
      expect(result.fieldsChanged).toEqual(['status']);
      expect(result.message).toContain('transitioned to IMPLEMENTING_PREP');

      // Verify status was updated
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE afu9_issues'),
        ['IMPLEMENTING_PREP', 'test-issue-id']
      );

      // Verify timeline event was logged
      const timelineCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO issue_timeline')
      );
      expect(timelineCall).toBeDefined();
      
      const eventData = JSON.parse(timelineCall![1][2]);
      expect(eventData).toMatchObject({
        step: 'S3_IMPLEMENT_PREP',
        stepName: 'loop_step_s3_implement_prep',
        stateBefore: 'SPEC_READY',
        stateAfter: 'IMPLEMENTING_PREP',
        blocked: false,
        fieldsChanged: ['status'],
      });
    });

    test('should not update status in dry-run mode', async () => {
      // Mock issue in SPEC_READY state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'SPEC_READY',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const dryRunContext: StepContext = {
        ...baseContext,
        mode: 'dryRun',
      };

      const result = await executeS3(mockPool, dryRunContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe('SPEC_READY');
      expect(result.stateAfter).toBe('IMPLEMENTING_PREP');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.message).toContain('dry-run complete');
      expect(result.message).toContain('would transition to');

      // Verify status was NOT updated (no UPDATE query)
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE afu9_issues'),
        expect.anything()
      );

      // But timeline event should still be logged
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO issue_timeline'),
        expect.anything()
      );
    });
  });

  describe('Idempotency scenarios', () => {
    test('should be no-op when already in IMPLEMENTING_PREP', async () => {
      // Mock issue already in IMPLEMENTING_PREP
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'IMPLEMENTING_PREP',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe('IMPLEMENTING_PREP');
      expect(result.stateAfter).toBe('IMPLEMENTING_PREP');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.message).toContain('Already in IMPLEMENTING_PREP');
      expect(result.message).toContain('no-op');

      // Verify status was NOT updated
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE afu9_issues'),
        expect.anything()
      );

      // Verify timeline event logged with isNoOp flag
      const timelineCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO issue_timeline')
      );
      expect(timelineCall).toBeDefined();
      
      const eventData = JSON.parse(timelineCall![1][2]);
      expect(eventData).toMatchObject({
        isNoOp: true,
        blocked: false,
      });
    });
  });

  describe('Blocked scenarios', () => {
    test('should block with INVARIANT_VIOLATION when in CREATED state', async () => {
      // Mock issue in CREATED state (not SPEC_READY)
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: null,
            current_draft_id: null,
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.blockerMessage).toContain('requires state SPEC_READY');
      expect(result.blockerMessage).toContain('CREATED');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.stateBefore).toBe('CREATED');
      expect(result.stateAfter).toBe('CREATED');

      // Verify status was NOT updated
      expect(mockQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE afu9_issues'),
        expect.anything()
      );

      // Verify timeline event was logged with blocked flag
      const timelineCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO issue_timeline')
      );
      expect(timelineCall).toBeDefined();
      
      const eventData = JSON.parse(timelineCall![1][2]);
      expect(eventData).toMatchObject({
        blocked: true,
        blockerCode: BlockerCode.INVARIANT_VIOLATION,
      });
    });

    test('should block with INVARIANT_VIOLATION when in DONE state', async () => {
      // Mock issue in terminal DONE state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'DONE',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.blockerMessage).toContain('requires state SPEC_READY');
      expect(result.blockerMessage).toContain('DONE');
    });

    test('should block with INVARIANT_VIOLATION when in HOLD state', async () => {
      // Mock issue in terminal HOLD state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'HOLD',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.INVARIANT_VIOLATION);
      expect(result.blockerMessage).toContain('requires state SPEC_READY');
      expect(result.blockerMessage).toContain('HOLD');
    });

    test('should block with UNKNOWN_STATE when state is invalid', async () => {
      // Mock issue with unknown/invalid state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'INVALID_STATE_XYZ',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS3(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.UNKNOWN_STATE);
      expect(result.blockerMessage).toContain('unknown state');
      expect(result.blockerMessage).toContain('INVALID_STATE_XYZ');
      expect(result.fieldsChanged).toEqual([]);
    });
  });

  describe('Error scenarios', () => {
    test('should throw error when issue not found', async () => {
      // Mock issue not found
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      await expect(executeS3(mockPool, baseContext)).rejects.toThrow(
        'Issue not found: test-issue-id'
      );
    });
  });

  describe('Timeline event logging', () => {
    test('should log timeline event with correct structure for success', async () => {
      // Mock issue in SPEC_READY state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'SPEC_READY',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-123',
            handoff_state: 'SYNCED',
          },
        ],
      });

      // Mock status update
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS3(mockPool, baseContext);

      // Verify timeline event structure
      const timelineCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO issue_timeline')
      );
      expect(timelineCall).toBeDefined();
      expect(timelineCall![1][0]).toBe('test-issue-id');
      expect(timelineCall![1][1]).toBe('RUN_STARTED');
      expect(timelineCall![1][3]).toBe('test-actor');
      expect(timelineCall![1][4]).toBe('system');
      
      const eventData = JSON.parse(timelineCall![1][2]);
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S3_IMPLEMENT_PREP',
        stepName: 'loop_step_s3_implement_prep',
        stateBefore: 'SPEC_READY',
        stateAfter: 'IMPLEMENTING_PREP',
        requestId: 'test-request-id',
        blocked: false,
        fieldsChanged: ['status'],
        mode: 'execute',
      });
    });

    test('should log timeline event with correct structure for blocked', async () => {
      // Mock issue in wrong state
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: null,
            current_draft_id: null,
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS3(mockPool, baseContext);

      // Verify timeline event structure for blocked case
      const timelineCall = mockQuery.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('INSERT INTO issue_timeline')
      );
      expect(timelineCall).toBeDefined();
      expect(timelineCall![1][0]).toBe('test-issue-id');
      expect(timelineCall![1][1]).toBe('RUN_STARTED');
      expect(timelineCall![1][3]).toBe('test-actor');
      expect(timelineCall![1][4]).toBe('system');
      
      const eventData = JSON.parse(timelineCall![1][2]);
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S3_IMPLEMENT_PREP',
        stateBefore: 'CREATED',
        stateAfter: 'CREATED',
        requestId: 'test-request-id',
        blocked: true,
        blockerCode: 'INVARIANT_VIOLATION',
        mode: 'execute',
        expectedState: 'SPEC_READY',
      });
    });
  });
});
