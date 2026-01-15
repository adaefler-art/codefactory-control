/**
 * Weekly Report Service (E88.3)
 * 
 * Service for generating automated weekly evidence reports
 * Deterministic, reproducible, and lawbook-compliant
 */

import { getPool } from './db';
import { createHash } from 'crypto';
import type {
  WeeklyReportData,
  WeeklyReportRequest,
  WeeklyReportResponse,
  WeeklyKpiSummary,
  ReleaseSummary,
  IncidentSummary,
  TouchpointSummary,
  LawbookChangeSummary,
} from './types/weekly-report';

const REPORT_VERSION = '1.0.0';
const HOURS_PER_TOUCHPOINT = 0.25; // 15 minutes average per manual intervention

/**
 * Calculate SHA-256 hash of canonical inputs for determinism
 */
function calculateInputsHash(inputs: Record<string, any>): string {
  const canonical = JSON.stringify(inputs, Object.keys(inputs).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Get default time period (last 7 days)
 */
function getDefaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

/**
 * Format period as human-readable description
 */
function formatPeriodDescription(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];
  return `Week of ${startStr} to ${endStr}`;
}

/**
 * Fetch releases in time period
 */
async function fetchReleases(
  periodStart: string,
  periodEnd: string,
  environment?: string
): Promise<ReleaseSummary[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      env,
      service,
      version,
      commit_hash,
      created_at,
      status
    FROM deploy_events
    WHERE created_at >= $1
      AND created_at <= $2
      AND status = 'success'
      AND ($3::TEXT IS NULL OR env = $3)
    ORDER BY created_at DESC
  `;
  
  const result = await pool.query(query, [periodStart, periodEnd, environment || null]);
  
  return result.rows.map(row => ({
    environment: row.env,
    service: row.service,
    version: row.version,
    commitHash: row.commit_hash,
    deployedAt: row.created_at.toISOString(),
    status: row.status,
  }));
}

/**
 * Calculate D2D (Decision → Deploy) KPI
 */
async function calculateD2D(
  periodStart: string,
  periodEnd: string
): Promise<number | null> {
  const pool = getPool();
  
  try {
    // Get D2D measurements from kpi_measurements table
    const query = `
      SELECT AVG(value_num) as avg_d2d
      FROM kpi_measurements
      WHERE kpi_name = 'd2d'
        AND occurred_at >= $1
        AND occurred_at <= $2
        AND value_num IS NOT NULL
    `;
    
    const result = await pool.query(query, [periodStart, periodEnd]);
    
    if (result.rows.length > 0 && result.rows[0].avg_d2d) {
      return parseFloat(result.rows[0].avg_d2d);
    }
    
    return null;
  } catch (error) {
    console.error('[Weekly Report] Error calculating D2D:', error);
    return null;
  }
}

/**
 * Calculate HSH (Human Steering Hours) from manual touchpoints
 */
async function calculateHSH(
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const pool = getPool();
  
  const query = `
    SELECT COUNT(*) as touchpoint_count
    FROM manual_touchpoints
    WHERE created_at >= $1
      AND created_at <= $2
  `;
  
  const result = await pool.query(query, [periodStart, periodEnd]);
  const count = parseInt(result.rows[0].touchpoint_count, 10);
  
  return count * HOURS_PER_TOUCHPOINT;
}

/**
 * Calculate DCU (Delivered Capability Units) - successful deploys
 */
async function calculateDCU(
  periodStart: string,
  periodEnd: string,
  environment?: string
): Promise<number> {
  const pool = getPool();
  
  const query = `
    SELECT COUNT(*) as deploy_count
    FROM deploy_events
    WHERE created_at >= $1
      AND created_at <= $2
      AND status = 'success'
      AND ($3::TEXT IS NULL OR env = $3)
  `;
  
  const result = await pool.query(query, [periodStart, periodEnd, environment || null]);
  return parseInt(result.rows[0].deploy_count, 10);
}

/**
 * Calculate Automation Coverage %
 */
async function calculateAutomationCoverage(
  automatedSteps: number,
  manualTouchpoints: number
): Promise<number> {
  const totalSteps = automatedSteps + manualTouchpoints;
  if (totalSteps === 0) {
    return 100; // 100% if no touchpoints yet (fully automated)
  }
  return parseFloat(((automatedSteps / totalSteps) * 100).toFixed(2));
}

/**
 * Fetch top incidents in period
 */
async function fetchTopIncidents(
  periodStart: string,
  periodEnd: string,
  limit: number = 10
): Promise<IncidentSummary[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      incident_key,
      severity,
      status,
      title,
      created_at,
      resolved_at
    FROM incidents
    WHERE created_at >= $1
      AND created_at <= $2
    ORDER BY 
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      created_at DESC
    LIMIT $3
  `;
  
  const result = await pool.query(query, [periodStart, periodEnd, limit]);
  
  return result.rows.map(row => ({
    incidentKey: row.incident_key,
    severity: row.severity,
    status: row.status,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  }));
}

/**
 * Fetch manual touchpoint summary
 */
async function fetchTouchpointSummary(
  periodStart: string,
  periodEnd: string
): Promise<TouchpointSummary> {
  const pool = getPool();
  
  const query = `
    SELECT 
      type,
      COUNT(*) as count
    FROM manual_touchpoints
    WHERE created_at >= $1
      AND created_at <= $2
    GROUP BY type
    ORDER BY count DESC
  `;
  
  const result = await pool.query(query, [periodStart, periodEnd]);
  
  const totalCount = result.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);
  
  const byType = result.rows.map(row => {
    const count = parseInt(row.count, 10);
    return {
      type: row.type,
      count,
      percentage: totalCount > 0 ? parseFloat(((count / totalCount) * 100).toFixed(2)) : 0,
    };
  });
  
  return {
    totalCount,
    byType,
  };
}

