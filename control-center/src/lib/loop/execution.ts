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
    return {
      schemaVersion: LOOP_SCHEMA_VERSION,
      requestId,
      issueId,
      runId: run.id,
      loopStatus: 'active',
      message: mode === 'dryRun' 
        ? `Dry run mode - no step executed for issue ${issueId}` 
        : `Loop execution not yet implemented for issue ${issueId}`,
    };
  } catch (error) {
    console.error('[Loop] Error executing next step', error);
    
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
