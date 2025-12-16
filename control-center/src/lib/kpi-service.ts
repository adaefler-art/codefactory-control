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
  const tableCheckQuery = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'verdict_outcomes'
    );
  `;
  
  try {
    const tableCheck = await pool.query(tableCheckQuery);
    
    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist yet (migration not run)
      return undefined;
    }
    
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
      throw new Error(`No data found for KPI: ${params.kpiName}`);
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
