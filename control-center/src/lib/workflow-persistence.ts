/**
 * Workflow Persistence Layer
 * 
 * Handles database operations for workflow executions and steps,
 * enabling execution tracking, reconstruction, and resumption.
 */

import { getPool } from './db';
import {
  WorkflowStatus,
  StepStatus,
  WorkflowContext,
  WorkflowPauseMetadata,
} from './types/workflow';

/**
 * Database row for workflow execution
 */
export interface WorkflowExecutionRow {
  id: string;
  workflow_id: string | null;
  status: WorkflowStatus;
  input: any;
  output: any;
  context: any;
  started_at: Date;
  completed_at: Date | null;
  error: string | null;
  triggered_by: string | null;
  github_run_id: string | null;
  policy_snapshot_id: string | null;
  pause_metadata: WorkflowPauseMetadata | null; // Issue B4
  created_at: Date;
  updated_at: Date;
}

/**
 * Database row for workflow step
 */
export interface WorkflowStepRow {
  id: string;
  execution_id: string;
  step_name: string;
  step_index: number;
  status: StepStatus;
  input: any;
  output: any;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
  error: string | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create a new workflow execution record
 */
export async function createExecution(
  workflowId: string | null,
  input: any,
  context: WorkflowContext,
  triggeredBy?: string,
  githubRunId?: string
): Promise<string> {
  const pool = getPool();
  const query = `
    INSERT INTO workflow_executions (
      workflow_id,
      status,
      input,
      context,
      started_at,
      triggered_by,
      github_run_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `;

  const values = [
    workflowId,
    'running' as WorkflowStatus,
    JSON.stringify(input),
    JSON.stringify(context),
    new Date(),
    triggeredBy || null,
    githubRunId || null,
  ];

  try {
    const result = await pool.query(query, values);
    const executionId = result.rows[0].id;
    
    console.log('[Workflow Persistence] Created execution:', executionId);
    
    return executionId;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to create execution:', error);
    throw error;
  }
}

/**
 * Update workflow execution status
 */
export async function updateExecutionStatus(
  executionId: string,
  status: WorkflowStatus,
  output?: any,
  error?: string
): Promise<void> {
  const pool = getPool();
  const query = `
    UPDATE workflow_executions
    SET status = $2,
        output = $3,
        error = $4,
        completed_at = CASE WHEN $2 IN ('completed', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE id = $1
  `;

  const values = [
    executionId,
    status,
    output ? JSON.stringify(output) : null,
    error || null,
  ];

  try {
    await pool.query(query, values);
    console.log('[Workflow Persistence] Updated execution status:', { executionId, status });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to update execution status:', error);
    throw error;
  }
}

/**
 * Update workflow execution context (for variable updates)
 */
export async function updateExecutionContext(
  executionId: string,
  context: WorkflowContext
): Promise<void> {
  const pool = getPool();
  const query = `
    UPDATE workflow_executions
    SET context = $2,
        updated_at = NOW()
    WHERE id = $1
  `;

  const values = [executionId, JSON.stringify(context)];

  try {
    await pool.query(query, values);
    console.log('[Workflow Persistence] Updated execution context:', executionId);
  } catch (error) {
    console.error('[Workflow Persistence] Failed to update execution context:', error);
    throw error;
  }
}

/**
 * Create a workflow step record
 */
export async function createStep(
  executionId: string,
  stepName: string,
  stepIndex: number,
  input: any
): Promise<string> {
  const pool = getPool();
  const query = `
    INSERT INTO workflow_steps (
      execution_id,
      step_name,
      step_index,
      status,
      input,
      started_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id
  `;

  const values = [
    executionId,
    stepName,
    stepIndex,
    'running' as StepStatus,
    JSON.stringify(input),
    new Date(),
  ];

  try {
    const result = await pool.query(query, values);
    const stepId = result.rows[0].id;
    
    console.log('[Workflow Persistence] Created step:', { stepId, stepName, stepIndex });
    
    return stepId;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to create step:', error);
    throw error;
  }
}

/**
 * Update workflow step status and result
 */
export async function updateStep(
  stepId: string,
  status: StepStatus,
  output?: any,
  error?: string,
  durationMs?: number
): Promise<void> {
  const pool = getPool();
  const query = `
    UPDATE workflow_steps
    SET status = $2,
        output = $3,
        error = $4,
        duration_ms = $5,
        completed_at = CASE WHEN $2 IN ('completed', 'failed', 'skipped') THEN NOW() ELSE completed_at END,
        updated_at = NOW()
    WHERE id = $1
  `;

  const values = [
    stepId,
    status,
    output ? JSON.stringify(output) : null,
    error || null,
    durationMs || null,
  ];

  try {
    await pool.query(query, values);
    console.log('[Workflow Persistence] Updated step:', { stepId, status });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to update step:', error);
    throw error;
  }
}

/**
 * Increment retry count for a step
 */
export async function incrementStepRetry(stepId: string): Promise<void> {
  const pool = getPool();
  const query = `
    UPDATE workflow_steps
    SET retry_count = retry_count + 1,
        updated_at = NOW()
    WHERE id = $1
  `;

  try {
    await pool.query(query, [stepId]);
    console.log('[Workflow Persistence] Incremented retry count for step:', stepId);
  } catch (error) {
    console.error('[Workflow Persistence] Failed to increment retry count:', error);
    throw error;
  }
}

/**
 * Get workflow execution by ID
 */
export async function getExecution(executionId: string): Promise<WorkflowExecutionRow | null> {
  const pool = getPool();
  const query = `
    SELECT * FROM workflow_executions
    WHERE id = $1
  `;

  try {
    const result = await pool.query(query, [executionId]);
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to get execution:', error);
    throw error;
  }
}

/**
 * Get all steps for a workflow execution
 */
export async function getExecutionSteps(executionId: string): Promise<WorkflowStepRow[]> {
  const pool = getPool();
  const query = `
    SELECT * FROM workflow_steps
    WHERE execution_id = $1
    ORDER BY step_index ASC
  `;

  try {
    const result = await pool.query(query, [executionId]);
    return result.rows;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to get execution steps:', error);
    throw error;
  }
}

/**
 * Get recent workflow executions
 */
export async function getRecentExecutions(limit: number = 50): Promise<WorkflowExecutionRow[]> {
  const pool = getPool();
  const query = `
    SELECT * FROM workflow_executions
    ORDER BY started_at DESC
    LIMIT $1
  `;

  try {
    const result = await pool.query(query, [limit]);
    return result.rows;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to get recent executions:', error);
    throw error;
  }
}

/**
 * Update policy snapshot ID for workflow execution
 * 
 * Issue 2.1: Policy Snapshotting per Run
 * Links the execution to its immutable policy snapshot
 */
export async function updateExecutionPolicySnapshot(
  executionId: string,
  policySnapshotId: string
): Promise<void> {
  const pool = getPool();
  const query = `
    UPDATE workflow_executions
    SET policy_snapshot_id = $2,
        updated_at = NOW()
    WHERE id = $1
  `;

  const values = [executionId, policySnapshotId];

  try {
    await pool.query(query, values);
    console.log('[Workflow Persistence] Updated policy snapshot:', { executionId, policySnapshotId });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to update policy snapshot:', error);
    throw error;
  }
}

/**
 * Pause a workflow execution (Issue B4)
 * 
 * HOLD enforcement: Pauses the workflow and requires explicit human action to resume.
 * No automatic timeout continuation is allowed.
 * 
 * @param executionId - The workflow execution ID
 * @param pausedBy - User/system that paused the workflow
 * @param reason - Reason for pausing (e.g., "HOLD state triggered")
 * @param pausedAtStepIndex - Optional step index where pause occurred
 * @throws Error if execution does not exist or is not in 'running' status
 */
export async function pauseExecution(
  executionId: string,
  pausedBy: string,
  reason: string,
  pausedAtStepIndex?: number
): Promise<void> {
  const pool = getPool();
  
  const pauseMetadata = {
    pausedAt: new Date().toISOString(),
    pausedBy,
    reason,
    pausedAtStepIndex,
  };
  
  // Update only if status is 'running' to prevent race conditions
  const query = `
    UPDATE workflow_executions
    SET status = 'paused',
        pause_metadata = $2,
        updated_at = NOW()
    WHERE id = $1 AND status = 'running'
    RETURNING id
  `;

  const values = [executionId, JSON.stringify(pauseMetadata)];

  try {
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(
        `Cannot pause execution ${executionId}: execution not found or not in 'running' status`
      );
    }
    
    console.log('[Workflow Persistence] Paused execution:', {
      executionId,
      pausedBy,
      reason,
      pausedAtStepIndex,
    });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to pause execution:', error);
    throw error;
  }
}