/**
 * Fetch lawbook/guardrails changes
 */
async function fetchLawbookChanges(
  periodStart: string,
  periodEnd: string
): Promise<LawbookChangeSummary[]> {
  const pool = getPool();
  
  const query = `
    SELECT 
      le.lawbook_id,
      le.event_type,
      lv.lawbook_version,
      le.created_at,
      LAG(lv.lawbook_version) OVER (
        PARTITION BY le.lawbook_id 
        ORDER BY le.created_at
      ) as previous_version
    FROM lawbook_events le
    LEFT JOIN lawbook_versions lv ON le.lawbook_version_id = lv.id
    WHERE le.created_at >= $1
      AND le.created_at <= $2
      AND le.event_type IN ('version_created', 'version_activated')
    ORDER BY le.created_at DESC
  `;
  
  try {
    const result = await pool.query(query, [periodStart, periodEnd]);
    
    return result.rows.map(row => ({
      lawbookId: row.lawbook_id,
      previousVersion: row.previous_version || null,
      currentVersion: row.lawbook_version,
      changedAt: row.created_at.toISOString(),
      changeType: row.event_type === 'version_created' ? 'created' : 'activated',
    }));
  } catch (error) {
    // Table might not exist yet
    console.warn('[Weekly Report] Lawbook tables not available:', error);
    return [];
  }
}

/**
 * Get active lawbook hash and version
 */
async function getActiveLawbook(): Promise<{ hash: string | null; version: string | null }> {
  const pool = getPool();
  
  const query = `
    SELECT 
      lv.lawbook_hash,
      lv.lawbook_version
    FROM lawbook_active la
    JOIN lawbook_versions lv ON la.active_lawbook_version_id = lv.id
    WHERE la.lawbook_id = 'AFU9-LAWBOOK'
    LIMIT 1
  `;
  
  try {
    const result = await pool.query(query);
    
    if (result.rows.length > 0) {
      return {
        hash: result.rows[0].lawbook_hash,
        version: result.rows[0].lawbook_version,
      };
    }
    
    return { hash: null, version: null };
  } catch (error) {
    // Table might not exist yet
    console.warn('[Weekly Report] Lawbook tables not available:', error);
    return { hash: null, version: null };
  }
}

