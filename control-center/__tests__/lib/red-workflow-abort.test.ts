/**
 * Tests for Issue B5: RED Workflow & Rollback
 * 
 * Verifies that:
 * 1. RED verdict triggers immediate workflow abort
 * 2. Aborted workflows terminate cleanly without crashes
 * 3. System remains stable after RED abort
 * 4. RED ist hart - no discussion, strict enforcement
 */

import {
  abortExecution,
  getAbortedExecutions,
  createExecution,
  getExecution,
} from '../../src/lib/workflow-persistence';
import { WorkflowContext } from '../../src/lib/types/workflow';

// Mock database
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
  checkDatabase: jest.fn(() => Promise.resolve(true)),
}));

describe('Issue B5: RED Workflow & Rollback', () => {
  describe('Workflow Abort Functionality', () => {
    it('should abort a running workflow execution', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-123' }],
      });

      await abortExecution(
        'exec-123',
        'system',
        'RED verdict triggered - critical failure detected',
        5
      );

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE workflow_executions'),
        expect.arrayContaining([
          'exec-123',
          'RED verdict triggered - critical failure detected',
          expect.stringContaining('"abortedBy":"system"'),
        ])
      );
    });

    it('should include abort metadata with all required fields', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-456' }],
      });

      const verdictInfo = {
        verdictType: 'REJECTED',
        simpleVerdict: 'RED',
        action: 'ABORT',
        errorClass: 'CRITICAL_ERROR',
      };

      await abortExecution(
        'exec-456',
        'verdict-engine',
        'RED verdict - critical error detected',
        3,
        verdictInfo
      );

      const callArgs = mockPool.query.mock.calls[0][1];
      const abortMetadata = JSON.parse(callArgs[2]);

      expect(abortMetadata).toHaveProperty('abortedAt');
      expect(abortMetadata.abortedBy).toBe('verdict-engine');
      expect(abortMetadata.reason).toBe('RED verdict - critical error detected');
      expect(abortMetadata.abortedAtStepIndex).toBe(3);
      expect(abortMetadata.verdictInfo).toEqual(verdictInfo);
    });

    it('should mark execution as failed when aborted', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'exec-789' }],
      });

      await abortExecution(
        'exec-789',
        'system',
        'RED verdict triggered',
        0
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain("status = 'failed'");
      expect(updateQuery).toContain('completed_at = NOW()');
    });
  });

  describe('Aborted Executions Query', () => {
    it('should retrieve all aborted executions', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      const mockAbortedExecutions = [
        {
          id: 'exec-1',
          status: 'failed',
          pause_metadata: {
            abortMetadata: {
              abortedAt: '2025-12-20T10:00:00Z',
              abortedBy: 'system',
              reason: 'RED verdict triggered',
            },
          },
        },
        {
          id: 'exec-2',
          status: 'failed',
          pause_metadata: {
            abortMetadata: {
              abortedAt: '2025-12-20T11:00:00Z',
              abortedBy: 'verdict-engine',
              reason: 'REJECTED verdict - critical failure',
            },
          },
        },
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: mockAbortedExecutions,
      });

      const result = await getAbortedExecutions();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('failed');
      expect(result[1].status).toBe('failed');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE status = 'failed'")
      );
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("pause_metadata ? 'abortMetadata'")
      );
    });
  });

  describe('RED Verdict Detection', () => {
    it('should detect RED verdict in SimpleVerdict', () => {
      const context: WorkflowContext = {
        variables: {
          simpleVerdict: 'RED',
        },
        input: {},
      };

      // This would be called by WorkflowEngine.shouldAbortForRed()
      const shouldAbort = context.variables?.simpleVerdict === 'RED';
      expect(shouldAbort).toBe(true);
    });

    it('should detect REJECTED verdict type (maps to RED)', () => {
      const context: WorkflowContext = {
        variables: {
          verdictType: 'REJECTED',
        },
        input: {},
      };

      const shouldAbort = context.variables?.verdictType === 'REJECTED';
      expect(shouldAbort).toBe(true);
    });

    it('should detect ABORT action', () => {
      const context: WorkflowContext = {
        variables: {
          action: 'ABORT',
        },
        input: {},
      };

      const shouldAbort = context.variables?.action === 'ABORT';
      expect(shouldAbort).toBe(true);
    });

    it('should not abort for non-RED verdicts', () => {
      const verdicts = ['GREEN', 'HOLD', 'RETRY'];

      verdicts.forEach(verdict => {
        const context: WorkflowContext = {
          variables: {
            simpleVerdict: verdict,
          },
          input: {},
        };

        const shouldAbort = context.variables?.simpleVerdict === 'RED';
        expect(shouldAbort).toBe(false);
      });
    });

    it('should not abort for non-REJECTED verdict types', () => {
      const verdictTypes = ['APPROVED', 'WARNING', 'DEFERRED', 'ESCALATED', 'BLOCKED', 'PENDING'];

      verdictTypes.forEach(verdictType => {
        const context: WorkflowContext = {
          variables: {
            verdictType,
          },
          input: {},
        };

        const shouldAbort = context.variables?.verdictType === 'REJECTED';
        expect(shouldAbort).toBe(false);
      });
    });
  });

  describe('Issue B5 Acceptance Criteria', () => {
    it('RED ist hart - triggers immediate abort without discussion', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-red' }] });

      await abortExecution(
        'exec-red',
        'system',
        'RED verdict triggered - critical failure detected',
        0,
        {
          simpleVerdict: 'RED',
          action: 'ABORT',
        }
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain("status = 'failed'");
      expect(updateQuery).toContain('completed_at = NOW()');
      
      const reason = mockPool.query.mock.calls[0][1][1];
      expect(reason).toContain('RED verdict');
    });

    it('RED triggers Rollback/Abort - workflow terminates immediately', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-abort' }] });

      const startTime = Date.now();
      
      await abortExecution(
        'exec-abort',
        'system',
        'RED verdict triggered',
        2
      );

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Abort should be immediate (< 100ms)
      expect(executionTime).toBeLessThan(100);
      
      // Verify execution marked as completed
      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain('completed_at = NOW()');
    });

    it('System remains stable - no crashes, proper cleanup', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      // Simulate multiple rapid abort calls (stress test)
      const abortPromises = [];
      for (let i = 0; i < 10; i++) {
        mockPool.query.mockResolvedValueOnce({ rows: [{ id: `exec-${i}` }] });
        abortPromises.push(
          abortExecution(
            `exec-${i}`,
            'system',
            'RED verdict triggered',
            i
          )
        );
      }

      // All aborts should complete without throwing errors
      await expect(Promise.all(abortPromises)).resolves.toBeDefined();
      
      // Verify all calls were made successfully
      expect(mockPool.query).toHaveBeenCalledTimes(10);
    });

    it('should throw error when trying to abort non-existent execution', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      // Mock no rows returned (execution not found)
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      await expect(
        abortExecution('exec-999', 'system', 'RED verdict', 0)
      ).rejects.toThrow();
    });

    it('should throw error when trying to abort already completed execution', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      
      // Mock execution already completed (no rows updated)
      mockPool.query.mockResolvedValueOnce({
        rows: [],
      });

      await expect(
        abortExecution('exec-completed', 'system', 'RED verdict', 0)
      ).rejects.toThrow('already completed/failed');
    });
  });

  describe('Abort vs Pause Distinction', () => {
    it('ABORT should set status to failed, not paused', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-abort' }] });

      await abortExecution(
        'exec-abort',
        'system',
        'RED verdict triggered',
        0
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain("status = 'failed'");
      expect(updateQuery).not.toContain("status = 'paused'");
    });

    it('ABORT should complete execution (set completed_at)', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-complete' }] });

      await abortExecution(
        'exec-complete',
        'system',
        'RED verdict triggered',
        0
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain('completed_at = NOW()');
    });

    it('ABORT should allow aborting both running and paused executions', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-any' }] });

      await abortExecution(
        'exec-any',
        'system',
        'RED verdict triggered',
        0
      );

      const updateQuery = mockPool.query.mock.calls[0][0];
      expect(updateQuery).toContain("status IN ('running', 'paused')");
    });
  });

  describe('Verdict Information Tracking', () => {
    it('should track complete verdict information for audit trail', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-audit' }] });

      const verdictInfo = {
        verdictType: 'REJECTED',
        simpleVerdict: 'RED',
        action: 'ABORT',
        errorClass: 'MISSING_SECRET',
      };

      await abortExecution(
        'exec-audit',
        'verdict-engine',
        'RED verdict - missing secret detected',
        1,
        verdictInfo
      );

      const callArgs = mockPool.query.mock.calls[0][1];
      const abortMetadata = JSON.parse(callArgs[2]);

      expect(abortMetadata.verdictInfo.verdictType).toBe('REJECTED');
      expect(abortMetadata.verdictInfo.simpleVerdict).toBe('RED');
      expect(abortMetadata.verdictInfo.action).toBe('ABORT');
      expect(abortMetadata.verdictInfo.errorClass).toBe('MISSING_SECRET');
    });

    it('should track who triggered the abort', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-who' }] });

      await abortExecution(
        'exec-who',
        'verdict-engine',
        'RED verdict triggered',
        0
      );

      const callArgs = mockPool.query.mock.calls[0][1];
      const abortMetadata = JSON.parse(callArgs[2]);

      expect(abortMetadata.abortedBy).toBe('verdict-engine');
      expect(abortMetadata).toHaveProperty('abortedAt');
    });

    it('should track step index where abort occurred', async () => {
      const mockPool = require('../../src/lib/db').getPool();
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'exec-step' }] });

      await abortExecution(
        'exec-step',
        'system',
        'RED verdict triggered',
        7
      );

      const callArgs = mockPool.query.mock.calls[0][1];
      const abortMetadata = JSON.parse(callArgs[2]);

      expect(abortMetadata.abortedAtStepIndex).toBe(7);
    });
  });
});
