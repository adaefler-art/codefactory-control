#!/usr/bin/env node

/**
 * KPI Aggregation Scheduler
 * 
 * Periodically executes the KPI aggregation pipeline (Run → Product → Factory)
 * EPIC 3: KPI System & Telemetry
 * Issue 3.2: KPI Aggregation Pipeline
 * 
 * Usage:
 *   node scripts/kpi-aggregation-scheduler.js
 * 
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   KPI_AGGREGATION_INTERVAL_MS - Interval between aggregations (default: 300000 = 5 minutes)
 *   KPI_AGGREGATION_PERIOD_HOURS - Period for KPI calculation (default: 24 hours)
 */

const { Pool } = require('pg');

// Configuration
const DATABASE_URL = process.env.DATABASE_URL;
const AGGREGATION_INTERVAL_MS = parseInt(process.env.KPI_AGGREGATION_INTERVAL_MS || '300000', 10); // 5 minutes
const AGGREGATION_PERIOD_HOURS = parseInt(process.env.KPI_AGGREGATION_PERIOD_HOURS || '24', 10); // 24 hours
const KPI_VERSION = '1.0.0';

if (!DATABASE_URL) {
  console.error('[KPI Scheduler] ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// Database connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// State
let isRunning = false;
let intervalId = null;
let shutdownRequested = false;

/**
 * Aggregate run-level KPIs for a specific execution
 */
async function aggregateRunKPIs(executionId, periodStart, periodEnd) {
  const client = await pool.connect();
  const snapshots = [];
  
  try {
    // Get execution data
    const executionResult = await client.query(
      `SELECT 
        id,
        repository_id,
        started_at,
        completed_at,
        status,
        metadata,
        EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000 as duration_ms
      FROM workflow_executions
      WHERE id = $1
        AND status IN ('completed', 'failed')
        AND completed_at IS NOT NULL`,
      [executionId]
    );
    
    if (executionResult.rows.length === 0) {
      return snapshots;
    }
    
    const execution = executionResult.rows[0];
    
    // 1. Run Duration KPI
    await client.query(
      `INSERT INTO kpi_snapshots (
        kpi_name, kpi_version, level, scope_id, value, unit,
        metadata, calculated_at, period_start, period_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
      [
        'run_duration',
        KPI_VERSION,
        'run',
        executionId,
        execution.duration_ms,
        'milliseconds',
        JSON.stringify({ status: execution.status, repositoryId: execution.repository_id }),
        execution.started_at,
        execution.completed_at,
      ]
    );
    snapshots.push('run_duration');
    
    // 2. Token Usage (if available)
    if (execution.metadata && execution.metadata.token_usage) {
      const tokenUsage = execution.metadata.token_usage;
      const totalTokens = (tokenUsage.prompt_tokens || 0) + (tokenUsage.completion_tokens || 0);
      
      await client.query(
        `INSERT INTO kpi_snapshots (
          kpi_name, kpi_version, level, scope_id, value, unit,
          metadata, calculated_at, period_start, period_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
        [
          'token_usage',
          KPI_VERSION,
          'run',
          executionId,
          totalTokens,
          'tokens',
          JSON.stringify(tokenUsage),
          execution.started_at,
          execution.completed_at,
        ]
      );
      snapshots.push('token_usage');
    }
    
    return snapshots;
  } finally {
    client.release();
  }
}

/**
 * Aggregate product-level KPIs for a repository
 */
async function aggregateProductKPIs(repositoryId, periodStart, periodEnd) {
  const client = await pool.connect();
  const snapshots = [];
  
  try {
    // Get repository info
    const repoResult = await client.query(
      `SELECT owner || '/' || name as product_name FROM repositories WHERE id = $1`,
      [repositoryId]
    );
    
    if (repoResult.rows.length === 0) {
      return snapshots;
    }
    
    const productName = repoResult.rows[0].product_name;
    
    // 1. Product Success Rate
    const successRateResult = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM workflow_executions
      WHERE repository_id = $1
        AND started_at >= $2
        AND started_at <= $3
        AND status IN ('completed', 'failed')`,
      [repositoryId, periodStart, periodEnd]
    );
    
    if (successRateResult.rows[0].total > 0) {
      const completed = parseInt(successRateResult.rows[0].completed, 10);
      const total = parseInt(successRateResult.rows[0].total, 10);
      const successRate = (completed / total) * 100;
      
      await client.query(
        `INSERT INTO kpi_snapshots (
          kpi_name, kpi_version, level, scope_id, value, unit,
          metadata, calculated_at, period_start, period_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
        [
          'product_success_rate',
          KPI_VERSION,
          'product',
          repositoryId,
          successRate,
          'percentage',
          JSON.stringify({ productName, completedRuns: completed, totalRuns: total }),
          periodStart,
          periodEnd,
        ]
      );
      snapshots.push('product_success_rate');
    }
    
    // 2. Product Throughput
    const throughputResult = await client.query(
      `SELECT COUNT(*) as total_runs
      FROM workflow_executions
      WHERE repository_id = $1
        AND started_at >= $2
        AND started_at <= $3`,
      [repositoryId, periodStart, periodEnd]
    );
    
    const totalRuns = parseInt(throughputResult.rows[0].total_runs, 10);
    const throughput = totalRuns / (AGGREGATION_PERIOD_HOURS / 24);
    
    await client.query(
      `INSERT INTO kpi_snapshots (
        kpi_name, kpi_version, level, scope_id, value, unit,
        metadata, calculated_at, period_start, period_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
      [
        'product_throughput',
        KPI_VERSION,
        'product',
        repositoryId,
        throughput,
        'runs_per_day',
        JSON.stringify({ productName, totalRuns }),
        periodStart,
        periodEnd,
      ]
    );
    snapshots.push('product_throughput');
    
    return snapshots;
  } finally {
    client.release();
  }
}

/**
 * Aggregate factory-level KPIs
 */
async function aggregateFactoryKPIs(periodStart, periodEnd) {
  const client = await pool.connect();
  const snapshots = [];
  
  try {
    // 1. Mean Time to Insight (MTTI)
    const mttiResult = await client.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as mtti_ms
      FROM workflow_executions
      WHERE status IN ('completed', 'failed')
        AND started_at >= $1
        AND started_at <= $2
        AND completed_at IS NOT NULL`,
      [periodStart, periodEnd]
    );
    
    if (mttiResult.rows[0].mtti_ms) {
      const mtti = parseFloat(mttiResult.rows[0].mtti_ms);
      
      await client.query(
        `INSERT INTO kpi_snapshots (
          kpi_name, kpi_version, level, scope_id, value, unit,
          metadata, calculated_at, period_start, period_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
        [
          'mtti',
          KPI_VERSION,
          'factory',
          null,
          mtti,
          'milliseconds',
          JSON.stringify({ targetMs: 300000 }),
          periodStart,
          periodEnd,
        ]
      );
      snapshots.push('mtti');
    }
    
    // 2. Factory Success Rate
    const successRateResult = await client.query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) as total
      FROM workflow_executions
      WHERE status IN ('completed', 'failed')
        AND started_at >= $1
        AND started_at <= $2`,
      [periodStart, periodEnd]
    );
    
    if (successRateResult.rows[0].total > 0) {
      const completed = parseInt(successRateResult.rows[0].completed, 10);
      const total = parseInt(successRateResult.rows[0].total, 10);
      const successRate = (completed / total) * 100;
      
      await client.query(
        `INSERT INTO kpi_snapshots (
          kpi_name, kpi_version, level, scope_id, value, unit,
          metadata, calculated_at, period_start, period_end
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)`,
        [
          'success_rate',
          KPI_VERSION,
          'factory',
          null,
          successRate,
          'percentage',
          JSON.stringify({ completedRuns: completed, totalRuns: total, targetPct: 85 }),
          periodStart,
          periodEnd,
        ]
      );
      snapshots.push('success_rate');
    }
    
    return snapshots;
  } finally {
    client.release();
  }
}

/**
 * Execute the full aggregation pipeline
 */
async function executeAggregationPipeline() {
  if (isRunning) {
    console.log('[KPI Scheduler] Aggregation already running, skipping this cycle');
    return;
  }
  
  isRunning = true;
  const startTime = Date.now();
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - AGGREGATION_PERIOD_HOURS * 60 * 60 * 1000);
  
  console.log(`[KPI Scheduler] Starting aggregation pipeline at ${new Date().toISOString()}`);
  console.log(`[KPI Scheduler] Period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);
  
  const client = await pool.connect();
  
  try {
    // Create aggregation job
    const jobResult = await client.query(
      `INSERT INTO kpi_aggregation_jobs (
        job_type, status, kpi_names, period_start, period_end, started_at, metadata
      ) VALUES (
        'incremental',
        'running',
        ARRAY['run_duration', 'token_usage', 'product_success_rate', 'product_throughput', 'mtti', 'success_rate'],
        $1,
        $2,
        NOW(),
        '{"pipeline": "run->product->factory", "triggered_by": "scheduler"}'::jsonb
      )
      RETURNING id`,
      [periodStart, periodEnd]
    );
    
    const jobId = jobResult.rows[0].id;
    let totalSnapshots = 0;
    
    try {
      // Step 1: Aggregate run-level KPIs
      const executionsResult = await client.query(
        `SELECT id
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
        LIMIT 100`,
        [periodStart, periodEnd]
      );
      
      console.log(`[KPI Scheduler] Processing ${executionsResult.rows.length} run-level aggregations`);
      
      for (const row of executionsResult.rows) {
        const snapshots = await aggregateRunKPIs(row.id, periodStart, periodEnd);
        totalSnapshots += snapshots.length;
      }
      
      // Step 2: Aggregate product-level KPIs
      const repositoriesResult = await client.query(
        `SELECT DISTINCT r.id
        FROM repositories r
        INNER JOIN workflow_executions we ON we.repository_id = r.id
        WHERE we.started_at >= $1
          AND we.started_at <= $2
          AND r.kpi_enabled = TRUE`,
        [periodStart, periodEnd]
      );
      
      console.log(`[KPI Scheduler] Processing ${repositoriesResult.rows.length} product-level aggregations`);
      
      for (const row of repositoriesResult.rows) {
        const snapshots = await aggregateProductKPIs(row.id, periodStart, periodEnd);
        totalSnapshots += snapshots.length;
      }
      
      // Step 3: Aggregate factory-level KPIs
      console.log('[KPI Scheduler] Processing factory-level aggregation');
      const factorySnapshots = await aggregateFactoryKPIs(periodStart, periodEnd);
      totalSnapshots += factorySnapshots.length;
      
      // Step 4: Refresh materialized views (if they exist)
      try {
        await client.query('SELECT refresh_kpi_materialized_views()');
        console.log('[KPI Scheduler] Materialized views refreshed');
      } catch (error) {
        console.log('[KPI Scheduler] Materialized views not available or error refreshing:', error.message);
      }
      
      // Update job as completed
      const durationMs = Date.now() - startTime;
      
      await client.query(
        `UPDATE kpi_aggregation_jobs
        SET status = 'completed',
            completed_at = NOW(),
            duration_ms = $1,
            snapshots_created = $2
        WHERE id = $3`,
        [durationMs, totalSnapshots, jobId]
      );
      
      console.log(`[KPI Scheduler] ✅ Aggregation completed: ${totalSnapshots} snapshots in ${durationMs}ms`);
    } catch (error) {
      // Update job as failed
      const durationMs = Date.now() - startTime;
      
      await client.query(
        `UPDATE kpi_aggregation_jobs
        SET status = 'failed',
            completed_at = NOW(),
            duration_ms = $1,
            snapshots_created = $2,
            error = $3
        WHERE id = $4`,
        [durationMs, totalSnapshots, error.message, jobId]
      );
      
      throw error;
    }
  } catch (error) {
    console.error('[KPI Scheduler] ❌ Error executing aggregation pipeline:', error);
  } finally {
    client.release();
    isRunning = false;
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown() {
  if (shutdownRequested) {
    return;
  }
  
  shutdownRequested = true;
  console.log('\n[KPI Scheduler] Shutdown requested, cleaning up...');
  
  if (intervalId) {
    clearInterval(intervalId);
    console.log('[KPI Scheduler] Stopped interval timer');
  }
  
  // Wait for running aggregation to complete
  let waitCount = 0;
  while (isRunning && waitCount < 60) {
    console.log('[KPI Scheduler] Waiting for aggregation to complete...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    waitCount++;
  }
  
  if (isRunning) {
    console.log('[KPI Scheduler] ⚠️  Timeout waiting for aggregation to complete');
  }
  
  // Close database pool
  await pool.end();
  console.log('[KPI Scheduler] Database pool closed');
  
  console.log('[KPI Scheduler] Shutdown complete');
  process.exit(0);
}

/**
 * Main function
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          AFU-9 KPI Aggregation Scheduler v1.0.0               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Configuration:');
  console.log(`  Aggregation Interval: ${AGGREGATION_INTERVAL_MS}ms (${AGGREGATION_INTERVAL_MS / 1000 / 60} minutes)`);
  console.log(`  Aggregation Period:   ${AGGREGATION_PERIOD_HOURS} hours`);
  console.log(`  KPI Version:          ${KPI_VERSION}`);
  console.log('');
  
  // Test database connection
  try {
    const result = await pool.query('SELECT NOW()');
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
  
  // Register shutdown handlers
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  
  // Run initial aggregation
  console.log('\n[KPI Scheduler] Running initial aggregation...');
  await executeAggregationPipeline();
  
  // Schedule periodic aggregations
  console.log(`\n[KPI Scheduler] Scheduling aggregations every ${AGGREGATION_INTERVAL_MS}ms`);
  intervalId = setInterval(() => {
    executeAggregationPipeline().catch(error => {
      console.error('[KPI Scheduler] Unhandled error in aggregation:', error);
    });
  }, AGGREGATION_INTERVAL_MS);
  
  console.log('[KPI Scheduler] 🚀 Scheduler is running. Press Ctrl+C to stop.\n');
}

// Start the scheduler
main().catch(error => {
  console.error('[KPI Scheduler] Fatal error:', error);
  process.exit(1);
});
