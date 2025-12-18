/**
 * Cost Attribution Service
 * 
 * Service layer for tracking and analyzing AWS costs per workflow execution.
 * Implements Issue 9.1: Cost Attribution per Run (EPIC 9 - Cost & Efficiency Engine)
 * 
 * Key Features:
 * - Per-run cost tracking (AWS + LLM)
 * - Product-level cost aggregation
 * - Factory-level cost overview
 * - Cost per Outcome KPI
 * - CSV/JSON export for controlling
 */

import { getPool } from './db';

// ========================================
// Types
// ========================================

export interface ExecutionCost {
  executionId: string;
  workflowId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  
  // Cost breakdown (USD)
  lambdaCost: number;
  ecsCost: number;
  rdsCost: number;
  s3Cost: number;
  cloudwatchCost: number;
  secretsManagerCost: number;
  otherAwsCost: number;
  llmCost: number;
  
  // Totals
  totalAwsCost: number;
  totalCost: number;
  
  // Metadata
  calculationMethod: 'estimated' | 'cost_explorer' | 'manual';
  calculatedAt: string;
}

export interface ProductCostSummary {
  repositoryId: string;
  productName: string;
  
  // Cost metrics
  totalCost: number;
  avgCostPerRun: number;
  costPerOutcome: number | null;
  
  // Cost breakdown
  lambdaCost: number;
  ecsCost: number;
  rdsCost: number;
  llmCost: number;
  
  // Execution metrics
  totalExecutions: number;
  successfulOutcomes: number;
  
  // Time period
  periodStart: string;
  periodEnd: string;
}

export interface FactoryCostOverview {
  // KPI: Cost per Outcome
  costPerOutcome: number | null;
  
  // Cost breakdown
  totalLambdaCost: number;
  totalEcsCost: number;
  totalRdsCost: number;
  totalS3Cost: number;
  totalCloudwatchCost: number;
  totalLlmCost: number;
  totalAwsCost: number;
  totalCost: number;
  
  // Execution metrics
  totalExecutions: number;
  successfulOutcomes: number;
  failedExecutions: number;
  
  // Time period
  periodStart: string;
  periodEnd: string;
  calculatedAt: string;
}

export interface CostExportRow {
  executionId: string;
  workflowId: string;
  productName: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMinutes: number | null;
  totalCost: number;
  awsCost: number;
  llmCost: number;
  ecsCost: number;
  rdsCost: number;
  calculationMethod: string;
}

export interface CostAllocationRule {
  id: string;
  ruleName: string;
  description: string | null;
  awsService: string;
  allocationMethod: 'per_execution' | 'per_minute' | 'per_invocation' | 'shared_pool' | 'custom';
  baseRateUsd: number | null;
  sharedPoolAllocation: number | null;
  config: any;
  enabled: boolean;
}

// ========================================
// Cost Query Functions
// ========================================

/**
 * Get cost attribution for a specific execution
 */
export async function getExecutionCost(executionId: string): Promise<ExecutionCost | null> {
  const pool = getPool();
  
  const query = `
    SELECT 
      ac.execution_id,
      we.workflow_id,
      we.status,
      we.started_at,
      we.completed_at,
      EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) / 60.0 as duration_minutes,
      ac.lambda_cost_usd,
      ac.ecs_cost_usd,
      ac.rds_cost_usd,
      ac.s3_cost_usd,
      ac.cloudwatch_cost_usd,
      ac.secrets_manager_cost_usd,
      ac.other_aws_cost_usd,
      ac.llm_cost_usd,
      ac.total_aws_cost_usd,
      ac.total_cost_usd,
      ac.calculation_method,
      ac.calculated_at
    FROM aws_cost_attribution ac
    JOIN workflow_executions we ON ac.execution_id = we.id
    WHERE ac.execution_id = $1
  `;
  
  const result = await pool.query(query, [executionId]);
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  return {
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMinutes: row.duration_minutes,
    lambdaCost: Number(row.lambda_cost_usd),
    ecsCost: Number(row.ecs_cost_usd),
    rdsCost: Number(row.rds_cost_usd),
    s3Cost: Number(row.s3_cost_usd),
    cloudwatchCost: Number(row.cloudwatch_cost_usd),
    secretsManagerCost: Number(row.secrets_manager_cost_usd),
    otherAwsCost: Number(row.other_aws_cost_usd),
    llmCost: Number(row.llm_cost_usd),
    totalAwsCost: Number(row.total_aws_cost_usd),
    totalCost: Number(row.total_cost_usd),
    calculationMethod: row.calculation_method,
    calculatedAt: row.calculated_at,
  };
}

/**
 * Get recent executions with costs
 */
