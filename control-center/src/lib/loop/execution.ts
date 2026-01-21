/**
 * Loop Execution Engine
 * 
 * E9.1-CTRL-1: Core loop execution logic
 * E9.1-CTRL-2: Run persistence with loop_runs and loop_run_steps
 * 
 * Handles the execution of individual steps within a loop for AFU-9 issues.
 * Persists run records for success, blocked, and failure cases.
 */

import { RunNextStepResponse, LOOP_SCHEMA_VERSION } from './schemas';
import { getPool } from '../db';
import { getLoopRunStore, LoopRunRow } from './runStore';
import { getLoopLockManager, LockConflictError } from './lock';

/**
 * Parameters for running the next step in a loop
 */
export interface RunNextStepParams {
  issueId: string;
  mode: 'execute' | 'dryRun';
  actor: string;
  requestId: string;
}

/**
 * Execute the next step in the loop for the given issue
 * 
 * Creates a persistent run record in loop_runs table with status tracking.
 * Handles success, blocked, and failure cases with appropriate status updates.
 * 
 * @param params - Execution parameters
 * @returns Response with execution details and persisted runId
 * @throws Error if execution fails
 */
export async function runNextStep(params: RunNextStepParams): Promise<RunNextStepResponse> {
  const { issueId, mode, actor, requestId } = params;
  
  console.log('[Loop] Running next step', { issueId, mode, actor, requestId });
  
  const pool = getPool();
  const runStore = getLoopRunStore(pool);
  const lockManager = getLoopLockManager(pool);
  
  // E9.1-CTRL-3: Check idempotency first for replay
  const idempotencyCheck = await lockManager.checkIdempotency({
    issueId,
    mode,
    actorId: actor,
  });
  
  if (idempotencyCheck.found && idempotencyCheck.responseData) {
    console.log('[Loop] Idempotent replay - returning cached response', {
      issueId,
      runId: idempotencyCheck.runId,
      requestId,
    });
    
    // Return cached response with current requestId
    return {
      ...idempotencyCheck.responseData,
      requestId, // Update with current requestId for traceability
    };
  }
  
  // E9.1-CTRL-3: Acquire lock before execution
  const lockResult = await lockManager.acquireLock({
    issueId,
    mode,
    actorId: actor,
    requestId,
    ttlSeconds: 300, // 5 minutes
  });
  
  if (!lockResult.acquired) {
    // Lock conflict - another execution is in progress
    console.log('[Loop] Lock conflict - execution already in progress', {
      issueId,
      lockKey: lockResult.lockKey,
      lockedBy: lockResult.existingLockBy,
      expiresAt: lockResult.existingLockExpiresAt,
    });
    
    throw new LockConflictError(
      lockResult.lockKey,
      lockResult.existingLockBy,
      lockResult.existingLockExpiresAt
    );
  }
  
  console.log('[Loop] Lock acquired', { issueId, lockKey: lockResult.lockKey });
  
  let run: LoopRunRow | null = null;
  
  try {
    // Create run record in pending state
    run = await runStore.createRun({
      issueId,
      actor,
      requestId,
      mode,
      metadata: {
        initialStatus: 'pending',
        lockKey: lockResult.lockKey,
      },
    });
    
    console.log('[Loop] Created run record', { runId: run.id, issueId, mode });
    
    // Update run to running status
    const startedAt = new Date();
    await runStore.updateRunStatus(run.id, {
      status: 'running',
      startedAt,
    });
    
    // TODO: Implement actual loop execution logic
    // This is a stub implementation that returns a minimal valid response
    
    // For now, mark run as completed successfully
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    
    await runStore.updateRunStatus(run.id, {
      status: 'completed',
      completedAt,
      durationMs,
      metadata: {
        message: mode === 'dryRun' 
          ? `Dry run mode - no step executed for issue ${issueId}` 
          : `Loop execution not yet implemented for issue ${issueId}`,
      },
    });
    
    // Return a minimal valid response indicating the loop is active
    // but no step was executed yet (stub implementation)
    const response: RunNextStepResponse = {
      schemaVersion: LOOP_SCHEMA_VERSION,
      requestId,
      issueId,
      runId: run.id,
      loopStatus: 'active',
      message: mode === 'dryRun' 
        ? `Dry run mode - no step executed for issue ${issueId}` 
        : `Loop execution not yet implemented for issue ${issueId}`,
    };
    
    // E9.1-CTRL-3: Store idempotency record for replay
    await lockManager.storeIdempotency({
      issueId,
      mode,
      actorId: actor,
      requestId,
      runId: run.id,
      responseData: response,
      ttlSeconds: 3600, // 1 hour
    });
    
    // E9.1-CTRL-3: Release lock after completion
    await lockManager.releaseLock(lockResult.lockKey, actor);
    
    console.log('[Loop] Lock released', { issueId, lockKey: lockResult.lockKey });
    
    return response;
  } catch (error) {
    console.error('[Loop] Error executing next step', error);
    
    // E9.1-CTRL-3: Release lock on error
    if (lockResult?.acquired && lockResult.lockKey) {
      await lockManager.releaseLock(lockResult.lockKey, actor).catch(releaseError => {
        console.error('[Loop] Failed to release lock on error', releaseError);
      });
    }
    
    // Update run to failed status if we have a run ID
    if (run?.id) {
      const completedAt = new Date();
      const durationMs = run.started_at 
        ? completedAt.getTime() - new Date(run.started_at).getTime()
        : 0;
      
      await runStore.updateRunStatus(run.id, {
        status: 'failed',
        completedAt,
        durationMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(updateError => {
        console.error('[Loop] Failed to update run status to failed', updateError);
      });
    }
    
    // Re-throw the error for the API layer to handle
    throw error;
  }
}
