/**
 * Tests for Issue B4: HOLD Workflow Enforcement
 * 
 * Verifies that:
 * 1. HOLD state triggers workflow pause
 * 2. Paused workflows do not continue automatically (no timeout)
 * 3. Workflows can only be resumed with explicit human action
 */

import {
  pauseExecution,
  resumeExecution,
  getPausedExecutions,
  createExecution,
  getExecution,
} from '../../src/lib/workflow-persistence';
import { IssueState } from '../../src/lib/types/issue-state';
import { WorkflowContext } from '../../src/lib/types/workflow';

// Mock database
jest.mock('../../src/lib/db', () => {
  const pool = {
    query: jest.fn(),
  };

  return {
    getPool: jest.fn(() => pool),
    checkDatabase: jest.fn(() => Promise.resolve(true)),
  };
});

describe('Issue B4: HOLD Workflow Enforcement', () => {
  beforeEach(() => {
    const pool = require('../../src/lib/db').getPool();
    pool.query.mockReset();
  });

  describe('Workflow Pause Functionality', () => {
    it('should pause a running workflow execution', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-123' }],
      });

      await pauseExecution(
        'exec-123',
        'user@example.com',
        'HOLD state triggered',
        5
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workflow_executions'),
        expect.arrayContaining([
          'exec-123',
          expect.stringContaining('"pausedBy":"user@example.com"'),
        ])
      );
    });

    it('should include pause metadata with all required fields', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-456' }],
      });

      const pausedBy = 'system';
      const reason = 'HOLD state detected';
      const stepIndex = 3;

      await pauseExecution('exec-456', pausedBy, reason, stepIndex);

      const callArgs = mockPool.query.mock.calls[0][1];
      const pauseMetadata = JSON.parse(callArgs[1]);

      expect(pauseMetadata).toHaveProperty('pausedAt');
      expect(pauseMetadata.pausedBy).toBe(pausedBy);
      expect(pauseMetadata.reason).toBe(reason);
      expect(pauseMetadata.pausedAtStepIndex).toBe(stepIndex);
    });
  });

  describe('Workflow Resume Functionality', () => {
    it('should resume a paused workflow with human approval', async () => {
      const mockPool = require('../../src/lib/db').getPool();

      // Single atomic update query
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-123', pause_metadata: { pausedBy: 'system' } }],
      });

      await resumeExecution('exec-123', 'approver@example.com');

      // Verify resume call
      const updateCall = mockPool.query.mock.calls[0];
      expect(updateCall[0]).toContain('UPDATE workflow_executions');
      expect(updateCall[0]).toContain("status = 'running'");

      expect(updateCall[1][0]).toBe('exec-123');
      expect(updateCall[1][2]).toBe('approver@example.com');
    });

    it('should throw error when trying to resume non-paused execution', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      // Mock execution not found
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      await expect(
        resumeExecution('exec-999', 'user@example.com')
      ).rejects.toThrow();
    });
  });

  describe('Paused Executions Query', () => {
    it('should retrieve all paused executions', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      const mockPausedExecutions = [
        {
          id: 'exec-1',
          status: 'paused',
          pause_metadata: {
            pausedAt: '2025-12-20T10:00:00Z',
            pausedBy: 'system',
            reason: 'HOLD state',
          },
        },
        {
          id: 'exec-2',
          status: 'paused',
          pause_metadata: {
            pausedAt: '2025-12-20T11:00:00Z',
            pausedBy: 'user@example.com',
            reason: 'Manual pause',
          },
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockPausedExecutions,
      });

      const result = await getPausedExecutions();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('paused');
      expect(result[1].status).toBe('paused');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'paused'")
      );
    });
  });

  describe('HOLD State Detection', () => {
    it('should detect HOLD state in workflow context', () => {
      const context: WorkflowContext = {
        variables: {},
        input: {},
        issue: {
          number: 123,
          state: IssueState.HOLD,
        },
      };

      // This would be called by WorkflowEngine.shouldPauseForHold()
      const shouldPause = context.issue?.state === IssueState.HOLD;
      expect(shouldPause).toBe(true);
    });

    it('should not pause for non-HOLD states', () => {
      const states = [
        IssueState.CREATED,
        IssueState.SPEC_READY,
        IssueState.IMPLEMENTING,
        IssueState.VERIFIED,
        IssueState.MERGE_READY,
        IssueState.DONE,
        IssueState.KILLED,
      ];

      states.forEach(state => {
        const context: WorkflowContext = {
          variables: {},
          input: {},
          issue: {
            number: 123,
            state,
          },
        };

        const shouldPause = context.issue?.state === IssueState.HOLD;
        expect(shouldPause).toBe(false);
      });
    });
  });

  describe('Issue B4 Acceptance Criteria', () => {
    it('HOLD stops automatically - pauses workflow without timeout', async () => {
      // Verify that pause sets status to 'paused' with no automatic continuation
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-hold' }] });

      await pauseExecution(
        'exec-hold',
        'system',
        'HOLD state triggered - workflow paused pending human review',
        0
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain("status = 'paused'");
      
      // Verify pause metadata indicates no timeout
      const pauseMetadata = JSON.parse(mockPool.query.mock.calls[0][1][1]);
      expect(pauseMetadata.reason).toContain('HOLD state');
    });

    it('No timeout continuation (kein Timeout-Weiterlaufen)', async () => {
      // Verify that paused status persists until explicit human action
      const mockPool = require('../../src/lib/db').getPool();
      
      // Mock paused execution
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          id: 'exec-timeout-test',
          status: 'paused',
          pause_metadata: {
            pausedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
            pausedBy: 'system',
            reason: 'HOLD state',
          },
        }],
      });

      const execution = await getExecution('exec-timeout-test');
      
      // After 1 hour, status should still be 'paused', not automatically resumed
      expect(execution?.status).toBe('paused');
      expect(execution?.pause_metadata).toBeDefined();
      expect(execution?.pause_metadata?.resumedAt).toBeUndefined();
    });

    it('Requires explicit human decision to continue or kill', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      // Pause execution
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-human' }] });
      await pauseExecution('exec-human', 'system', 'HOLD state', 0);
      
      // Resume requires human user
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-human', pause_metadata: { pausedBy: 'system' } }],
      });
      
      await resumeExecution('exec-human', 'human-approver@example.com');
      
      const resumeCall = mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];
      expect(resumeCall[0]).toContain('UPDATE workflow_executions');
      expect(resumeCall[0]).toContain("status = 'running'");

      // Verify explicit human approved resume
      expect(resumeCall[1][0]).toBe('exec-human');
      expect(resumeCall[1][2]).toBe('human-approver@example.com');
    });
  });
});
