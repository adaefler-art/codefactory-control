/**
 * KPI Service
 * 
 * Service layer for KPI calculation, aggregation, and historization
 * EPIC 3: KPI System & Telemetry
 * Issue 3.2: KPI Aggregation Pipeline
 */

import { getPool } from './db';
import {
  KpiSnapshot,
  KpiLevel,
  SteeringAccuracyMetrics,
  KpiFreshnessMetrics,
  ProductKPIs,
  ExtendedFactoryKPIs,
  KpiHistoryQueryParams,
  KpiHistoryResponse,
  KpiDataPoint,
  CreateKpiSnapshotRequest,
  KpiAggregationJob,
  calculateKpiFreshnessStatus,
} from './types/kpi';

const KPI_VERSION = '1.0.0';

/**
 * Check if a database table exists
 * Utility to avoid repeated information_schema queries
 */
async function tableExists(tableName: string): Promise<boolean> {
  const pool = getPool();
  
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      );
    `;
    
    const result = await pool.query(query, [tableName]);
    return result.rows[0].exists;
  } catch (error) {
    console.error(`[KPI Service] Error checking table existence for ${tableName}:`, error);
    return false;
  }
}

/**
 * Create a KPI snapshot
 */
export async function createKpiSnapshot(
  request: CreateKpiSnapshotRequest
): Promise<KpiSnapshot> {
  const pool = getPool();
  
  const query = `
    INSERT INTO kpi_snapshots (
      kpi_name, kpi_version, level, scope_id, value, unit,
      metadata, calculated_at, period_start, period_end
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
    RETURNING 
      id, kpi_name, kpi_version, level, scope_id, value, unit,
      metadata, calculated_at, period_start, period_end, created_at
  `;
  
  try {
    const result = await pool.query(query, [
      request.kpiName,
      KPI_VERSION,
      request.level,
      request.scopeId || null,
      request.value,
      request.unit,
      request.metadata ? JSON.stringify(request.metadata) : null,
      request.periodStart,
      request.periodEnd,
    ]);
    
    const row = result.rows[0];
    return mapKpiSnapshot(row);
  } catch (error) {
    console.error('[KPI Service] Error creating KPI snapshot:', error);
    throw error;
  }
}

/**
 * Get extended factory KPIs with steering accuracy and freshness
 */
export async function getExtendedFactoryKPIs(
  periodHours: number = 24
): Promise<ExtendedFactoryKPIs> {
  const pool = getPool();
  
  // Get base KPIs
  const baseKpisQuery = `
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
    const [baseResult, steeringResult, freshnessResult] = await Promise.all([
      pool.query(baseKpisQuery, [periodHours]),
      calculateSteeringAccuracy(periodHours),
      getKpiFreshness(),
    ]);
    
    const row = baseResult.rows[0];
    const totalExecutions = parseInt(row.total_executions, 10);
    const completedExecutions = parseInt(row.completed_executions, 10);
    const failedExecutions = parseInt(row.failed_executions, 10);
    const runningExecutions = parseInt(row.running_executions, 10);
    
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
      successRate: Math.round(successRate * 100) / 100,
      avgExecutionDurationMs: row.avg_duration_ms 
        ? Math.round(parseFloat(row.avg_duration_ms)) 
        : null,
      runningExecutions,
      steeringAccuracy: steeringResult,
      kpiFreshness: freshnessResult,
      calculatedAt: new Date().toISOString(),
      periodHours,
      kpiVersion: KPI_VERSION,
    };
  } catch (error) {
    console.error('[KPI Service] Error calculating extended factory KPIs:', error);
    throw error;
  }
}

/**
 * Calculate steering accuracy from verdict outcomes
 * Issue 3.1: Steering Accuracy KPI
 */
