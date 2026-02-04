/**
 * Loop Execution Engine
 * 
 * E9.1-CTRL-1: Core loop execution logic
 * E9.1-CTRL-2: Run persistence with loop_runs and loop_run_steps
 * E9.3-CTRL-01: S4 Review Gate integration
 * 
 * Handles the execution of individual steps within a loop for AFU-9 issues.
 * Persists run records for success, blocked, and failure cases.
 */

import { RunNextStepResponse, LOOP_SCHEMA_VERSION } from './schemas';
import { getPool } from '../db';
import { getLoopRunStore, LoopRunRow } from './runStore';
import { getLoopLockManager, LockConflictError } from './lock';
import { resolveNextStep, LoopStep } from './stateMachine';
import { executeS1 } from './stepExecutors/s1-pick-issue';
import { executeS2 } from './stepExecutors/s2-spec-gate';
import { executeS4 } from './stepExecutors/s4-review-gate';
import { executeS5 } from './stepExecutors/s5-merge';
import { getLoopEventStore, LoopEventType } from './eventStore';

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
  const eventStore = getLoopEventStore(pool);
  
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
    // responseData is stored as unknown, but we know it's a RunNextStepResponse
    const cachedResponse = idempotencyCheck.responseData as RunNextStepResponse;
    return {
      ...cachedResponse,
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
    
    // E9.1-CTRL-5: Execute the next step based on state machine resolution
    // Fetch issue data to determine next step
    const issueResult = await pool.query(
      `SELECT id, status, github_url, current_draft_id, handoff_state
       FROM afu9_issues
       WHERE id = $1`,
      [issueId]
    );
    
    if (issueResult.rows.length === 0) {
      throw new Error(`Issue not found: ${issueId}`);
    }
    
    const issue = issueResult.rows[0];
    
    // Resolve next step using state machine
    const stepResolution = resolveNextStep(issue);
    
    // E9.1-CTRL-8: Emit loop_run_started event
    await eventStore.createEvent({
      issueId,
      runId: run.id,
      eventType: LoopEventType.RUN_STARTED,
      eventData: {
        runId: run.id,
        step: stepResolution.step || 'UNKNOWN',
        stateBefore: issue.status,
        requestId,
      },
    }).catch(err => {
      console.error('[Loop] Failed to create loop_run_started event', err);
      // Don't fail the run if event logging fails
    });
    
    let response: RunNextStepResponse;
    
    // Check if step is blocked
    if (stepResolution.blocked) {
      console.log('[Loop] Step blocked', {
        issueId,
        blockerCode: stepResolution.blockerCode,
        message: stepResolution.blockerMessage,
      });
      
      // Mark run as completed but with blocked status
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      
      await runStore.updateRunStatus(run.id, {
        status: 'completed',
        completedAt,
        durationMs,
        metadata: {
          blocked: true,
          blockerCode: stepResolution.blockerCode,
          blockerMessage: stepResolution.blockerMessage,
        },
      });
      
      // E9.1-CTRL-8: Emit loop_run_blocked event
      await eventStore.createEvent({
        issueId,
        runId: run.id,
        eventType: LoopEventType.RUN_BLOCKED,
        eventData: {
          runId: run.id,
          step: stepResolution.step || 'UNKNOWN',
          stateBefore: issue.status,
          blockerCode: stepResolution.blockerCode,
          requestId,
        },
      }).catch(err => {
        console.error('[Loop] Failed to create loop_run_blocked event', err);
      });
      
      response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId,
        issueId,
        runId: run.id,
        loopStatus: 'paused',
        message: stepResolution.blockerMessage || 'Step is blocked',
      };
    } else if (!stepResolution.step) {
      // No step available (terminal state or unknown state)
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      
      await runStore.updateRunStatus(run.id, {
        status: 'completed',
        completedAt,
        durationMs,
        metadata: {
          message: stepResolution.blockerMessage || 'No next step available',
        },
      });
      
      // E9.1-CTRL-8: Emit loop_run_finished event for terminal state
      await eventStore.createEvent({
        issueId,
        runId: run.id,
        eventType: LoopEventType.RUN_FINISHED,
        eventData: {
          runId: run.id,
          step: 'TERMINAL',
          stateBefore: issue.status,
          stateAfter: issue.status,
          requestId,
        },
      }).catch(err => {
        console.error('[Loop] Failed to create loop_run_finished event', err);
      });
      
      response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId,
        issueId,
        runId: run.id,
        loopStatus: 'completed',
        message: stepResolution.blockerMessage || 'No next step available',
      };
    } else {
      // Execute the step
      console.log('[Loop] Executing step', {
        issueId,
        step: stepResolution.step,
        mode,
      });
      
      // Execute the appropriate step
      let stepResult;
      let stepNumber = 0;
      
      if (stepResolution.step === LoopStep.S1_PICK_ISSUE) {
        stepNumber = 1;
        stepResult = await executeS1(pool, {
          issueId,
          runId: run.id,
          requestId,
          actor,
          mode,
        });
      } else if (stepResolution.step === LoopStep.S2_SPEC_READY) {
        stepNumber = 2;
        stepResult = await executeS2(pool, {
          issueId,
          runId: run.id,
          requestId,
          actor,
          mode,
        });
      } else if (stepResolution.step === LoopStep.S4_REVIEW) {
        stepNumber = 4;
        stepResult = await executeS4(pool, {
          issueId,
          runId: run.id,
          requestId,
          actor,
          mode,
        });
      } else if (stepResolution.step === LoopStep.S5_MERGE) {
        stepNumber = 5;
        stepResult = await executeS5(pool, {
          issueId,
          runId: run.id,
          requestId,
          actor,
          mode,
        });
      } else {
        // Step not yet implemented
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        
        await runStore.updateRunStatus(run.id, {
          status: 'completed',
          completedAt,
          durationMs,
          metadata: {
            message: `Step ${stepResolution.step} not yet implemented`,
          },
        });
        
        response = {
          schemaVersion: LOOP_SCHEMA_VERSION,
          requestId,
          issueId,
          runId: run.id,
          loopStatus: 'active',
          message: `Step ${stepResolution.step} not yet implemented`,
        };
      }
      
      // Process step result if we executed a step
      if (stepResult) {
        const completedAt = new Date();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        
        if (stepResult.blocked) {
          await runStore.updateRunStatus(run.id, {
            status: 'completed',
            completedAt,
            durationMs,
            metadata: {
              blocked: true,
              blockerCode: stepResult.blockerCode,
              blockerMessage: stepResult.blockerMessage,
              step: stepResolution.step,
            },
          });
          
          // E9.1-CTRL-8: Emit loop_run_blocked event for step-level block
          await eventStore.createEvent({
            issueId,
            runId: run.id,
            eventType: LoopEventType.RUN_BLOCKED,
            eventData: {
              runId: run.id,
              step: stepResolution.step,
              stateBefore: stepResult.stateBefore,
              blockerCode: stepResult.blockerCode,
              requestId,
            },
          }).catch(err => {
            console.error('[Loop] Failed to create loop_run_blocked event', err);
          });
          
          response = {
            schemaVersion: LOOP_SCHEMA_VERSION,
            requestId,
            issueId,
            runId: run.id,
            loopStatus: 'paused',
            message: stepResult.message,
          };
        } else {
          await runStore.updateRunStatus(run.id, {
            status: 'completed',
            completedAt,
            durationMs,
            metadata: {
              step: stepResolution.step,
              fieldsChanged: stepResult.fieldsChanged,
              message: stepResult.message,
            },
          });
          
          // E9.1-CTRL-8: Emit step-specific completion event
          let stepEventType: LoopEventType;
          if (stepResolution.step === LoopStep.S1_PICK_ISSUE) {
            stepEventType = LoopEventType.STEP_S1_COMPLETED;
          } else if (stepResolution.step === LoopStep.S2_SPEC_READY) {
            stepEventType = LoopEventType.STEP_S2_SPEC_READY;
          } else if (stepResolution.step === LoopStep.S3_IMPLEMENT_PREP) {
            stepEventType = LoopEventType.STEP_S3_IMPLEMENT_PREP;
          } else {
            // Fallback to finished event for unknown steps
            stepEventType = LoopEventType.RUN_FINISHED;
          }
          
          await eventStore.createEvent({
            issueId,
            runId: run.id,
            eventType: stepEventType,
            eventData: {
              runId: run.id,
              step: stepResolution.step,
              stateBefore: stepResult.stateBefore,
              stateAfter: stepResult.stateAfter,
              requestId,
            },
          }).catch(err => {
            console.error('[Loop] Failed to create step completion event', err);
          });
          
          // E9.1-CTRL-8: Also emit loop_run_finished event
          await eventStore.createEvent({
            issueId,
            runId: run.id,
            eventType: LoopEventType.RUN_FINISHED,
            eventData: {
              runId: run.id,
              step: stepResolution.step,
              stateBefore: stepResult.stateBefore,
              stateAfter: stepResult.stateAfter,
              requestId,
            },
          }).catch(err => {
            console.error('[Loop] Failed to create loop_run_finished event', err);
          });
          
          response = {
            schemaVersion: LOOP_SCHEMA_VERSION,
            requestId,
            issueId,
            runId: run.id,
            stepExecuted: {
              stepNumber,
              stepType: stepResolution.step,
              status: 'completed',
              startedAt: startedAt.toISOString(),
              completedAt: completedAt.toISOString(),
              durationMs,
            },
            loopStatus: 'active',
            message: stepResult.message,
          };
        }
      }
    }
    
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
      
      // Get current issue status for event
      let currentStatus = 'UNKNOWN';
      try {
        const issueResult = await pool.query(
          'SELECT status FROM afu9_issues WHERE id = $1',
          [issueId]
        );
        if (issueResult.rows.length > 0) {
          currentStatus = issueResult.rows[0].status;
        }
      } catch (statusError) {
        console.error('[Loop] Failed to fetch issue status for event', statusError);
      }
      
      await runStore.updateRunStatus(run.id, {
        status: 'failed',
        completedAt,
        durationMs,
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(updateError => {
        console.error('[Loop] Failed to update run status to failed', updateError);
      });
      
      // E9.1-CTRL-8: Emit loop_run_failed event
      await eventStore.createEvent({
        issueId,
        runId: run.id,
        eventType: LoopEventType.RUN_FAILED,
        eventData: {
          runId: run.id,
          step: 'UNKNOWN',
          stateBefore: currentStatus,
          requestId,
        },
      }).catch(eventError => {
        console.error('[Loop] Failed to create loop_run_failed event', eventError);
      });
    }
    
    // Re-throw the error for the API layer to handle
    throw error;
  }
}
