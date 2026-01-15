/**
 * Weekly Report Types (E88.3)
 * 
 * Type definitions for automated weekly evidence reports
 * Suitable for reviews, audits, stakeholder updates, and lawbook-compliant archiving
 */

/**
 * Report format type
 */
export type ReportFormat = 'json' | 'markdown';

/**
 * KPI Summary for Weekly Report
 */
export interface WeeklyKpiSummary {
  d2d: {
    averageHours: number | null;
    unit: string;
    description: string;
  };
  hsh: {
    totalHours: number;
    unit: string;
    description: string;
  };
  dcu: {
    count: number;
    unit: string;
    description: string;
  };
  automationCoverage: {
    percentage: number;
    unit: string;
    description: string;
  };
}

/**
 * Release Summary
 */
export interface ReleaseSummary {
  environment: string;
  service: string;
  version: string;
  commitHash: string;
  deployedAt: string;
  status: string;
}

/**
 * Incident Summary
 */
export interface IncidentSummary {
  incidentKey: string;
  severity: string;
  status: string;
  title: string;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Manual Touchpoint Summary
 */
export interface TouchpointSummary {
  totalCount: number;
  byType: {
    type: string;
    count: number;
    percentage: number;
  }[];
}

/**
 * Lawbook/Guardrails Change Summary
 */
export interface LawbookChangeSummary {
  lawbookId: string;
  previousVersion: string | null;
  currentVersion: string;
  changedAt: string;
  changeType: 'created' | 'activated' | 'deactivated';
}

/**
 * Weekly Report Data Structure
 */
export interface WeeklyReportData {
  // Report metadata
  reportVersion: string; // Schema version for deterministic structure
  generatedAt: string; // ISO 8601 timestamp
  
  // Time period
  period: {
    start: string; // ISO 8601
    end: string; // ISO 8601
    description: string; // Human-readable (e.g., "Week of 2026-01-08")
  };
  
  // Releases in period
  releases: ReleaseSummary[];
  
  // KPIs
  kpis: WeeklyKpiSummary;
  
  // Top incidents (sorted by severity/impact)
  topIncidents: IncidentSummary[];
  
  // Manual touchpoints analysis
  manualTouchpoints: TouchpointSummary;
  
  // Lawbook/Guardrails changes
  lawbookChanges: LawbookChangeSummary[];
  
  // Lawbook hash for traceability
  lawbookHash: string | null;
  lawbookVersion: string | null;
}

/**
 * Weekly Report Request Parameters
 */
export interface WeeklyReportRequest {
  // Time period (defaults to last 7 days)
  periodStart?: string; // ISO 8601
  periodEnd?: string; // ISO 8601
  
  // Format preference
  format?: ReportFormat;
  
  // Optional filters
  environment?: string; // Filter releases by environment
  includeAllIncidents?: boolean; // Include all incidents, not just top N
}

/**
 * Weekly Report Response
 */
export interface WeeklyReportResponse {
  report: WeeklyReportData;
  format: ReportFormat;
  
  // For determinism verification
  inputsHash: string; // SHA-256 hash of inputs (period, filters)
}