/**
 * Resume a paused workflow execution (Issue B4)
 * 
 * HOLD enforcement: Resumes a paused workflow with explicit human approval.
 * Updates pause metadata to track who resumed and when.
 * 
 * @param executionId - The workflow execution ID
 * @param resumedBy - User who approved the resume
 * @throws Error if execution does not exist or is not in 'paused' status
 */
export async function resumeExecution(
  executionId: string,
  resumedBy: string
): Promise<void> {
  const pool = getPool();
  
  // Single atomic query to get metadata and update status
  // Only updates if status is 'paused' to prevent race conditions
  const query = `
    UPDATE workflow_executions
    SET status = 'running',
        pause_metadata = jsonb_set(
          COALESCE(pause_metadata, '{}'::jsonb),
          '{resumedAt}',
          to_jsonb($2::text)
        ) || jsonb_build_object('resumedBy', $3),
        updated_at = NOW()
    WHERE id = $1 AND status = 'paused'
    RETURNING id, pause_metadata
  `;
  
  const values = [
    executionId,
    new Date().toISOString(),
    resumedBy,
  ];
  
  try {
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(
        `Cannot resume execution ${executionId}: execution not found or not in 'paused' status`
      );
    }
    
    console.log('[Workflow Persistence] Resumed execution:', {
      executionId,
      resumedBy,
    });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to resume execution:', error);
    throw error;
  }
}

