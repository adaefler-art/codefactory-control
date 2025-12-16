/**
 * Factory Status API Types
 * 
 * Type definitions for the Central Factory Status API (Issue 1.2)
 * Provides aggregated view of runs, verdicts, errors, and KPIs
 */

/**
 * API version information
 */
export interface ApiVersion {
  version: string;
  deprecationDate?: string;
}

/**
 * Factory run summary from workflow executions
 */
export interface FactoryRunSummary {
  id: string;
  workflowId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  triggeredBy: string | null;
  error: string | null;
  policySnapshotId: string | null;
  policyVersion: string | null;
}

/**
 * Aggregated error information
 */
export interface ErrorSummary {
  executionId: string;
  workflowId: string | null;
  error: string;
  timestamp: string;
  status: string;
}

/**
 * Factory KPI metrics
 */
export interface FactoryKPIs {
  /** Mean Time to Insight - average time to complete executions */
  meanTimeToInsightMs: number | null;
  
  /** Total number of executions in time period */
  totalExecutions: number;
  
  /** Number of completed executions */
  completedExecutions: number;
  
  /** Number of failed executions */
  failedExecutions: number;
  
  /** Success rate as percentage (0-100) */
  successRate: number;
  
  /** Average execution duration in milliseconds */
  avgExecutionDurationMs: number | null;
  
  /** Currently running executions */
  runningExecutions: number;
}

/**
 * Verdict summary for Factory Status API
 * 
 * EPIC 2: Verdict Engine v1.1 - Governance & Auditability
 */
export interface VerdictSummary {
  id: string;
  executionId: string;
  errorClass: string;
  service: string;
  confidenceScore: number; // Normalized 0-100 scale (Issue 2.2)
  proposedAction: 'WAIT_AND_RETRY' | 'OPEN_ISSUE' | 'HUMAN_REQUIRED';
  fingerprintId: string;
  policyVersion: string; // Policy snapshot version (Issue 2.1)
  createdAt: string;
}

/**
 * Verdict statistics for KPI reporting
 */
export interface VerdictKPIs {
  /** Total number of verdicts */
  totalVerdicts: number;
  
  /** Average confidence score (0-100) */
  avgConfidence: number;
  
  /** Verdict consistency score (0-100) */
  consistencyScore: number;
  
  /** Verdicts by proposed action */
  byAction: {
    waitAndRetry: number;
    openIssue: number;
    humanRequired: number;
  };
  
  /** Top error classes */
  topErrorClasses: Array<{
    errorClass: string;
    count: number;
    avgConfidence: number;
  }>;
}

/**
 * Complete Factory Status response
 */
export interface FactoryStatusResponse {
  /** API version information */
  api: ApiVersion;
  
  /** Timestamp of the status snapshot */
  timestamp: string;
  
  /** Recent workflow execution runs */
  runs: {
    recent: FactoryRunSummary[];
    total: number;
  };
  
  /** Aggregated errors from failed executions */
  errors: {
    recent: ErrorSummary[];
    total: number;
  };
  
  /** Factory-wide KPIs */
  kpis: FactoryKPIs;
  
  /** Verdicts from Verdict Engine v1.1 */
  verdicts: {
    enabled: boolean;
    summary?: VerdictSummary[];
    kpis?: VerdictKPIs;
  };
}

/**
 * Query parameters for Factory Status API
 */
export interface FactoryStatusQueryParams {
  /** Number of recent runs to include (default: 10, max: 100) */
  limit?: number;
  
  /** Number of recent errors to include (default: 10, max: 100) */
  errorLimit?: number;
  
  /** Time period for KPI calculation in hours (default: 24) */
  kpiPeriodHours?: number;
}