export async function getRecentExecutionCosts(limit: number = 50): Promise<ExecutionCost[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      ac.execution_id,
      we.workflow_id,
      we.status,
      we.started_at,
      we.completed_at,
      EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) / 60.0 as duration_minutes,
      ac.lambda_cost_usd,
      ac.ecs_cost_usd,
      ac.rds_cost_usd,
      ac.s3_cost_usd,
      ac.cloudwatch_cost_usd,
      ac.secrets_manager_cost_usd,
      ac.other_aws_cost_usd,
      ac.llm_cost_usd,
      ac.total_aws_cost_usd,
      ac.total_cost_usd,
      ac.calculation_method,
      ac.calculated_at
    FROM aws_cost_attribution ac
    JOIN workflow_executions we ON ac.execution_id = we.id
    ORDER BY we.started_at DESC
    LIMIT $1
  `;
  
  const result = await pool.query(query, [limit]);
  
  return result.rows.map(row => ({
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMinutes: row.duration_minutes,
    lambdaCost: Number(row.lambda_cost_usd),
    ecsCost: Number(row.ecs_cost_usd),
    rdsCost: Number(row.rds_cost_usd),
    s3Cost: Number(row.s3_cost_usd),
    cloudwatchCost: Number(row.cloudwatch_cost_usd),
    secretsManagerCost: Number(row.secrets_manager_cost_usd),
    otherAwsCost: Number(row.other_aws_cost_usd),
    llmCost: Number(row.llm_cost_usd),
    totalAwsCost: Number(row.total_aws_cost_usd),
    totalCost: Number(row.total_cost_usd),
    calculationMethod: row.calculation_method,
    calculatedAt: row.calculated_at,
  }));
}

/**
 * Get product-level cost analysis
 */
export async function getProductCostAnalysis(): Promise<ProductCostSummary[]> {
  const pool = getPool();
  
  // Query from materialized view
  const query = `
    SELECT 
      repository_id,
      product_name,
      total_cost_usd,
      avg_cost_per_run_usd,
      cost_per_outcome_usd,
      lambda_cost_usd,
      ecs_cost_usd,
      rds_cost_usd,
      llm_cost_usd,
      total_executions,
      successful_outcomes,
      period_start,
      period_end
    FROM mv_product_cost_analysis
    ORDER BY total_cost_usd DESC NULLS LAST
  `;
  
  const result = await pool.query(query);
  
  return result.rows.map(row => ({
    repositoryId: row.repository_id,
    productName: row.product_name,
    totalCost: Number(row.total_cost_usd || 0),
    avgCostPerRun: Number(row.avg_cost_per_run_usd || 0),
    costPerOutcome: row.cost_per_outcome_usd ? Number(row.cost_per_outcome_usd) : null,
    lambdaCost: Number(row.lambda_cost_usd || 0),
    ecsCost: Number(row.ecs_cost_usd || 0),
    rdsCost: Number(row.rds_cost_usd || 0),
    llmCost: Number(row.llm_cost_usd || 0),
    totalExecutions: Number(row.total_executions || 0),
    successfulOutcomes: Number(row.successful_outcomes || 0),
    periodStart: row.period_start,
    periodEnd: row.period_end,
  }));
}

/**
 * Get factory-level cost overview
 */
export async function getFactoryCostOverview(): Promise<FactoryCostOverview> {
  const pool = getPool();
  
  // Query from materialized view
  const query = `
    SELECT 
      cost_per_outcome_usd,
      total_lambda_cost_usd,
      total_ecs_cost_usd,
      total_rds_cost_usd,
      total_s3_cost_usd,
      total_cloudwatch_cost_usd,
      total_llm_cost_usd,
      total_aws_cost_usd,
      total_cost_usd,
      total_executions,
      successful_outcomes,
      failed_executions,
      period_start,
      period_end,
      calculated_at
    FROM mv_cost_per_outcome
  `;
  
  const result = await pool.query(query);
  
  if (result.rows.length === 0) {
    // Return empty overview if no data
    return {
      costPerOutcome: null,
      totalLambdaCost: 0,
      totalEcsCost: 0,
      totalRdsCost: 0,
      totalS3Cost: 0,
      totalCloudwatchCost: 0,
      totalLlmCost: 0,
      totalAwsCost: 0,
      totalCost: 0,
      totalExecutions: 0,
      successfulOutcomes: 0,
      failedExecutions: 0,
      periodStart: new Date().toISOString(),
      periodEnd: new Date().toISOString(),
      calculatedAt: new Date().toISOString(),
    };
  }
  
  const row = result.rows[0];
  return {
    costPerOutcome: row.cost_per_outcome_usd ? Number(row.cost_per_outcome_usd) : null,
    totalLambdaCost: Number(row.total_lambda_cost_usd || 0),
    totalEcsCost: Number(row.total_ecs_cost_usd || 0),
    totalRdsCost: Number(row.total_rds_cost_usd || 0),
    totalS3Cost: Number(row.total_s3_cost_usd || 0),
    totalCloudwatchCost: Number(row.total_cloudwatch_cost_usd || 0),
    totalLlmCost: Number(row.total_llm_cost_usd || 0),
    totalAwsCost: Number(row.total_aws_cost_usd || 0),
    totalCost: Number(row.total_cost_usd || 0),
    totalExecutions: Number(row.total_executions || 0),
    successfulOutcomes: Number(row.successful_outcomes || 0),
    failedExecutions: Number(row.failed_executions || 0),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    calculatedAt: row.calculated_at,
  };
}

/**
 * Get cost data for export (CSV/JSON)
 */
export async function getCostDataForExport(
  startDate?: string,
  endDate?: string
): Promise<CostExportRow[]> {
  const pool = getPool();
  
  let query = `
    SELECT 
      ac.execution_id,
      we.workflow_id,
      r.owner || '/' || r.name as product_name,
      we.status,
      we.started_at,
      we.completed_at,
      EXTRACT(EPOCH FROM (we.completed_at - we.started_at)) / 60.0 as duration_minutes,
      ac.total_cost_usd,
      ac.total_aws_cost_usd,
      ac.llm_cost_usd,
      ac.ecs_cost_usd,
      ac.rds_cost_usd,
      ac.calculation_method
    FROM aws_cost_attribution ac
    JOIN workflow_executions we ON ac.execution_id = we.id
    LEFT JOIN repositories r ON we.repository_id = r.id
    WHERE 1=1
  `;
  
  const params: any[] = [];
  
  if (startDate) {
    params.push(startDate);
    query += ` AND we.started_at >= $${params.length}`;
  }
  
  if (endDate) {
    params.push(endDate);
    query += ` AND we.started_at <= $${params.length}`;
  }
  
  query += ` ORDER BY we.started_at DESC`;
  
  const result = await pool.query(query, params);
  
  return result.rows.map(row => ({
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    productName: row.product_name,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMinutes: row.duration_minutes,
    totalCost: Number(row.total_cost_usd),
    awsCost: Number(row.total_aws_cost_usd),
    llmCost: Number(row.llm_cost_usd),
    ecsCost: Number(row.ecs_cost_usd),
    rdsCost: Number(row.rds_cost_usd),
    calculationMethod: row.calculation_method,
  }));
}

/**
 * Refresh cost materialized views
 */
export async function refreshCostViews(): Promise<void> {
  const pool = getPool();
  await pool.query('SELECT refresh_cost_materialized_views()');
}

/**
 * Get cost allocation rules
 */
export async function getCostAllocationRules(): Promise<CostAllocationRule[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      id,
      rule_name,
      description,
      aws_service,
      allocation_method,
      base_rate_usd,
      shared_pool_allocation,
      config,
      enabled
    FROM cost_allocation_rules
    ORDER BY aws_service, rule_name
  `;
  
  const result = await pool.query(query);
  
  return result.rows.map(row => ({
    id: row.id,
    ruleName: row.rule_name,
    description: row.description,
    awsService: row.aws_service,
    allocationMethod: row.allocation_method,
    baseRateUsd: row.base_rate_usd ? Number(row.base_rate_usd) : null,
    sharedPoolAllocation: row.shared_pool_allocation ? Number(row.shared_pool_allocation) : null,
    config: row.config,
    enabled: row.enabled,
  }));
}

