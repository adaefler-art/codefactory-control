/**
 * Factory Status Service
 * 
 * Service layer for aggregating factory status data from workflow executions.
 * Implements the Central Factory Status API (Issue 1.2 from AFU-9 Roadmap v0.3)
 */

import { getPool } from './db';
import {
  FactoryStatusResponse,
  FactoryRunSummary,
  ErrorSummary,
  FactoryKPIs,
  FactoryStatusQueryParams,
} from './types/factory-status';

const API_VERSION = '1.0.0';

/**
 * Get comprehensive factory status
 * 
 * Aggregates runs, errors, and KPIs from the database
 */
export async function getFactoryStatus(
  params?: FactoryStatusQueryParams
): Promise<FactoryStatusResponse> {
  const limit = Math.min(params?.limit || 10, 100);
  const errorLimit = Math.min(params?.errorLimit || 10, 100);
  const kpiPeriodHours = params?.kpiPeriodHours || 24;

  // Execute all queries in parallel for better performance
  const [recentRuns, errors, kpis] = await Promise.all([
    getRecentRuns(limit),
    getRecentErrors(errorLimit),
    calculateKPIs(kpiPeriodHours),
  ]);

  return {
    api: {
      version: API_VERSION,
    },
    timestamp: new Date().toISOString(),
    runs: {
      recent: recentRuns.runs,
      total: recentRuns.total,
    },
    errors: {
      recent: errors.errors,
      total: errors.total,
    },
    kpis,
    verdicts: {
      enabled: false, // Placeholder for future Verdict Engine (EPIC 2)
    },
  };
}

/**
 * Get recent workflow execution runs
 */
async function getRecentRuns(limit: number): Promise<{
  runs: FactoryRunSummary[];
  total: number;
}> {
  const pool = getPool();
  
  // Get recent executions
  const runsQuery = `
    SELECT 
      id,
      workflow_id,
      status,
      started_at,
      completed_at,
      error,
      triggered_by,
      EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 AS duration_ms
    FROM workflow_executions
    ORDER BY started_at DESC
    LIMIT $1
  `;
  
  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM workflow_executions
  `;

  try {
    const [runsResult, countResult] = await Promise.all([
      pool.query(runsQuery, [limit]),
      pool.query(countQuery),
    ]);

    const runs: FactoryRunSummary[] = runsResult.rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      completedAt: row.completed_at ? row.completed_at.toISOString() : null,
      durationMs: row.duration_ms ? Math.round(row.duration_ms) : null,
      triggeredBy: row.triggered_by,
      error: row.error,
    }));

    const total = parseInt(countResult.rows[0].total, 10);

    return { runs, total };
  } catch (error) {
    console.error('[Factory Status] Error fetching recent runs:', error);
    throw error;
  }
}

/**
 * Get recent errors from failed executions
 */
async function getRecentErrors(limit: number): Promise<{
  errors: ErrorSummary[];
  total: number;
}> {
  const pool = getPool();
  
  // Get recent errors
  const errorsQuery = `
    SELECT 
      id,
      workflow_id,
      error,
      completed_at,
      status
    FROM workflow_executions
    WHERE status = 'failed' AND error IS NOT NULL
    ORDER BY completed_at DESC
    LIMIT $1
  `;
  
  // Get total error count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM workflow_executions
    WHERE status = 'failed' AND error IS NOT NULL
  `;

  try {
    const [errorsResult, countResult] = await Promise.all([
      pool.query(errorsQuery, [limit]),
      pool.query(countQuery),
    ]);

    const errors: ErrorSummary[] = errorsResult.rows.map((row) => ({
      executionId: row.id,
      workflowId: row.workflow_id,
      error: row.error,
      timestamp: row.completed_at ? row.completed_at.toISOString() : new Date().toISOString(),
      status: row.status,
    }));

    const total = parseInt(countResult.rows[0].total, 10);

    return { errors, total };
  } catch (error) {
    console.error('[Factory Status] Error fetching recent errors:', error);
    throw error;
  }
}

/**
 * Calculate Factory KPIs
 * 
 * Implements "Mean Time to Insight" KPI as specified in roadmap
 */
async function calculateKPIs(periodHours: number): Promise<FactoryKPIs> {
  const pool = getPool();
  
  const query = `
    SELECT 
      COUNT(*) as total_executions,
      COUNT(*) FILTER (WHERE status = 'completed') as completed_executions,
      COUNT(*) FILTER (WHERE status = 'failed') as failed_executions,
      COUNT(*) FILTER (WHERE status = 'running') as running_executions,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) 
        FILTER (WHERE status = 'completed') as avg_duration_ms,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) 
        FILTER (WHERE status IN ('completed', 'failed')) as mean_time_to_insight_ms
    FROM workflow_executions
    WHERE started_at >= NOW() - INTERVAL '${periodHours} hours'
  `;

  try {
    const result = await pool.query(query);
    const row = result.rows[0];

    const totalExecutions = parseInt(row.total_executions, 10);
    const completedExecutions = parseInt(row.completed_executions, 10);
    const failedExecutions = parseInt(row.failed_executions, 10);
    const runningExecutions = parseInt(row.running_executions, 10);

    // Calculate success rate
    const completedOrFailed = completedExecutions + failedExecutions;
    const successRate = completedOrFailed > 0 
      ? (completedExecutions / completedOrFailed) * 100 
      : 0;

    return {
      meanTimeToInsightMs: row.mean_time_to_insight_ms 
        ? Math.round(parseFloat(row.mean_time_to_insight_ms)) 
        : null,
      totalExecutions,
      completedExecutions,
      failedExecutions,
      successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
      avgExecutionDurationMs: row.avg_duration_ms 
        ? Math.round(parseFloat(row.avg_duration_ms)) 
        : null,
      runningExecutions,
    };
  } catch (error) {
    console.error('[Factory Status] Error calculating KPIs:', error);
    throw error;
  }
}
