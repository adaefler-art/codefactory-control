/**
 * Factory Status Service
 * 
 * Service layer for aggregating factory status data from workflow executions.
 * Implements the Central Factory Status API (Issue 1.2 from AFU-9 Roadmap v0.3)
 * 
 * EPIC 2: Verdict Engine v1.1 integration
 */

import { getPool } from './db';
import {
  FactoryStatusResponse,
  FactoryRunSummary,
  ErrorSummary,
  FactoryKPIs,
  FactoryStatusQueryParams,
  VerdictSummary,
  VerdictKPIs,
} from './types/factory-status';
import { FACTORY_STATUS_API_VERSION } from '@codefactory/verdict-engine';

const API_VERSION = FACTORY_STATUS_API_VERSION; // Import from verdict-engine package

/**
 * Get comprehensive factory status
 * 
 * Aggregates runs, errors, verdicts, and KPIs from the database
 * EPIC 2: Includes Verdict Engine v1.1 data
 */
export async function getFactoryStatus(
  params?: FactoryStatusQueryParams
): Promise<FactoryStatusResponse> {
  const limit = Math.min(params?.limit || 10, 100);
  const errorLimit = Math.min(params?.errorLimit || 10, 100);
  const kpiPeriodHours = params?.kpiPeriodHours || 24;

  // Execute all queries in parallel for better performance
  const [recentRuns, errors, kpis, verdicts] = await Promise.all([
    getRecentRuns(limit),
    getRecentErrors(errorLimit),
    calculateKPIs(kpiPeriodHours),
    getRecentVerdicts(limit), // New: Verdict Engine integration
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
      enabled: true, // Verdict Engine v1.1 enabled
      summary: verdicts.summary,
      kpis: verdicts.kpis,
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
    WHERE started_at >= NOW() - INTERVAL '1 hour' * $1
  `;

  try {
    const result = await pool.query(query, [periodHours]);
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

/**
 * Get recent verdicts from Verdict Engine
 * 
 * EPIC 2: Verdict Engine v1.1 integration
 * Issue 2.1: Auditability with policy snapshots
 * Issue 2.2: Normalized confidence scores
 */
async function getRecentVerdicts(limit: number): Promise<{
  summary: VerdictSummary[];
  kpis: VerdictKPIs;
}> {
  const pool = getPool();

  // Check if verdicts table exists
  const tableCheckQuery = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'verdicts'
    );
  `;

  try {
    const tableCheck = await pool.query(tableCheckQuery);
    
    if (!tableCheck.rows[0].exists) {
      // Verdicts table doesn't exist yet (migration not run)
      return {
        summary: [],
        kpis: {
          totalVerdicts: 0,
          avgConfidence: 0,
          consistencyScore: 0,
          byAction: {
            waitAndRetry: 0,
            openIssue: 0,
            humanRequired: 0,
          },
          topErrorClasses: [],
        },
      };
    }

    // Get recent verdicts with policy information
    const verdictsQuery = `
      SELECT 
        v.id,
        v.execution_id,
        v.error_class,
        v.service,
        v.confidence_score,
        v.proposed_action,
        v.fingerprint_id,
        v.created_at,
        ps.version as policy_version
      FROM verdicts v
      INNER JOIN policy_snapshots ps ON v.policy_snapshot_id = ps.id
      ORDER BY v.created_at DESC
      LIMIT $1
    `;

    // Get verdict KPIs
    const kpisQuery = `
      SELECT 
        COUNT(*) as total_verdicts,
        AVG(confidence_score) as avg_confidence,
        COUNT(*) FILTER (WHERE proposed_action = 'WAIT_AND_RETRY') as wait_and_retry,
        COUNT(*) FILTER (WHERE proposed_action = 'OPEN_ISSUE') as open_issue,
        COUNT(*) FILTER (WHERE proposed_action = 'HUMAN_REQUIRED') as human_required
      FROM verdicts
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `;

    // Get top error classes
    const topErrorsQuery = `
      SELECT 
        error_class,
        COUNT(*) as count,
        AVG(confidence_score) as avg_confidence
      FROM verdicts
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY error_class
      ORDER BY count DESC
      LIMIT 5
    `;

    const [verdictsResult, kpisResult, topErrorsResult] = await Promise.all([
      pool.query(verdictsQuery, [limit]),
      pool.query(kpisQuery),
      pool.query(topErrorsQuery),
    ]);

    // Map verdicts to summary format
    const summary: VerdictSummary[] = verdictsResult.rows.map((row) => ({
      id: row.id,
      executionId: row.execution_id,
      errorClass: row.error_class,
      service: row.service,
      confidenceScore: row.confidence_score,
      proposedAction: row.proposed_action,
      fingerprintId: row.fingerprint_id,
      policyVersion: row.policy_version,
      createdAt: row.created_at.toISOString(),
    }));

    // Calculate consistency score
    // Group by fingerprint and check if all have same error_class and confidence
    const fingerprintGroups = new Map<string, VerdictSummary[]>();
    for (const verdict of summary) {
      if (!fingerprintGroups.has(verdict.fingerprintId)) {
        fingerprintGroups.set(verdict.fingerprintId, []);
      }
      fingerprintGroups.get(verdict.fingerprintId)!.push(verdict);
    }

    let consistentGroups = 0;
    for (const [, group] of fingerprintGroups) {
      if (group.length === 1) {
        consistentGroups++;
        continue;
      }
      const first = group[0];
      const allConsistent = group.every(
        v => v.errorClass === first.errorClass && v.confidenceScore === first.confidenceScore
      );
      if (allConsistent) {
        consistentGroups++;
      }
    }

    const consistencyScore = fingerprintGroups.size > 0
      ? Math.round((consistentGroups / fingerprintGroups.size) * 100)
      : 100;

    // Build KPIs
    const kpisRow = kpisResult.rows[0];
    const kpis: VerdictKPIs = {
      totalVerdicts: parseInt(kpisRow.total_verdicts, 10),
      avgConfidence: kpisRow.avg_confidence 
        ? Math.round(parseFloat(kpisRow.avg_confidence)) 
        : 0,
      consistencyScore,
      byAction: {
        waitAndRetry: parseInt(kpisRow.wait_and_retry, 10),
        openIssue: parseInt(kpisRow.open_issue, 10),
        humanRequired: parseInt(kpisRow.human_required, 10),
      },
      topErrorClasses: topErrorsResult.rows.map((row) => ({
        errorClass: row.error_class,
        count: parseInt(row.count, 10),
        avgConfidence: Math.round(parseFloat(row.avg_confidence)),
      })),
    };

    return { summary, kpis };
  } catch (error) {
    console.error('[Factory Status] Error fetching verdicts:', error);
    // Return empty data on error instead of throwing
    return {
      summary: [],
      kpis: {
        totalVerdicts: 0,
        avgConfidence: 0,
        consistencyScore: 0,
        byAction: {
          waitAndRetry: 0,
          openIssue: 0,
          humanRequired: 0,
        },
        topErrorClasses: [],
      },
    };
  }
}
