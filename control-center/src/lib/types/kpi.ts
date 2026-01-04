/**
 * KPI System Types
 * 
 * Type definitions for the AFU-9 KPI system and telemetry platform
 * EPIC 3: KPI System & Telemetry
 */

/**
 * KPI Aggregation Level
 */
export type KpiLevel = 'factory' | 'product' | 'run';

/**
 * KPI Snapshot - Time-series storage for historized KPI values
 */
export interface KpiSnapshot {
  id: string;
  kpiName: string;
  kpiVersion: string;
  level: KpiLevel;
  scopeId: string | null; // NULL for factory, repository_id for product, execution_id for run
  value: number;
  unit: string;
  metadata?: Record<string, any>;
  calculatedAt: string; // ISO 8601
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  createdAt: string; // ISO 8601
}

/**
 * Verdict Outcome - Tracks outcomes for steering accuracy
 */
export type VerdictOutcome = 'accepted' | 'overridden' | 'escalated' | 'unknown';

export interface VerdictOutcomeRecord {
  id: string;
  verdictId: string;
  executionId: string;
  outcome: VerdictOutcome;
  outcomeReason?: string;
  decidedBy: string; // 'system', 'human:{user_id}', 'timeout'
  decidedAt: string; // ISO 8601
  metadata?: Record<string, any>;
  createdAt: string; // ISO 8601
}

/**
 * KPI Aggregation Job
 */
export type KpiJobType = 'full' | 'incremental' | 'on_demand';
export type KpiJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface KpiAggregationJob {
  id: string;
  jobType: KpiJobType;
  status: KpiJobStatus;
  kpiNames: string[];
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  startedAt?: string; // ISO 8601
  completedAt?: string; // ISO 8601
  durationMs?: number;
  snapshotsCreated: number;
  error?: string;
  metadata?: Record<string, any>;
  createdAt: string; // ISO 8601
}

/**
 * Steering Accuracy Metrics
 */
export interface SteeringAccuracyMetrics {
  steeringAccuracyPct: number; // 0-100
  totalDecisions: number;
  acceptedDecisions: number;
  overriddenDecisions: number;
  escalatedDecisions: number;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
}

/**
 * KPI Freshness Metrics
 */
export interface KpiFreshnessMetrics {
  kpiName: string;
  freshnessSeconds: number;
  lastCalculatedAt: string; // ISO 8601
  isFresh: boolean; // < 60 seconds
  status: 'fresh' | 'stale' | 'expired';
}

/**
 * Factory-Level KPIs (expanded from existing FactoryKPIs)
 */
export interface ExtendedFactoryKPIs {
  // Existing KPIs
  meanTimeToInsightMs: number | null;
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  successRate: number; // 0-100
  avgExecutionDurationMs: number | null;
  runningExecutions: number;
  
  // New EPIC 3 KPIs
  steeringAccuracy?: SteeringAccuracyMetrics;
  kpiFreshness?: KpiFreshnessMetrics[];
  
  // Metadata
  calculatedAt: string; // ISO 8601
  periodHours: number;
  kpiVersion: string; // e.g., "1.0.0"
}

/**
 * Product-Level KPIs
 */
export interface ProductKPIs {
  repositoryId: string;
  productName: string; // owner/name
  successRatePct: number; // 0-100
  dailyThroughput: number; // runs per day
  totalExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  avgDurationMs: number | null;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  calculatedAt: string; // ISO 8601
}

/**
 * Run-Level KPIs
 */
export interface RunKPIs {
  executionId: string;
  runDurationMs: number;
  tokenUsage: number;
  toolCallCount: number;
  toolCallSuccessRate: number; // 0-100
  errorCount: number;
  status: 'completed' | 'failed';
}

/**
 * KPI History Query Parameters
 */
export interface KpiHistoryQueryParams {
  kpiName: string;
  level?: KpiLevel;
  scopeId?: string;
  fromDate?: string; // ISO 8601
  toDate?: string; // ISO 8601
  granularity?: 'minute' | 'hour' | 'day' | 'week';
  limit?: number;
}

/**
 * KPI History Response
 */
export interface KpiHistoryResponse {
  kpiName: string;
  level: KpiLevel;
  scopeId: string | null;
  unit: string;
  dataPoints: KpiDataPoint[];
  summary: {
    min: number;
    max: number;
    avg: number;
    latest: number;
  };
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
}