export async function calculateSteeringAccuracy(
  periodHours: number = 24
): Promise<SteeringAccuracyMetrics | undefined> {
  const pool = getPool();
  
  // Check if verdict_outcomes table exists
  const exists = await tableExists('verdict_outcomes');
  
  if (!exists) {
    // Table doesn't exist yet (migration not run)
    return undefined;
  }
  
  try {
    const query = `
      SELECT * FROM calculate_steering_accuracy($1)
    `;
    
    const result = await pool.query(query, [periodHours]);
    
    if (result.rows.length === 0 || result.rows[0].total_decisions === '0') {
      return undefined;
    }
    
    const row = result.rows[0];
    
    return {
      steeringAccuracyPct: parseFloat(row.steering_accuracy_pct) || 0,
      totalDecisions: parseInt(row.total_decisions, 10),
      acceptedDecisions: parseInt(row.accepted_decisions, 10),
      overriddenDecisions: parseInt(row.overridden_decisions, 10),
      escalatedDecisions: parseInt(row.escalated_decisions, 10),
      periodStart: new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString(),
      periodEnd: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[KPI Service] Error calculating steering accuracy:', error);
    return undefined;
  }
}

/**
 * Get KPI freshness for all KPIs
 * Issue 3.2: KPI Freshness KPI
 */
export async function getKpiFreshness(
  kpiName?: string
): Promise<KpiFreshnessMetrics[]> {
  const pool = getPool();
  
  const query = `
    SELECT * FROM get_kpi_freshness($1)
  `;
  
  try {
    const result = await pool.query(query, [kpiName || null]);
    
    return result.rows.map((row) => {
      const freshnessSeconds = parseFloat(row.freshness_seconds);
      const { isFresh, status } = calculateKpiFreshnessStatus(freshnessSeconds);
      
      return {
        kpiName: row.kpi_name,
        freshnessSeconds,
        lastCalculatedAt: row.last_calculated_at.toISOString(),
        isFresh,
        status,
      };
    });
  } catch (error) {
    console.error('[KPI Service] Error getting KPI freshness:', error);
    return [];
  }
}

/**
 * Get product-level KPIs
 */
export async function getProductKPIs(
  repositoryId?: string,
  periodDays: number = 7
): Promise<ProductKPIs[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      r.id as repository_id,
      r.owner || '/' || r.name as product_name,
      ROUND(
        (COUNT(*) FILTER (WHERE we.status = 'completed')::DECIMAL / 
         NULLIF(COUNT(*), 0)) * 100,
        2
      ) as success_rate_pct,
      COUNT(*) / $2::DECIMAL as daily_throughput,
      COUNT(*) as total_executions,
      COUNT(*) FILTER (WHERE we.status = 'completed') as completed_executions,
      COUNT(*) FILTER (WHERE we.status = 'failed') as failed_executions,
      AVG(EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) * 1000) 
        FILTER (WHERE we.status = 'completed') as avg_duration_ms,
      MIN(we.started_at) as period_start,
      MAX(we.started_at) as period_end
    FROM repositories r
    LEFT JOIN workflow_executions we ON r.id = we.repository_id
    WHERE (we.started_at >= NOW() - INTERVAL '1 day' * $2 OR we.started_at IS NULL)
      AND ($1::UUID IS NULL OR r.id = $1)
      AND r.kpi_enabled = TRUE
    GROUP BY r.id, r.owner, r.name
    HAVING COUNT(*) > 0
    ORDER BY total_executions DESC
  `;
  
  try {
    const result = await pool.query(query, [repositoryId || null, periodDays]);
    
    return result.rows.map((row) => ({
      repositoryId: row.repository_id,
      productName: row.product_name,
      successRatePct: parseFloat(row.success_rate_pct) || 0,
      dailyThroughput: parseFloat(row.daily_throughput) || 0,
      totalExecutions: parseInt(row.total_executions, 10),
      completedExecutions: parseInt(row.completed_executions, 10),
      failedExecutions: parseInt(row.failed_executions, 10),
      avgDurationMs: row.avg_duration_ms ? Math.round(parseFloat(row.avg_duration_ms)) : null,
      periodStart: row.period_start ? row.period_start.toISOString() : new Date().toISOString(),
      periodEnd: row.period_end ? row.period_end.toISOString() : new Date().toISOString(),
      calculatedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[KPI Service] Error getting product KPIs:', error);
    throw error;
  }
}

/**
 * Get KPI history
 */
export async function getKpiHistory(
  params: KpiHistoryQueryParams
): Promise<KpiHistoryResponse> {
  const pool = getPool();
  
  const limit = params.limit || 100;
  const level = params.level || 'factory';
  
  const query = `
    SELECT 
      kpi_name, level, scope_id, unit,
      calculated_at, value, metadata
    FROM kpi_snapshots
    WHERE kpi_name = $1
      AND level = $2
      AND ($3::UUID IS NULL OR scope_id = $3)
      AND ($4::TIMESTAMP IS NULL OR calculated_at >= $4)
      AND ($5::TIMESTAMP IS NULL OR calculated_at <= $5)
    ORDER BY calculated_at DESC
    LIMIT $6
  `;
  
  try {
    const result = await pool.query(query, [
      params.kpiName,
      level,
      params.scopeId || null,
      params.fromDate || null,
      params.toDate || null,
      limit,
    ]);
    
    if (result.rows.length === 0) {
      throw new Error(`No KPI history found for: ${params.kpiName}. The KPI may not exist or no data has been collected yet.`);
    }
    
    const dataPoints: KpiDataPoint[] = result.rows.map((row) => ({
      timestamp: row.calculated_at.toISOString(),
      value: parseFloat(row.value),
      metadata: row.metadata,
    }));
    
    // Calculate summary
    const values = dataPoints.map(dp => dp.value);
    const summary = {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      latest: values[0],
    };
    
    const firstRow = result.rows[0];
    
    return {
      kpiName: params.kpiName,
      level: firstRow.level,
      scopeId: firstRow.scope_id,
      unit: firstRow.unit,
      dataPoints,
      summary,
      periodStart: params.fromDate || dataPoints[dataPoints.length - 1].timestamp,
      periodEnd: params.toDate || dataPoints[0].timestamp,
    };
  } catch (error) {
    console.error('[KPI Service] Error getting KPI history:', error);
    throw error;
  }
}

/**
 * Trigger KPI aggregation job
 */
export async function triggerKpiAggregation(
  kpiNames: string[],
  periodHours: number = 24
): Promise<KpiAggregationJob> {
  const pool = getPool();
  
  const query = `
    INSERT INTO kpi_aggregation_jobs (
      job_type, status, kpi_names, period_start, period_end, metadata
    ) VALUES (
      'on_demand',
      'pending',
      $1,
      NOW() - INTERVAL '1 hour' * $2,
      NOW(),
      '{"triggered_by": "api", "auto_scheduled": false}'::jsonb
    )
    RETURNING 
      id, job_type, status, kpi_names, period_start, period_end,
      started_at, completed_at, duration_ms, snapshots_created,
      error, metadata, created_at
  `;
  
  try {
    const result = await pool.query(query, [kpiNames, periodHours]);
    const row = result.rows[0];
    
    return mapKpiAggregationJob(row);
  } catch (error) {
    console.error('[KPI Service] Error triggering KPI aggregation:', error);
    throw error;
  }
}

/**
 * Refresh materialized views for KPI performance
 */
export async function refreshKpiMaterializedViews(): Promise<void> {
  const pool = getPool();
  
  try {
    await pool.query('SELECT refresh_kpi_materialized_views()');
    console.log('[KPI Service] Materialized views refreshed successfully');
  } catch (error) {
    console.error('[KPI Service] Error refreshing materialized views:', error);
    throw error;
  }
}

/**
 * Get latest aggregation job status
 */
export async function getLatestAggregationJob(): Promise<KpiAggregationJob | null> {
  const pool = getPool();
  
  const query = `
    SELECT 
      id, job_type, status, kpi_names, period_start, period_end,
      started_at, completed_at, duration_ms, snapshots_created,
      error, metadata, created_at
    FROM kpi_aggregation_jobs
    ORDER BY created_at DESC
    LIMIT 1
  `;
  
  try {
    const result = await pool.query(query);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return mapKpiAggregationJob(result.rows[0]);
  } catch (error) {
    console.error('[KPI Service] Error getting latest aggregation job:', error);
    return null;
  }
}

// Helper functions

function mapKpiSnapshot(row: any): KpiSnapshot {
  return {
    id: row.id,
    kpiName: row.kpi_name,
    kpiVersion: row.kpi_version,
    level: row.level,
    scopeId: row.scope_id,
    value: parseFloat(row.value),
    unit: row.unit,
    metadata: row.metadata,
    calculatedAt: row.calculated_at.toISOString(),
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

function mapKpiAggregationJob(row: any): KpiAggregationJob {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    kpiNames: row.kpi_names,
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : undefined,
    completedAt: row.completed_at ? row.completed_at.toISOString() : undefined,
    durationMs: row.duration_ms,
    snapshotsCreated: row.snapshots_created,
    error: row.error,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Aggregation Pipeline Functions
 * Issue 3.2: KPI Aggregation Pipeline (Run → Product → Factory)
 */

/**
 * Aggregate run-level KPIs from workflow_executions
 * Creates KPI snapshots for individual runs
 */
export async function aggregateRunKPIs(
  executionId: string
): Promise<KpiSnapshot[]> {
  const pool = getPool();
  const snapshots: KpiSnapshot[] = [];
  
  try {
    // Get execution data
    const executionQuery = `
      SELECT 
        id,
        repository_id,
        started_at,
        completed_at,
        status,
        EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 as duration_ms
      FROM workflow_executions
      WHERE id = $1
        AND status IN ('completed', 'failed')
        AND completed_at IS NOT NULL
    `;
    
    const executionResult = await pool.query(executionQuery, [executionId]);
    
    if (executionResult.rows.length === 0) {
      console.log(`[KPI Service] No completed execution found for ID: ${executionId}`);
      return snapshots;
    }
    
    const execution = executionResult.rows[0];
    const periodStart = execution.started_at;
    const periodEnd = execution.completed_at;
    
    // 1. Run Duration KPI
    const durationSnapshot = await createKpiSnapshot({
      kpiName: 'run_duration',
      level: 'run',
      scopeId: executionId,
      value: execution.duration_ms,
      unit: 'milliseconds',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      metadata: {
        status: execution.status,
        repositoryId: execution.repository_id,
      },
    });
    snapshots.push(durationSnapshot);
    
    // 2. Token Usage KPI (if available in execution metadata)
    const tokenQuery = `
      SELECT metadata->'token_usage' as token_usage
      FROM workflow_executions
      WHERE id = $1
        AND metadata ? 'token_usage'
    `;
    
    const tokenResult = await pool.query(tokenQuery, [executionId]);
    
    if (tokenResult.rows.length > 0 && tokenResult.rows[0].token_usage) {
      const tokenUsage = tokenResult.rows[0].token_usage;
      const totalTokens = (tokenUsage.prompt_tokens || 0) + (tokenUsage.completion_tokens || 0);
      
      const tokenSnapshot = await createKpiSnapshot({
        kpiName: 'token_usage',
        level: 'run',
        scopeId: executionId,
        value: totalTokens,
        unit: 'tokens',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          promptTokens: tokenUsage.prompt_tokens,
          completionTokens: tokenUsage.completion_tokens,
        },
      });
      snapshots.push(tokenSnapshot);
    }
    
    // 3. Tool Call Success Rate (if available)
    const toolCallQuery = `
      SELECT 
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE metadata->>'success' = 'true') as successful_calls
      FROM workflow_execution_steps
      WHERE execution_id = $1
        AND step_type = 'tool_call'
    `;
    
    const toolCallResult = await pool.query(toolCallQuery, [executionId]);
    
    if (toolCallResult.rows.length > 0 && toolCallResult.rows[0].total_calls > 0) {
      const totalCalls = parseInt(toolCallResult.rows[0].total_calls, 10);
      const successfulCalls = parseInt(toolCallResult.rows[0].successful_calls, 10);
      const successRate = (successfulCalls / totalCalls) * 100;
      
      const toolCallSnapshot = await createKpiSnapshot({
        kpiName: 'tool_call_success_rate',
        level: 'run',
        scopeId: executionId,
        value: successRate,
        unit: 'percentage',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          totalCalls,
          successfulCalls,
        },
      });
      snapshots.push(toolCallSnapshot);
    }
    
    console.log(`[KPI Service] Aggregated ${snapshots.length} run-level KPIs for execution ${executionId}`);
    return snapshots;
  } catch (error) {
    console.error('[KPI Service] Error aggregating run KPIs:', error);
    throw error;
  }
}

/**
 * Aggregate product-level KPIs from run-level snapshots
 * Creates KPI snapshots for a specific product/repository
 */
export async function aggregateProductKPIsFromRuns(
  repositoryId: string,
  periodHours: number = 24
): Promise<KpiSnapshot[]> {
  const pool = getPool();
  const snapshots: KpiSnapshot[] = [];
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - periodHours * 60 * 60 * 1000);
  
  try {
    // Get repository info
    const repoQuery = `
      SELECT owner || '/' || name as product_name
      FROM repositories
      WHERE id = $1
    `;
    
    const repoResult = await pool.query(repoQuery, [repositoryId]);
    
    if (repoResult.rows.length === 0) {
      console.log(`[KPI Service] No repository found for ID: ${repositoryId}`);
      return snapshots;
    }
    
    const productName = repoResult.rows[0].product_name;
    
    // 1. Product Success Rate
    const successRateQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM workflow_executions
      WHERE repository_id = $1
        AND started_at >= $2
        AND started_at <= $3
        AND status IN ('completed', 'failed')
    `;
    
    const successRateResult = await pool.query(successRateQuery, [
      repositoryId,
      periodStart,
      periodEnd,
    ]);
    
    if (successRateResult.rows.length > 0 && successRateResult.rows[0].total > 0) {
      const completed = parseInt(successRateResult.rows[0].completed, 10);
      const total = parseInt(successRateResult.rows[0].total, 10);
      const successRate = (completed / total) * 100;
      
      const successRateSnapshot = await createKpiSnapshot({
        kpiName: 'product_success_rate',
        level: 'product',
        scopeId: repositoryId,
        value: successRate,
        unit: 'percentage',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          productName,
          completedRuns: completed,
          totalRuns: total,
        },
      });
      snapshots.push(successRateSnapshot);
    }
    
    // 2. Product Throughput (runs per day)
    const throughputQuery = `
      SELECT COUNT(*) as total_runs
      FROM workflow_executions
      WHERE repository_id = $1
        AND started_at >= $2
        AND started_at <= $3
    `;
    
    const throughputResult = await pool.query(throughputQuery, [
      repositoryId,
      periodStart,
      periodEnd,
    ]);
    
    if (throughputResult.rows.length > 0) {
      const totalRuns = parseInt(throughputResult.rows[0].total_runs, 10);
      const periodDays = Math.max(periodHours / 24, 1); // At least 1 day
      const throughput = totalRuns / periodDays;
      
      const throughputSnapshot = await createKpiSnapshot({
        kpiName: 'product_throughput',
        level: 'product',
        scopeId: repositoryId,
        value: throughput,
        unit: 'runs_per_day',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          productName,
          totalRuns,
        },
      });
      snapshots.push(throughputSnapshot);
    }
    
    // 3. Average run duration from run-level snapshots
    const avgDurationQuery = `
      SELECT AVG(value) as avg_duration
      FROM kpi_snapshots
      WHERE kpi_name = 'run_duration'
        AND level = 'run'
        AND scope_id IN (
          SELECT id FROM workflow_executions 
          WHERE repository_id = $1
            AND started_at >= $2
            AND started_at <= $3
        )
        AND calculated_at >= $2
    `;
    
    const avgDurationResult = await pool.query(avgDurationQuery, [
      repositoryId,
      periodStart,
      periodEnd,
    ]);
    
    if (avgDurationResult.rows.length > 0 && avgDurationResult.rows[0].avg_duration) {
      const avgDuration = parseFloat(avgDurationResult.rows[0].avg_duration);
      
      const avgDurationSnapshot = await createKpiSnapshot({
        kpiName: 'product_avg_duration',
        level: 'product',
        scopeId: repositoryId,
        value: avgDuration,
        unit: 'milliseconds',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          productName,
        },
      });
      snapshots.push(avgDurationSnapshot);
    }
    
    console.log(`[KPI Service] Aggregated ${snapshots.length} product-level KPIs for repository ${repositoryId}`);
    return snapshots;
  } catch (error) {
    console.error('[KPI Service] Error aggregating product KPIs:', error);
    throw error;
  }
}