/**
 * Generate weekly report data
 */
export async function generateWeeklyReport(
  request: WeeklyReportRequest = {}
): Promise<WeeklyReportResponse> {
  const period = request.periodStart && request.periodEnd
    ? { start: request.periodStart, end: request.periodEnd }
    : getDefaultPeriod();
  
  const { start: periodStart, end: periodEnd } = period;
  const format = request.format || 'json';
  
  // Fetch all data in parallel where possible
  const [
    releases,
    topIncidents,
    touchpointSummary,
    lawbookChanges,
    activeLawbook,
    d2d,
    hsh,
    dcu,
  ] = await Promise.all([
    fetchReleases(periodStart, periodEnd, request.environment),
    fetchTopIncidents(periodStart, periodEnd, request.includeAllIncidents ? 1000 : 10),
    fetchTouchpointSummary(periodStart, periodEnd),
    fetchLawbookChanges(periodStart, periodEnd),
    getActiveLawbook(),
    calculateD2D(periodStart, periodEnd),
    calculateHSH(periodStart, periodEnd),
    calculateDCU(periodStart, periodEnd, request.environment),
  ]);
  
  // Calculate automation coverage
  const automationCoverage = await calculateAutomationCoverage(dcu, touchpointSummary.totalCount);
  
  // Build KPI summary
  const kpis: WeeklyKpiSummary = {
    d2d: {
      averageHours: d2d,
      unit: 'hours',
      description: 'Decision → Deploy: Time from issue assignment to deploy',
    },
    hsh: {
      totalHours: hsh,
      unit: 'hours',
      description: 'Human Steering Hours: Manual intervention time',
    },
    dcu: {
      count: dcu,
      unit: 'deploys',
      description: 'Delivered Capability Units: Deployed features/fixes',
    },
    automationCoverage: {
      percentage: automationCoverage,
      unit: '%',
      description: 'Automation Coverage: automated_steps / (automated_steps + manual_touchpoints)',
    },
  };
  
  // Build report data
  const reportData: WeeklyReportData = {
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    period: {
      start: periodStart,
      end: periodEnd,
      description: formatPeriodDescription(periodStart, periodEnd),
    },
    releases,
    kpis,
    topIncidents,
    manualTouchpoints: touchpointSummary,
    lawbookChanges,
    lawbookHash: activeLawbook.hash,
    lawbookVersion: activeLawbook.version,
  };
  
  // Calculate inputs hash for reproducibility
  const inputsHash = calculateInputsHash({
    periodStart,
    periodEnd,
    environment: request.environment || null,
    includeAllIncidents: request.includeAllIncidents || false,
  });
  
  return {
    report: reportData,
    format,
    inputsHash,
  };
}

/**
 * Convert report to Markdown format
 */