export interface KpiDataPoint {
  timestamp: string; // ISO 8601
  value: number;
  metadata?: Record<string, any>;
}

/**
 * KPI Snapshot Request
 */
export interface CreateKpiSnapshotRequest {
  kpiName: string;
  level: KpiLevel;
  scopeId?: string;
  value: number;
  unit: string;
  metadata?: Record<string, any>;
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
}

/**
 * KPI Aggregation Request
 */
export interface KpiAggregationRequest {
  jobType: KpiJobType;
  kpiNames: string[];
  periodStart: string; // ISO 8601
  periodEnd: string; // ISO 8601
  forceRefresh?: boolean;
}

/**
 * KPI Target Configuration
 */
export interface KpiTarget {
  kpiName: string;
  target: number;
  warning: number;
  critical: number;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
}

/**
 * KPI Definition (from docs/KPI_DEFINITIONS.md)
 */
export interface KpiDefinition {
  name: string;
  version: string;
  category: 'efficiency' | 'reliability' | 'quality' | 'observability' | 'availability' | 'performance' | 'cost';
  level: KpiLevel[];
  unit: string;
  target?: number;
  formula: string;
  description: string;
  rationale: string;
  implementedIn?: string;
}

/**
 * All canonical KPIs
 */
export const CANONICAL_KPIS: Record<string, KpiDefinition> = {
  mtti: {
    name: 'Mean Time to Insight',
    version: '1.0.0',
    category: 'efficiency',
    level: ['factory', 'product', 'run'],
    unit: 'milliseconds',
    target: 300000,
    formula: 'AVG(completion_time - start_time)',
    description: 'Average time from workflow start to terminal state',
    rationale: 'Measures how quickly factory provides actionable insight',
  },
  success_rate: {
    name: 'Success Rate',
    version: '1.0.0',
    category: 'reliability',
    level: ['factory', 'product'],
    unit: 'percentage',
    target: 85,
    formula: '(completed / (completed + failed)) × 100',
    description: 'Percentage of successful workflow executions',
    rationale: 'Indicates factory reliability and stability',
  },
  steering_accuracy: {
    name: 'Steering Accuracy',
    version: '1.0.0',
    category: 'quality',
    level: ['factory'],
    unit: 'percentage',
    target: 90,
    formula: '(accepted_decisions / total_decisions) × 100',
    description: 'How well factory decisions align with expected outcomes',
    rationale: 'Validates autonomous decision-making is trustworthy',
    implementedIn: 'Issue 3.1',
  },
  kpi_freshness: {
    name: 'KPI Freshness',
    version: '1.0.0',
    category: 'observability',
    level: ['factory'],
    unit: 'seconds',
    target: 60,
    formula: 'NOW() - last_kpi_calculation_timestamp',
    description: 'How current the displayed KPI data is',
    rationale: 'Fresh KPIs enable timely decision-making',
    implementedIn: 'Issue 3.2',
  },
  verdict_consistency: {
    name: 'Verdict Consistency',
    version: '1.0.0',
    category: 'quality',
    level: ['factory'],
    unit: 'percentage',
    target: 95,
    formula: '(consistent_fingerprint_groups / total_fingerprint_groups) × 100',
    description: 'Percentage of error fingerprints with consistent verdicts',
    rationale: 'Indicates deterministic and reliable verdict generation',
  },
  factory_uptime: {
    name: 'Factory Uptime',
    version: '1.0.0',
    category: 'availability',
    level: ['factory'],
    unit: 'percentage',
    target: 99.5,
    formula: '(healthy_intervals / total_intervals) × 100',
    description: 'Percentage of time when factory services are operational',
    rationale: 'Directly impacts factory availability',
  },
  mttr: {
    name: 'Mean Time to Recovery',
    version: '1.0.0',
    category: 'reliability',
    level: ['factory'],
    unit: 'seconds',
    target: 600,
    formula: 'AVG(recovery_time - incident_start_time)',
    description: 'Average time to recover from incidents',
    rationale: 'Measures operational resilience',
  },
  execution_duration: {
    name: 'Execution Duration',
    version: '1.0.0',
    category: 'performance',
    level: ['run', 'product'],
    unit: 'milliseconds',
    formula: 'completed_at - started_at',
    description: 'Time from execution start to completion',
    rationale: 'Helps identify performance bottlenecks',
  },
};

/**
 * KPI Freshness Status
 */