/**
 * Aggregate factory-level KPIs from product-level snapshots
 * Creates KPI snapshots for the entire factory
 */
export async function aggregateFactoryKPIsFromProducts(
  periodHours: number = 24
): Promise<KpiSnapshot[]> {
  const pool = getPool();
  const snapshots: KpiSnapshot[] = [];
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - periodHours * 60 * 60 * 1000);
  
  try {
    // 1. Mean Time to Insight (MTTI)
    const mttiQuery = `
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as mtti_ms
      FROM workflow_executions
      WHERE status IN ('completed', 'failed')
        AND started_at >= $1
        AND started_at <= $2
        AND completed_at IS NOT NULL
    `;
    
    const mttiResult = await pool.query(mttiQuery, [periodStart, periodEnd]);
    
    if (mttiResult.rows.length > 0 && mttiResult.rows[0].mtti_ms) {
      const mtti = parseFloat(mttiResult.rows[0].mtti_ms);
      
      const mttiSnapshot = await createKpiSnapshot({
        kpiName: 'mtti',
        level: 'factory',
        scopeId: null,
        value: mtti,
        unit: 'milliseconds',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          targetMs: 300000, // 5 minutes
        },
      });
      snapshots.push(mttiSnapshot);
    }
    
    // 2. Factory Success Rate
    const successRateQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) as total
      FROM workflow_executions
      WHERE status IN ('completed', 'failed')
        AND started_at >= $1
        AND started_at <= $2
    `;
    
    const successRateResult = await pool.query(successRateQuery, [periodStart, periodEnd]);
    
    if (successRateResult.rows.length > 0 && successRateResult.rows[0].total > 0) {
      const completed = parseInt(successRateResult.rows[0].completed, 10);
      const total = parseInt(successRateResult.rows[0].total, 10);
      const successRate = (completed / total) * 100;
      
      const successRateSnapshot = await createKpiSnapshot({
        kpiName: 'success_rate',
        level: 'factory',
        scopeId: null,
        value: successRate,
        unit: 'percentage',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          completedRuns: completed,
          totalRuns: total,
          targetPct: 85,
        },
      });
      snapshots.push(successRateSnapshot);
    }
    
    // 3. Factory Throughput (total runs per day)
    const throughputQuery = `
      SELECT COUNT(*) as total_runs
      FROM workflow_executions
      WHERE started_at >= $1
        AND started_at <= $2
    `;
    
    const throughputResult = await pool.query(throughputQuery, [periodStart, periodEnd]);
    
    if (throughputResult.rows.length > 0) {
      const totalRuns = parseInt(throughputResult.rows[0].total_runs, 10);
      const periodDays = Math.max(periodHours / 24, 1); // At least 1 day
      const throughput = totalRuns / periodDays;
      
      const throughputSnapshot = await createKpiSnapshot({
        kpiName: 'factory_throughput',
        level: 'factory',
        scopeId: null,
        value: throughput,
        unit: 'runs_per_day',
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        metadata: {
          totalRuns,
        },
      });
      snapshots.push(throughputSnapshot);
    }
    
    // 4. Steering Accuracy (from verdict outcomes)
    const steeringAccuracyMetrics = await calculateSteeringAccuracy(periodHours);
    
    if (steeringAccuracyMetrics && steeringAccuracyMetrics.totalDecisions > 0) {
      const steeringAccuracySnapshot = await createKpiSnapshot({
        kpiName: 'steering_accuracy',
        level: 'factory',
        scopeId: null,
        value: steeringAccuracyMetrics.steeringAccuracyPct,
        unit: 'percentage',
        periodStart: steeringAccuracyMetrics.periodStart,
        periodEnd: steeringAccuracyMetrics.periodEnd,
        metadata: {
          totalDecisions: steeringAccuracyMetrics.totalDecisions,
          acceptedDecisions: steeringAccuracyMetrics.acceptedDecisions,
          targetPct: 90,
        },
      });
      snapshots.push(steeringAccuracySnapshot);
    }
    
    console.log(`[KPI Service] Aggregated ${snapshots.length} factory-level KPIs`);
    return snapshots;
  } catch (error) {
    console.error('[KPI Service] Error aggregating factory KPIs:', error);
    throw error;
  }
}

/**
 * Execute full aggregation pipeline: Run → Product → Factory
 * This is the main orchestration function for the KPI aggregation pipeline
 */
export async function executeKpiAggregationPipeline(
  periodHours: number = 24
): Promise<KpiAggregationJob> {
  const pool = getPool();
  const startTime = Date.now();
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - periodHours * 60 * 60 * 1000);
  
  // Create aggregation job
  const jobQuery = `
    INSERT INTO kpi_aggregation_jobs (
      job_type, status, kpi_names, period_start, period_end, started_at, metadata
    ) VALUES (
      'incremental',
      'running',
      $3,
      $1,
      $2,
      NOW(),
      '{"pipeline": "run->product->factory", "triggered_by": "scheduler"}'::jsonb
    )
    RETURNING id, job_type, status, kpi_names, period_start, period_end, started_at, created_at
  `;
  
  try {
    const jobResult = await pool.query(jobQuery, [periodStart, periodEnd, KPI_NAMES]);
    const jobId = jobResult.rows[0].id;
    let totalSnapshots = 0;
    
    try {
      // Step 1: Aggregate run-level KPIs for recent completed executions
      const executionsQuery = `
        SELECT id
        FROM workflow_executions
        WHERE status IN ('completed', 'failed')
          AND completed_at >= $1
          AND completed_at <= $2
          AND NOT EXISTS (
            SELECT 1 FROM kpi_snapshots
            WHERE kpi_name = 'run_duration'
              AND level = 'run'
              AND scope_id = workflow_executions.id
          )
        ORDER BY completed_at DESC
        LIMIT 100
      `;
      
      const executionsResult = await pool.query(executionsQuery, [periodStart, periodEnd]);
      
      console.log(`[KPI Pipeline] Processing ${executionsResult.rows.length} run-level aggregations`);
      
      for (const row of executionsResult.rows) {
        const runSnapshots = await aggregateRunKPIs(row.id);
        totalSnapshots += runSnapshots.length;
      }
      
      // Step 2: Aggregate product-level KPIs
      const repositoriesQuery = `
        SELECT DISTINCT r.id
        FROM repositories r
        INNER JOIN workflow_executions we ON we.repository_id = r.id
        WHERE we.started_at >= $1
          AND we.started_at <= $2
          AND r.kpi_enabled = TRUE
      `;
      
      const repositoriesResult = await pool.query(repositoriesQuery, [periodStart, periodEnd]);
      
      console.log(`[KPI Pipeline] Processing ${repositoriesResult.rows.length} product-level aggregations`);
      
      for (const row of repositoriesResult.rows) {
        const productSnapshots = await aggregateProductKPIsFromRuns(row.id, periodHours);
        totalSnapshots += productSnapshots.length;
      }
      
      // Step 3: Aggregate factory-level KPIs
      console.log('[KPI Pipeline] Processing factory-level aggregation');
      const factorySnapshots = await aggregateFactoryKPIsFromProducts(periodHours);
      totalSnapshots += factorySnapshots.length;
      
      // Step 4: Refresh materialized views
      await refreshKpiMaterializedViews();
      
      // Update job as completed
      const durationMs = Date.now() - startTime;
      
      const updateQuery = `
        UPDATE kpi_aggregation_jobs
        SET status = 'completed',
            completed_at = NOW(),
            duration_ms = $1,
            snapshots_created = $2
        WHERE id = $3
        RETURNING 
          id, job_type, status, kpi_names, period_start, period_end,
          started_at, completed_at, duration_ms, snapshots_created,
          error, metadata, created_at
      `;
      
      const updateResult = await pool.query(updateQuery, [durationMs, totalSnapshots, jobId]);
      
      console.log(`[KPI Pipeline] Aggregation completed: ${totalSnapshots} snapshots in ${durationMs}ms`);
      
      return mapKpiAggregationJob(updateResult.rows[0]);
    } catch (error) {
      // Update job as failed
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await pool.query(
        `UPDATE kpi_aggregation_jobs
         SET status = 'failed',
             completed_at = NOW(),
             duration_ms = $1,
             snapshots_created = $2,
             error = $3
         WHERE id = $4`,
        [durationMs, totalSnapshots, errorMessage, jobId]
      );
      
      throw error;
    }
  } catch (error) {
    console.error('[KPI Pipeline] Error executing aggregation pipeline:', error);
    throw error;
  }
}