/**
 * Update cost allocation rule
 */
export async function updateCostAllocationRule(
  ruleId: string,
  updates: Partial<Pick<CostAllocationRule, 'baseRateUsd' | 'sharedPoolAllocation' | 'config' | 'enabled'>>
): Promise<void> {
  const pool = getPool();
  
  const setClauses: string[] = [];
  const params: any[] = [];
  
  if (updates.baseRateUsd !== undefined) {
    params.push(updates.baseRateUsd);
    setClauses.push(`base_rate_usd = $${params.length}`);
  }
  
  if (updates.sharedPoolAllocation !== undefined) {
    params.push(updates.sharedPoolAllocation);
    setClauses.push(`shared_pool_allocation = $${params.length}`);
  }
  
  if (updates.config !== undefined) {
    params.push(JSON.stringify(updates.config));
    setClauses.push(`config = $${params.length}::jsonb`);
  }
  
  if (updates.enabled !== undefined) {
    params.push(updates.enabled);
    setClauses.push(`enabled = $${params.length}`);
  }
  
  if (setClauses.length === 0) {
    return;
  }
  
  params.push(ruleId);
  const query = `
    UPDATE cost_allocation_rules
    SET ${setClauses.join(', ')}
    WHERE id = $${params.length}
  `;
  
  await pool.query(query, params);
}

// ========================================
// Export Utilities
// ========================================

/**
 * Convert cost data to CSV format
 */
export function convertCostDataToCSV(data: CostExportRow[]): string {
  const headers = [
    'Execution ID',
    'Workflow ID',
    'Product Name',
    'Status',
    'Started At',
    'Completed At',
    'Duration (minutes)',
    'Total Cost (USD)',
    'AWS Cost (USD)',
    'LLM Cost (USD)',
    'ECS Cost (USD)',
    'RDS Cost (USD)',
    'Calculation Method',
  ];
  
  const rows = data.map(row => [
    row.executionId,
    row.workflowId,
    row.productName || '',
    row.status,
    row.startedAt,
    row.completedAt || '',
    row.durationMinutes?.toFixed(2) || '',
    row.totalCost.toFixed(6),
    row.awsCost.toFixed(6),
    row.llmCost.toFixed(6),
    row.ecsCost.toFixed(6),
    row.rdsCost.toFixed(6),
    row.calculationMethod,
  ]);
  
  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ];
  
  return csvLines.join('\n');
}
