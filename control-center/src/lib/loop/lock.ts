/**
 * Loop Locking and Idempotency Module
 * 
 * E9.1-CTRL-3: Hard fail-closed locking + idempotency for loop execution
 * 
 * Intent: No race conditions, no double execution. Deterministic replay.
 * 
 * Features:
 * - Distributed locking to prevent concurrent execution
 * - Idempotency cache for deterministic replay
 * - TTL-based lock expiration and cleanup
 * - Stable payload hash based on {issueId, step, mode, actorId}
 * 
 * Guarantees:
 * - First click: 200 ok (execution proceeds) or 409 locked (conflict)
 * - Second click: 409 locked (still running) or 200 replay (from cache)
 * - No duplicate state/events in database
 */

import { Pool } from 'pg';
import { createHash } from 'crypto';

/**
 * Parameters for lock acquisition
 */
export interface AcquireLockParams {
  issueId: string;
  step?: string;
  mode: 'execute' | 'dryRun';
  actorId: string;
  requestId: string;
  ttlSeconds?: number; // Default: 300 (5 minutes)
}

/**
 * Lock acquisition result
 */
export interface LockResult {
  acquired: boolean;
  lockId?: string;
  lockKey: string;
  existingLockBy?: string;
  existingLockExpiresAt?: Date;
}

/**
 * Parameters for idempotency check
 */
export interface IdempotencyCheckParams {
  issueId: string;
  step?: string;
  mode: 'execute' | 'dryRun';
  actorId?: string; // Optional: if not provided, not included in hash
}

/**
 * Idempotency check result
 */
export interface IdempotencyResult {
  found: boolean;
  responseData?: any;
  runId?: string;
  createdAt?: Date;
}

/**
 * Parameters for storing idempotency record
 */
export interface StoreIdempotencyParams {
  issueId: string;
  step?: string;
  mode: 'execute' | 'dryRun';
  actorId?: string;
  requestId: string;
  runId: string;
  responseData: any;
  ttlSeconds?: number; // Default: 3600 (1 hour)
}

/**
 * Loop Lock Manager
 * 
 * Provides distributed locking and idempotency for loop execution
 */
export class LoopLockManager {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Generate stable lock key from execution parameters
   * 
   * @param params - Lock parameters
   * @returns Stable lock key (hash)
   */
  private generateLockKey(params: {
    issueId: string;
    step?: string;
    mode: string;
    actorId: string;
  }): string {
    const normalized = {
      issueId: params.issueId,
      step: params.step || 'default',
      mode: params.mode,
      actorId: params.actorId,
    };
    
    const payload = JSON.stringify(normalized);
    const hash = createHash('sha256').update(payload).digest('hex');
    
    return `loop_lock:${hash.substring(0, 16)}`;
  }

  /**
   * Generate stable idempotency key from execution parameters
   * 
   * @param params - Idempotency parameters
   * @returns Stable idempotency key (hash)
   */
  private generateIdempotencyKey(params: {
    issueId: string;
    step?: string;
    mode: string;
    actorId?: string;
  }): string {
    const normalized: any = {
      issueId: params.issueId,
      step: params.step || 'default',
      mode: params.mode,
    };
    
    // Only include actorId if provided
    if (params.actorId) {
      normalized.actorId = params.actorId;
    }
    
    const payload = JSON.stringify(normalized);
    const hash = createHash('sha256').update(payload).digest('hex');
    
    return `loop_idempotency:${hash.substring(0, 16)}`;
  }

