/**
 * Tests for S2 Step Executor: Spec Gate
 * 
 * E9.1-CTRL-6: Validates spec readiness through draft lifecycle checks
 */

import { Pool } from 'pg';
import { executeS2, StepContext, StepExecutionResult } from '../../../src/lib/loop/stepExecutors/s2-spec-gate';
import { BlockerCode } from '../../../src/lib/loop/stateMachine';

// Mock pg Pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('S2 Step Executor: Spec Gate', () => {
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
    test('should block with NO_DRAFT when source_session_id is null', async () => {
      // Mock issue without source_session_id
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

      const result = await executeS2(mockPool, baseContext);

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_DRAFT);
      expect(result.blockerMessage).toContain('source INTENT session');
      expect(result.fieldsChanged).toEqual([]);
      expect(result.stateBefore).toBe('CREATED');
      expect(result.stateAfter).toBe('CREATED');

      // Verify timeline event was logged
      expect(mockQuery).toHaveBeenCalledTimes(2); // 1 for fetch issue, 1 for timeline
    });

    test('should block with NO_DRAFT when draft does not exist for session', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: null,
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock draft query returning no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, baseContext);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_DRAFT);
      expect(result.message).toContain('Draft does not exist');
    });

    test('should block with NO_COMMITTED_DRAFT when no version exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock draft query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'valid',
            last_validation_at: new Date(),
          },
        ],
      });

      // Mock version query returning no rows
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, baseContext);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.NO_COMMITTED_DRAFT);
      expect(result.message).toContain('has not been committed');
    });

    test('should block with DRAFT_INVALID when validation status is not valid', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock draft query with invalid validation status
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'invalid',
            last_validation_at: new Date(),
          },
        ],
      });

      // Mock version query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'version-789',
            version_number: 1,
            issue_hash: 'hash123',
          },
        ],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, baseContext);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.DRAFT_INVALID);
      expect(result.message).toContain("validation status is 'invalid'");
    });

    test('should block with DRAFT_INVALID when validation status is unknown', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'unknown',
            last_validation_at: null,
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'version-789',
            version_number: 1,
            issue_hash: 'hash123',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, baseContext);

      expect(result.blocked).toBe(true);
      expect(result.blockerCode).toBe(BlockerCode.DRAFT_INVALID);
    });
  });

  describe('Success scenarios', () => {
    test('should succeed and transition to SPEC_READY when all checks pass', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      // Mock draft query with valid status
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'valid',
            last_validation_at: new Date(),
          },
        ],
      });

      // Mock version query
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'version-789',
            version_number: 1,
            issue_hash: 'hash123',
          },
        ],
      });

      // Mock UPDATE query
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      // Mock timeline event insertion
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, baseContext);

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.stateBefore).toBe('CREATED');
      expect(result.stateAfter).toBe('SPEC_READY');
      expect(result.fieldsChanged).toEqual(['status']);
      expect(result.message).toContain('Spec ready');

      // Verify UPDATE was executed
      expect(mockQuery).toHaveBeenCalledTimes(5);
      const updateCall = mockQuery.mock.calls[3];
      expect(updateCall[0]).toContain('UPDATE afu9_issues');
      expect(updateCall[0]).toContain('SET status');
      expect(updateCall[1]).toEqual(['SPEC_READY', 'test-issue-id']);
    });

    test('should not update in dryRun mode but still succeed', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'test-issue-id',
            status: 'CREATED',
            github_url: 'https://github.com/org/repo/issues/123',
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'valid',
            last_validation_at: new Date(),
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'version-789',
            version_number: 1,
            issue_hash: 'hash123',
          },
        ],
      });

      // Mock timeline event insertion (no UPDATE in dryRun)
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      const result = await executeS2(mockPool, {
        ...baseContext,
        mode: 'dryRun',
      });

      expect(result.success).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.fieldsChanged).toEqual([]);
      expect(result.message).toContain('dry-run');

      // Verify no UPDATE was executed
      expect(mockQuery).toHaveBeenCalledTimes(4); // issue, draft, version, timeline
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
            source_session_id: 'session-123',
            current_draft_id: 'draft-456',
            handoff_state: 'NOT_SENT',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'draft-456',
            session_id: 'session-123',
            issue_json: { title: 'Test' },
            issue_hash: 'hash123',
            last_validation_status: 'valid',
            last_validation_at: new Date(),
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'version-789',
            version_number: 2,
            issue_hash: 'hash123',
          },
        ],
      });

      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS2(mockPool, baseContext);

      const timelineCall = mockQuery.mock.calls[4];
      expect(timelineCall[0]).toContain('INSERT INTO issue_timeline');
      
      // Verify event data structure
      const eventData = JSON.parse(timelineCall[1][2]);
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S2_SPEC_READY',
        stepName: 'loop_step_s2_spec_ready',
        stateBefore: 'CREATED',
        stateAfter: 'SPEC_READY',
        requestId: 'test-request-id',
        blocked: false,
        mode: 'execute',
        draftId: 'draft-456',
        versionId: 'version-789',
        versionNumber: 2,
      });
    });

    test('should create timeline event with blocker info when blocked', async () => {
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

      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'event-id', created_at: new Date() }],
      });

      await executeS2(mockPool, baseContext);

      const timelineCall = mockQuery.mock.calls[1];
      const eventData = JSON.parse(timelineCall[1][2]);
      
      expect(eventData).toMatchObject({
        runId: 'test-run-id',
        step: 'S2_SPEC_READY',
        blocked: true,
        blockerCode: BlockerCode.NO_DRAFT,
      });
    });
  });

  describe('Error scenarios', () => {
    test('should throw error when issue not found', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });

      await expect(executeS2(mockPool, baseContext)).rejects.toThrow(
        'Issue not found: test-issue-id'
      );
    });
  });
});