export function calculateKpiFreshnessStatus(freshnessSeconds: number): {
  isFresh: boolean;
  status: 'fresh' | 'stale' | 'expired';
} {
  if (freshnessSeconds < 60) {
    return { isFresh: true, status: 'fresh' };
  } else if (freshnessSeconds < 300) {
    return { isFresh: false, status: 'stale' };
  } else {
    return { isFresh: false, status: 'expired' };
  }
}

/**
 * E78.1: KPI Measurements & Aggregates
 * Deterministic KPI computation layer
 */

/**
 * Entity types for KPI measurements
 */
export type KpiEntityType = 'issue' | 'deploy' | 'incident' | 'remediation' | 'release';

/**
 * KPI Measurement - Atomic measurement or event-derived fact
 */
export interface KpiMeasurement {
  id: string;
  kpiName: string;
  entityType: KpiEntityType;
  entityId: string;
  occurredAt: string; // ISO 8601
  valueNum: number | null;
  unit: string;
  sourceRefs: Record<string, any>; // Pointers to source records
  createdAt: string; // ISO 8601
}

/**
 * Aggregation window type
 */
export type AggregationWindow = 'daily' | 'weekly' | 'release' | 'custom';

/**
 * KPI Aggregate - Windowed aggregate with versioning
 */
export interface KpiAggregate {
  id: string;
  window: AggregationWindow;
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
  kpiName: string;
  valueNum: number | null;
  unit: string;
  computeVersion: string;
  inputsHash: string; // SHA-256 of canonical input refs
  metadata?: Record<string, any>;
  createdAt: string; // ISO 8601
}

/**
 * Velocity KPIs (E78.1)
 */

/**
 * D2D - Decision to Deploy (hours)
 * Decision = Issue state enters SPEC_READY
 * Deploy = deploy event timestamp for that issue/PR
 */
export interface D2DMetrics {
  d2dHours: number;
  decisionAt: string; // ISO 8601
  deployAt: string; // ISO 8601
  issueId: string;
  deployId: string;
}

/**
 * HSH - Human Steering Hours
 * If explicit tracking exists, use it; otherwise null
 */
export interface HSHMetrics {
  hshHours: number | null;
  issueId: string;
  trackingMethod?: string; // e.g., 'manual', 'estimated', 'tracked'
}

/**
 * DCU - Delivered Capability Units
 * Parsed from issue labels/body deterministically
 */
export interface DCUMetrics {
  dcuScore: number | null;
  issueId: string;
  parsingMethod?: string; // e.g., 'label', 'body', 'default'
}

/**
 * AVS - Autonomy Velocity Score (DCU/HSH ratio)
 * Only computed when both DCU and HSH are present
 */
export interface AVSMetrics {
  avsRatio: number | null;
  dcuScore: number;
  hshHours: number;
  issueId: string;
}

/**
 * Ops KPIs (E78.1)
 */

/**
 * Incident Rate - Incidents per time window
 */
export interface IncidentRateMetrics {
  incidentsPerDay: number;
  totalIncidents: number;
  windowDays: number;
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
}

/**
 * MTTR - Mean Time To Resolve
 * Mean time from incident OPEN to CLOSED
 */
export interface MTTRMetrics {
  mttrHours: number;
  incidentCount: number;
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
}

/**
 * Auto-fix Rate - Proportion of incidents auto-fixed
 * SUCCEEDED remediation runs / total remediation runs
 * Note: Assumes SUCCEEDED = auto-fix (no human intervention flag yet)
 */
export interface AutoFixRateMetrics {
  autofixRatePct: number; // 0-100
  autofixCount: number; // SUCCEEDED runs
  totalRuns: number;
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
  caveat?: string; // e.g., "Assumes SUCCEEDED runs are auto-fixed without human intervention"
}

/**
 * Compute KPIs request for a time window
 */
export interface ComputeKpisForWindowRequest {
  window: AggregationWindow;
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
  kpiNames?: string[]; // Optional: compute specific KPIs only
  forceRecompute?: boolean; // Optional: recompute even if exists
}

/**
 * Compute KPIs response
 */
export interface ComputeKpisForWindowResponse {
  aggregates: KpiAggregate[];
  inputsHash: string;
  computeVersion: string;
  computedAt: string; // ISO 8601
  windowStart: string; // ISO 8601
  windowEnd: string; // ISO 8601
}