  /**
   * Try to acquire a lock for loop execution
   * 
   * Uses INSERT with ON CONFLICT to atomically acquire lock.
   * If lock exists and not expired, acquisition fails.
   * If lock exists but expired, it's cleaned up and new lock acquired.
   * 
   * @param params - Lock acquisition parameters
   * @returns Lock result with acquired flag and lock details
   */
  async acquireLock(params: AcquireLockParams): Promise<LockResult> {
    const lockKey = this.generateLockKey({
      issueId: params.issueId,
      step: params.step,
      mode: params.mode,
      actorId: params.actorId,
    });

    const ttlSeconds = params.ttlSeconds || 300; // Default: 5 minutes
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Clean up expired locks first
      await client.query(
        'DELETE FROM loop_locks WHERE expires_at < NOW()'
      );

      // Check if lock already exists and is not expired
      const existingLock = await client.query(
        `SELECT locked_by, expires_at FROM loop_locks WHERE lock_key = $1 AND expires_at >= NOW()`,
        [lockKey]
      );

      if (existingLock.rows.length > 0) {
        // Lock exists and is not expired - acquisition fails
        await client.query('COMMIT');
        
        return {
          acquired: false,
          lockKey,
          existingLockBy: existingLock.rows[0].locked_by,
          existingLockExpiresAt: existingLock.rows[0].expires_at,
        };
      }

      // Try to insert new lock (this handles the race condition atomically)
      try {
        const result = await client.query(
          `INSERT INTO loop_locks (lock_key, locked_by, expires_at, request_id, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (lock_key) DO NOTHING
           RETURNING id`,
          [
            lockKey,
            params.actorId,
            expiresAt,
            params.requestId,
            JSON.stringify({
              issueId: params.issueId,
              step: params.step,
              mode: params.mode,
            }),
          ]
        );

        if (result.rows.length === 0) {
          // Another process acquired the lock between our check and insert
          // This is the race condition case - fetch the lock details
          const conflictLock = await client.query(
            `SELECT locked_by, expires_at FROM loop_locks WHERE lock_key = $1`,
            [lockKey]
          );

          await client.query('COMMIT');
          
          return {
            acquired: false,
            lockKey,
            existingLockBy: conflictLock.rows[0]?.locked_by,
            existingLockExpiresAt: conflictLock.rows[0]?.expires_at,
          };
        }

        // Lock acquired successfully
        await client.query('COMMIT');
        
        return {
          acquired: true,
          lockId: result.rows[0].id,
          lockKey,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /**
   * Release a lock by lock key
   * 
   * @param lockKey - Lock key to release
   * @param actorId - Actor who acquired the lock (verification)
   */
  async releaseLock(lockKey: string, actorId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM loop_locks WHERE lock_key = $1 AND locked_by = $2`,
      [lockKey, actorId]
    );
  }

  /**
   * Check if an idempotent response exists for the given parameters
   * 
   * Returns cached response if found and not expired.
   * 
   * @param params - Idempotency check parameters
   * @returns Idempotency result with cached response if found
   */
  async checkIdempotency(params: IdempotencyCheckParams): Promise<IdempotencyResult> {
    const idempotencyKey = this.generateIdempotencyKey({
      issueId: params.issueId,
      step: params.step,
      mode: params.mode,
      actorId: params.actorId,
    });

    // Clean up expired idempotency records first
    await this.pool.query(
      'DELETE FROM loop_idempotency WHERE expires_at < NOW()'
    );

    // Check for cached response
    const result = await this.pool.query(
      `SELECT run_id, response_data, created_at
       FROM loop_idempotency
       WHERE idempotency_key = $1 AND expires_at >= NOW()`,
      [idempotencyKey]
    );

    if (result.rows.length === 0) {
      return { found: false };
    }

    const row = result.rows[0];
    
    return {
      found: true,
      responseData: row.response_data,
      runId: row.run_id,
      createdAt: row.created_at,
    };
  }

  /**
   * Store an idempotency record for replay
   * 
   * @param params - Store idempotency parameters
   */
  async storeIdempotency(params: StoreIdempotencyParams): Promise<void> {
    const idempotencyKey = this.generateIdempotencyKey({
      issueId: params.issueId,
      step: params.step,
      mode: params.mode,
      actorId: params.actorId,
    });

    const ttlSeconds = params.ttlSeconds || 3600; // Default: 1 hour
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.pool.query(
      `INSERT INTO loop_idempotency (idempotency_key, request_id, run_id, response_data, expires_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         response_data = EXCLUDED.response_data,
         expires_at = EXCLUDED.expires_at`,
      [
        idempotencyKey,
        params.requestId,
        params.runId,
        JSON.stringify(params.responseData),
        expiresAt,
        JSON.stringify({
          issueId: params.issueId,
          step: params.step,
          mode: params.mode,
        }),
      ]
    );
  }

  /**
   * Cleanup expired locks and idempotency records
   * 
   * This is a maintenance operation that should be run periodically.
   * 
   * @returns Count of cleaned up records
   */
  async cleanup(): Promise<{ locksDeleted: number; idempotencyDeleted: number }> {
    const locksResult = await this.pool.query(
      'DELETE FROM loop_locks WHERE expires_at < NOW() RETURNING id'
    );

    const idempotencyResult = await this.pool.query(
      'DELETE FROM loop_idempotency WHERE expires_at < NOW() RETURNING id'
    );

    return {
      locksDeleted: locksResult.rowCount || 0,
      idempotencyDeleted: idempotencyResult.rowCount || 0,
    };
  }
}

/**
 * Get LoopLockManager instance with pool
 */
export function getLoopLockManager(pool: Pool): LoopLockManager {
  return new LoopLockManager(pool);
}

/**
 * Error thrown when a lock cannot be acquired
 */
export class LockConflictError extends Error {
  public readonly lockKey: string;
  public readonly lockedBy?: string;
  public readonly expiresAt?: Date;

  constructor(lockKey: string, lockedBy?: string, expiresAt?: Date) {
    const expiresMsg = expiresAt 
      ? ` (expires at ${expiresAt.toISOString()})`
      : '';
    const byMsg = lockedBy ? ` by ${lockedBy}` : '';
    
    super(`Loop execution is locked${byMsg}${expiresMsg}`);
    
    this.name = 'LockConflictError';
    this.lockKey = lockKey;
    this.lockedBy = lockedBy;
    this.expiresAt = expiresAt;
  }
}