/**
 * Get all paused workflow executions (Issue B4)
 * 
 * Returns all workflows that are currently paused and waiting for human action.
 */
export async function getPausedExecutions(): Promise<WorkflowExecutionRow[]> {
  const pool = getPool();
  const query = `
    SELECT 
      id,
      workflow_id,
      status,
      started_at,
      pause_metadata,
      context,
      input,
      triggered_by,
      github_run_id,
      created_at,
      updated_at
    FROM workflow_executions
    WHERE status = 'paused'
    ORDER BY started_at DESC
  `;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to get paused executions:', error);
    throw error;
  }
}

/**
 * Abort a workflow execution due to RED verdict (Issue B5)
 * 
 * RED enforcement: Immediately aborts the workflow execution.
 * No continuation is allowed. The workflow is marked as 'failed' with abort metadata.
 * 
 * @param executionId - The workflow execution ID
 * @param abortedBy - User/system that triggered the abort (e.g., "system", "verdict-engine")
 * @param reason - Reason for aborting (e.g., "RED verdict triggered - critical failure detected")
 * @param abortedAtStepIndex - Optional step index where abort occurred
 * @param verdictInfo - Optional verdict information for traceability
 * @throws Error if execution does not exist
 */
export async function abortExecution(
  executionId: string,
  abortedBy: string,
  reason: string,
  abortedAtStepIndex?: number,
  verdictInfo?: {
    verdictType?: string;
    simpleVerdict?: string;
    action?: string;
    errorClass?: string;
  }
): Promise<void> {
  const pool = getPool();
  
  const abortMetadata = {
    abortedAt: new Date().toISOString(),
    abortedBy,
    reason,
    abortedAtStepIndex,
    verdictInfo,
  };
  
  // Update to 'failed' status with abort metadata
  // Allow aborting from 'running' or 'paused' states
  const query = `
    UPDATE workflow_executions
    SET status = 'failed',
        error = $2,
        completed_at = NOW(),
        pause_metadata = jsonb_set(
          COALESCE(pause_metadata, '{}'::jsonb),
          '{abortMetadata}',
          $3::jsonb
        ),
        updated_at = NOW()
    WHERE id = $1 AND status IN ('running', 'paused')
    RETURNING id
  `;

  const values = [
    executionId,
    reason,
    JSON.stringify(abortMetadata),
  ];

  try {
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(
        `Cannot abort execution ${executionId}: execution not found or already completed/failed`
      );
    }
    
    console.log('[Workflow Persistence] Aborted execution:', {
      executionId,
      abortedBy,
      reason,
      abortedAtStepIndex,
      verdictInfo,
    });
  } catch (error) {
    console.error('[Workflow Persistence] Failed to abort execution:', error);
    throw error;
  }
}

/**
 * Get all aborted workflow executions (Issue B5)
 * 
 * Returns all workflows that were aborted due to RED verdict or other critical failures.
 */
export async function getAbortedExecutions(): Promise<WorkflowExecutionRow[]> {
  const pool = getPool();
  const query = `
    SELECT 
      id,
      workflow_id,
      status,
      started_at,
      completed_at,
      error,
      pause_metadata,
      context,
      input,
      triggered_by,
      github_run_id,
      created_at,
      updated_at
    FROM workflow_executions
    WHERE status = 'failed'
      AND pause_metadata ? 'abortMetadata'
    ORDER BY completed_at DESC
  `;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('[Workflow Persistence] Failed to get aborted executions:', error);
    throw error;
  }
}
