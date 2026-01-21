/**
 * Tests for Loop Run Store
 * 
 * E9.1-CTRL-2: Verify persistence layer for loop runs
 */

import {
  LoopRunStore,
  getLoopRunStore,
  LoopRunStatus,
  LoopRunStepStatus,
} from '@/lib/loop/runStore';
import { Pool } from 'pg';

// Mock pg Pool
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
  };
  return {
    Pool: jest.fn(() => mPool),
  };
});

describe('LoopRunStore', () => {
  let pool: Pool;
  let store: LoopRunStore;

  beforeEach(() => {
    pool = new Pool();
    store = getLoopRunStore(pool);
    jest.clearAllMocks();
  });

  describe('createRun', () => {
    it('should create a run with pending status', async () => {
      const mockRow = {
        id: 'run-123',
        issue_id: 'AFU9-456',
        actor: 'user@example.com',
        request_id: 'req-789',
        mode: 'execute',
        status: 'pending',
        created_at: new Date(),
        started_at: null,
        completed_at: null,
        duration_ms: null,
        error_message: null,
        metadata: null,
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createRun({
        issueId: 'AFU9-456',
        actor: 'user@example.com',
        requestId: 'req-789',
        mode: 'execute',
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO loop_runs'),
        expect.arrayContaining(['AFU9-456', 'user@example.com', 'req-789', 'execute', 'pending'])
      );
      expect(result.id).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('should create a run with metadata', async () => {
      const mockRow = {
        id: 'run-123',
        issue_id: 'AFU9-456',
        actor: 'user@example.com',
        request_id: 'req-789',
        mode: 'dryRun',
        status: 'pending',
        created_at: new Date(),
        started_at: null,
        completed_at: null,
        duration_ms: null,
        error_message: null,
        metadata: { foo: 'bar' },
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createRun({
        issueId: 'AFU9-456',
        actor: 'user@example.com',
        requestId: 'req-789',
        mode: 'dryRun',
        metadata: { foo: 'bar' },
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO loop_runs'),
        expect.arrayContaining([expect.stringContaining('"foo":"bar"')])
      );
      expect(result.metadata).toEqual({ foo: 'bar' });
    });

    it('should throw error if creation fails', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await expect(
        store.createRun({
          issueId: 'AFU9-456',
          actor: 'user@example.com',
          requestId: 'req-789',
          mode: 'execute',
        })
      ).rejects.toThrow('Failed to create loop run');
    });
  });

  describe('getRun', () => {
    it('should get a run by ID', async () => {
      const mockRow = {
        id: 'run-123',
        issue_id: 'AFU9-456',
        actor: 'user@example.com',
        request_id: 'req-789',
        mode: 'execute',
        status: 'completed',
        created_at: new Date(),
        started_at: new Date(),
        completed_at: new Date(),
        duration_ms: 1000,
        error_message: null,
        metadata: null,
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.getRun('run-123');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['run-123']
      );
      expect(result).toEqual(mockRow);
    });

    it('should return null if run not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await store.getRun('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateRunStatus', () => {
    it('should update run status', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await store.updateRunStatus('run-123', {
        status: 'running',
        startedAt: new Date('2026-01-21T07:00:00.000Z'),
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE loop_runs'),
        expect.arrayContaining(['run-123', 'running'])
      );
    });

    it('should update run with completion data', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await store.updateRunStatus('run-123', {
        status: 'completed',
        completedAt: new Date('2026-01-21T07:00:05.000Z'),
        durationMs: 5000,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE loop_runs'),
        expect.arrayContaining(['run-123', 'completed', expect.any(Date), 5000])
      );
    });

    it('should update run with error message', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await store.updateRunStatus('run-123', {
        status: 'failed',
        errorMessage: 'Something went wrong',
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE loop_runs'),
        expect.arrayContaining(['run-123', 'failed', 'Something went wrong'])
      );
    });
  });

  describe('listRunsByIssue', () => {
    it('should list runs for an issue', async () => {
      const mockRows = [
        {
          id: 'run-1',
          issue_id: 'AFU9-456',
          actor: 'user@example.com',
          request_id: 'req-1',
          mode: 'execute',
          status: 'completed',
          created_at: new Date(),
        },
        {
          id: 'run-2',
          issue_id: 'AFU9-456',
          actor: 'user@example.com',
          request_id: 'req-2',
          mode: 'execute',
          status: 'failed',
          created_at: new Date(),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValue({ rows: mockRows });

      const result = await store.listRunsByIssue('AFU9-456');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE issue_id = $1'),
        ['AFU9-456', 20, 0]
      );
      expect(result).toHaveLength(2);
    });

    it('should support pagination', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await store.listRunsByIssue('AFU9-456', 10, 5);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $2 OFFSET $3'),
        ['AFU9-456', 10, 5]
      );
    });
  });

  describe('createStep', () => {
    it('should create a step with pending status', async () => {
      const mockRow = {
        id: 'step-123',
        run_id: 'run-456',
        step_number: 1,
        step_type: 'initialize',
        status: 'pending',
        started_at: null,
        completed_at: null,
        duration_ms: null,
        error_message: null,
        metadata: null,
      };

      (pool.query as jest.Mock).mockResolvedValue({ rows: [mockRow] });

      const result = await store.createStep({
        runId: 'run-456',
        stepNumber: 1,
        stepType: 'initialize',
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO loop_run_steps'),
        expect.arrayContaining(['run-456', 1, 'initialize', 'pending'])
      );
      expect(result.id).toBeDefined();
      expect(result.status).toBe('pending');
    });
  });

  describe('updateStepStatus', () => {
    it('should update step status', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      await store.updateStepStatus('step-123', {
        status: 'completed',
        completedAt: new Date('2026-01-21T07:00:05.000Z'),
        durationMs: 5000,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE loop_run_steps'),
        expect.arrayContaining(['step-123', 'completed', expect.any(Date), 5000])
      );
    });
  });

  describe('getStepsByRun', () => {
    it('should get steps for a run', async () => {
      const mockRows = [
        {
          id: 'step-1',
          run_id: 'run-123',
          step_number: 1,
          step_type: 'initialize',
          status: 'completed',
        },
        {
          id: 'step-2',
          run_id: 'run-123',
          step_number: 2,
          step_type: 'process',
          status: 'running',
        },
      ];

      (pool.query as jest.Mock).mockResolvedValue({ rows: mockRows });

      const result = await store.getStepsByRun('run-123');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE run_id = $1'),
        ['run-123']
      );
      expect(result).toHaveLength(2);
      expect(result[0].step_number).toBe(1);
      expect(result[1].step_number).toBe(2);
    });
  });

  describe('getRunWithSteps', () => {
    it('should get run with its steps', async () => {
      const mockRun = {
        id: 'run-123',
        issue_id: 'AFU9-456',
        actor: 'user@example.com',
        request_id: 'req-789',
        mode: 'execute',
        status: 'completed',
        created_at: new Date(),
      };

      const mockSteps = [
        {
          id: 'step-1',
          run_id: 'run-123',
          step_number: 1,
          step_type: 'initialize',
          status: 'completed',
        },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockRun] })
        .mockResolvedValueOnce({ rows: mockSteps });

      const result = await store.getRunWithSteps('run-123');

      expect(result).not.toBeNull();
      expect(result?.run.id).toBe('run-123');
      expect(result?.steps).toHaveLength(1);
    });

    it('should return null if run not found', async () => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

      const result = await store.getRunWithSteps('non-existent');

      expect(result).toBeNull();
    });
  });
});