export function reportToMarkdown(report: WeeklyReportData): string {
  const lines: string[] = [];
  
  // Header
  lines.push('# Weekly Evidence Report');
  lines.push('');
  lines.push(`**Generated:** ${report.generatedAt}`);
  lines.push(`**Period:** ${report.period.description}`);
  lines.push(`**Report Version:** ${report.reportVersion}`);
  if (report.lawbookVersion) {
    lines.push(`**Lawbook Version:** ${report.lawbookVersion}`);
  }
  if (report.lawbookHash) {
    lines.push(`**Lawbook Hash:** \`${report.lawbookHash.substring(0, 16)}...\``);
  }
  lines.push('');
  
  // KPIs Section
  lines.push('## Key Performance Indicators');
  lines.push('');
  
  lines.push('### D2D (Decision → Deploy)');
  if (report.kpis.d2d.averageHours !== null) {
    lines.push(`- **Average:** ${report.kpis.d2d.averageHours.toFixed(2)} ${report.kpis.d2d.unit}`);
  } else {
    lines.push('- **Average:** N/A (no data)');
  }
  lines.push(`- ${report.kpis.d2d.description}`);
  lines.push('');
  
  lines.push('### HSH (Human Steering Hours)');
  lines.push(`- **Total:** ${report.kpis.hsh.totalHours.toFixed(2)} ${report.kpis.hsh.unit}`);
  lines.push(`- ${report.kpis.hsh.description}`);
  lines.push('');
  
  lines.push('### DCU (Delivered Capability Units)');
  lines.push(`- **Count:** ${report.kpis.dcu.count} ${report.kpis.dcu.unit}`);
  lines.push(`- ${report.kpis.dcu.description}`);
  lines.push('');
  
  lines.push('### Automation Coverage');
  lines.push(`- **Percentage:** ${report.kpis.automationCoverage.percentage}${report.kpis.automationCoverage.unit}`);
  lines.push(`- ${report.kpis.automationCoverage.description}`);
  lines.push('');
  
  // Releases Section
  lines.push('## Releases');
  lines.push('');
  if (report.releases.length > 0) {
    lines.push(`**Total:** ${report.releases.length}`);
    lines.push('');
    lines.push('| Environment | Service | Version | Deployed At |');
    lines.push('|-------------|---------|---------|-------------|');
    report.releases.forEach(rel => {
      const deployedDate = new Date(rel.deployedAt).toISOString().split('T')[0];
      lines.push(`| ${rel.environment} | ${rel.service} | ${rel.version} | ${deployedDate} |`);
    });
  } else {
    lines.push('*No releases in this period*');
  }
  lines.push('');
  
  // Top Incidents Section
  lines.push('## Top Incidents');
  lines.push('');
  if (report.topIncidents.length > 0) {
    lines.push(`**Total:** ${report.topIncidents.length}`);
    lines.push('');
    report.topIncidents.forEach((incident, idx) => {
      lines.push(`### ${idx + 1}. ${incident.title}`);
      lines.push(`- **Key:** ${incident.incidentKey}`);
      lines.push(`- **Severity:** ${incident.severity}`);
      lines.push(`- **Status:** ${incident.status}`);
      lines.push(`- **Created:** ${new Date(incident.createdAt).toISOString().split('T')[0]}`);
      if (incident.resolvedAt) {
        lines.push(`- **Resolved:** ${new Date(incident.resolvedAt).toISOString().split('T')[0]}`);
      }
      lines.push('');
    });
  } else {
    lines.push('*No incidents in this period*');
    lines.push('');
  }
  
  // Manual Touchpoints Section
  lines.push('## Manual Touchpoints');
  lines.push('');
  lines.push(`**Total Count:** ${report.manualTouchpoints.totalCount}`);
  lines.push('');
  if (report.manualTouchpoints.byType.length > 0) {
    lines.push('### Breakdown by Type');
    lines.push('');
    lines.push('| Type | Count | Percentage |');
    lines.push('|------|-------|------------|');
    report.manualTouchpoints.byType.forEach(tp => {
      lines.push(`| ${tp.type} | ${tp.count} | ${tp.percentage}% |`);
    });
  }
  lines.push('');
  
  // Lawbook/Guardrails Changes Section
  lines.push('## Lawbook & Guardrails Changes');
  lines.push('');
  if (report.lawbookChanges.length > 0) {
    lines.push(`**Total Changes:** ${report.lawbookChanges.length}`);
    lines.push('');
    report.lawbookChanges.forEach((change, idx) => {
      lines.push(`### ${idx + 1}. ${change.lawbookId}`);
      lines.push(`- **Change Type:** ${change.changeType}`);
      if (change.previousVersion) {
        lines.push(`- **Previous Version:** ${change.previousVersion}`);
      }
      lines.push(`- **Current Version:** ${change.currentVersion}`);
      lines.push(`- **Changed At:** ${new Date(change.changedAt).toISOString().split('T')[0]}`);
      lines.push('');
    });
  } else {
    lines.push('*No lawbook changes in this period*');
    lines.push('');
  }
  
  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*This report is generated automatically for audit and evidence purposes.*');
  
  return lines.join('\n');
}
