/**
 * Tests for Loop Locking and Idempotency
 * 
 * E9.1-CTRL-3: Verify locking and idempotency behavior
 */

import {
  LoopLockManager,
  getLoopLockManager,
  LockConflictError,
} from '@/lib/loop/lock';
import { Pool } from 'pg';

// Mock pg Pool
jest.mock('pg', () => {
  const mPool = {
    query: jest.fn(),
    connect: jest.fn(),
  };
  return {
    Pool: jest.fn(() => mPool),
  };
});

describe('LoopLockManager', () => {
  let pool: Pool;
  let manager: LoopLockManager;
  let mockClient: any;

  beforeEach(() => {
    pool = new Pool();
    manager = getLoopLockManager(pool);
    
    // Setup mock client for transactions
    mockClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    
    (pool.connect as jest.Mock).mockResolvedValue(mockClient);
    
    jest.clearAllMocks();
  });

  describe('acquireLock', () => {
    it('should acquire lock when no existing lock', async () => {
      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE expired locks
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check existing lock
        .mockResolvedValueOnce({ rows: [{ id: 'lock-123' }], rowCount: 1 }) // INSERT lock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const result = await manager.acquireLock({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
        requestId: 'req-789',
        ttlSeconds: 300,
      });

      expect(result.acquired).toBe(true);
      expect(result.lockId).toBe('lock-123');
      expect(result.lockKey).toContain('loop_lock:');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should fail to acquire lock when lock exists', async () => {
      const existingLockBy = 'other@example.com';
      const existingExpiresAt = new Date();

      // Mock transaction flow
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE expired locks
        .mockResolvedValueOnce({ 
          rows: [{ locked_by: existingLockBy, expires_at: existingExpiresAt }], 
          rowCount: 1 
        }) // Check existing lock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const result = await manager.acquireLock({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
        requestId: 'req-789',
        ttlSeconds: 300,
      });

      expect(result.acquired).toBe(false);
      expect(result.existingLockBy).toBe(existingLockBy);
      expect(result.existingLockExpiresAt).toEqual(existingExpiresAt);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('should handle race condition on INSERT', async () => {
      const existingLockBy = 'other@example.com';
      const existingExpiresAt = new Date();

      // Mock transaction flow - INSERT returns no rows (race condition)
      mockClient.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE expired locks
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // Check existing lock (none found)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT lock (conflict - no rows)
        .mockResolvedValueOnce({ 
          rows: [{ locked_by: existingLockBy, expires_at: existingExpiresAt }], 
          rowCount: 1 
        }) // Fetch conflict lock
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // COMMIT

      const result = await manager.acquireLock({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
        requestId: 'req-789',
        ttlSeconds: 300,
      });

      expect(result.acquired).toBe(false);
      expect(result.existingLockBy).toBe(existingLockBy);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('releaseLock', () => {
    it('should release lock by key and actor', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await manager.releaseLock('loop_lock:abc123', 'user@example.com');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM loop_locks'),
        ['loop_lock:abc123', 'user@example.com']
      );
    });
  });

  describe('checkIdempotency', () => {
    it('should return not found when no cached response exists', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE expired
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT cached response

      const result = await manager.checkIdempotency({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
      });

      expect(result.found).toBe(false);
    });

    it('should return cached response when found', async () => {
      const cachedResponse = { runId: 'run-123', status: 'completed' };
      const createdAt = new Date();

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // DELETE expired
        .mockResolvedValueOnce({ 
          rows: [{ 
            run_id: 'run-123', 
            response_data: cachedResponse,
            created_at: createdAt 
          }], 
          rowCount: 1 
        }); // SELECT cached response

      const result = await manager.checkIdempotency({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
      });

      expect(result.found).toBe(true);
      expect(result.responseData).toEqual(cachedResponse);
      expect(result.runId).toBe('run-123');
      expect(result.createdAt).toEqual(createdAt);
    });
  });

  describe('storeIdempotency', () => {
    it('should store idempotency record', async () => {
      const responseData = { runId: 'run-123', status: 'completed' };
      
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await manager.storeIdempotency({
        issueId: 'AFU9-456',
        mode: 'execute',
        actorId: 'user@example.com',
        requestId: 'req-789',
        runId: 'run-123',
        responseData,
        ttlSeconds: 3600,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO loop_idempotency'),
        expect.arrayContaining([
          expect.stringContaining('loop_idempotency:'),
          'req-789',
          'run-123',
          JSON.stringify(responseData),
          expect.any(Date),
          expect.any(String),
        ])
      );
    });
  });

  describe('cleanup', () => {
    it('should cleanup expired locks and idempotency records', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{}, {}], rowCount: 2 }) // DELETE locks
        .mockResolvedValueOnce({ rows: [{}], rowCount: 1 }); // DELETE idempotency

      const result = await manager.cleanup();

      expect(result.locksDeleted).toBe(2);
      expect(result.idempotencyDeleted).toBe(1);
    });
  });

  describe('LockConflictError', () => {
    it('should create error with lock details', () => {
      const lockKey = 'loop_lock:abc123';
      const lockedBy = 'user@example.com';
      const expiresAt = new Date();

      const error = new LockConflictError(lockKey, lockedBy, expiresAt);

      expect(error.name).toBe('LockConflictError');
      expect(error.lockKey).toBe(lockKey);
      expect(error.lockedBy).toBe(lockedBy);
      expect(error.expiresAt).toBe(expiresAt);
      expect(error.message).toContain('locked');
      expect(error.message).toContain(lockedBy);
    });
  });
});
