/**
 * API Route: Ops Dashboard (E78.4 / I784)
 * 
 * GET /api/ops/dashboard?window=weekly&from=...&to=...
 * 
 * Returns aggregated ops metrics for dashboard display:
 * - KPI trends (incident_rate, mttr, autofix_rate)
 * - Top failure categories
 * - Playbook effectiveness metrics
 * - Recent incidents
 * 
 * All data is deterministically ordered.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getPool } from '@/lib/db';

interface DashboardKpi {
  kpi_name: string;
  points: Array<{
    t: string;
    value: number | null;
  }>;
}

interface TopCategory {
  category: string;
  count: number;
  share: number;
}

interface PlaybookMetrics {
  playbookId: string;
  runs: number;
  successRate: number;
  medianTimeToVerify: number | null;
  medianTimeToMitigate: number | null;
}

interface RecentIncident {
  id: string;
  severity: string;
  category: string | null;
  lastSeenAt: string;
  status: string;
}

interface DashboardResponse {
  kpis: DashboardKpi[];
  topCategories: TopCategory[];
  playbooks: PlaybookMetrics[];
  recentIncidents: RecentIncident[];
  filters: {
    window: string;
    from: string | null;
    to: string | null;
  };
}

/**
 * GET /api/ops/dashboard
 * 
 * Query parameters:
 * - window: Aggregation window (daily, weekly) - default: weekly
 * - from: Start timestamp (ISO 8601) - optional
 * - to: End timestamp (ISO 8601) - optional
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || 'weekly';
    const fromDate = searchParams.get('from') || null;
    const toDate = searchParams.get('to') || null;
    
    // Validate window parameter
    if (!['daily', 'weekly'].includes(window)) {
      return errorResponse('Invalid window parameter', {
        status: 400,
        requestId,
        details: 'window must be "daily" or "weekly"',
      });
    }
    
    const pool = getPool();
    
    // 1. Fetch KPI trends from kpi_aggregates
    const kpiQuery = `
      SELECT 
        kpi_name,
        window_start AS t,
        value_num AS value
      FROM kpi_aggregates
      WHERE window = $1
        AND kpi_name IN ('incident_rate', 'mttr', 'autofix_rate')
        AND ($2::TIMESTAMPTZ IS NULL OR window_start >= $2)
        AND ($3::TIMESTAMPTZ IS NULL OR window_end <= $3)
      ORDER BY kpi_name ASC, window_start DESC
      LIMIT 100
    `;
    
    const kpiResult = await pool.query(kpiQuery, [window, fromDate, toDate]);
    
    // Group KPI points by name (deterministic ordering)
    const kpiMap = new Map<string, Array<{ t: string; value: number | null }>>();
    for (const row of kpiResult.rows) {
      if (!kpiMap.has(row.kpi_name)) {
        kpiMap.set(row.kpi_name, []);
      }
      kpiMap.get(row.kpi_name)!.push({
        t: row.t.toISOString(),
        value: row.value !== null ? parseFloat(row.value) : null,
      });
    }
    
    // Convert to array with deterministic ordering (sorted by kpi_name)
    const kpis: DashboardKpi[] = Array.from(kpiMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kpi_name, points]) => ({ kpi_name, points }));
    
    // 2. Fetch top failure categories from incidents
    const categoryQuery = `
      SELECT 
        COALESCE(classification->>'category', 'UNKNOWN') AS category,
        COUNT(*) AS count
      FROM incidents
      WHERE ($1::TIMESTAMPTZ IS NULL OR last_seen_at >= $1)
        AND ($2::TIMESTAMPTZ IS NULL OR last_seen_at <= $2)
      GROUP BY category
      ORDER BY count DESC, category ASC
      LIMIT 10
    `;
    
    const categoryResult = await pool.query(categoryQuery, [fromDate, toDate]);
    
    const totalIncidents = categoryResult.rows.reduce((sum, row) => sum + parseInt(row.count, 10), 0);
    const topCategories: TopCategory[] = categoryResult.rows.map(row => ({
      category: row.category,
      count: parseInt(row.count, 10),
      share: totalIncidents > 0 ? parseFloat(((parseInt(row.count, 10) / totalIncidents) * 100).toFixed(2)) : 0,
    }));
    
    // 3. Fetch playbook effectiveness from remediation_runs
    const playbookQuery = `
      SELECT 
        playbook_id,
        COUNT(*) AS runs,
        COUNT(*) FILTER (WHERE status = 'SUCCEEDED') AS succeeded,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY 
          CASE 
            WHEN status IN ('SUCCEEDED', 'FAILED') AND updated_at > created_at
            THEN EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0
            ELSE NULL
          END
        ) AS median_time_minutes
      FROM remediation_runs
      WHERE ($1::TIMESTAMPTZ IS NULL OR created_at >= $1)
        AND ($2::TIMESTAMPTZ IS NULL OR created_at <= $2)
      GROUP BY playbook_id
      ORDER BY runs DESC, playbook_id ASC
      LIMIT 10
    `;
    
    const playbookResult = await pool.query(playbookQuery, [fromDate, toDate]);
    
    const playbooks: PlaybookMetrics[] = playbookResult.rows.map(row => {
      const runs = parseInt(row.runs, 10);
      const succeeded = parseInt(row.succeeded, 10);
      const successRate = runs > 0 ? parseFloat(((succeeded / runs) * 100).toFixed(2)) : 0;
      const medianTimeMinutes = row.median_time_minutes !== null ? parseFloat(row.median_time_minutes) : null;
      
      return {
        playbookId: row.playbook_id,
        runs,
        successRate,
        medianTimeToVerify: null, // Future: link to verification data
        medianTimeToMitigate: medianTimeMinutes,
      };
    });
    
    // 4. Fetch recent incidents
    const incidentsQuery = `
      SELECT 
        id,
        severity,
        COALESCE(classification->>'category', 'UNKNOWN') AS category,
        last_seen_at,
        status
      FROM incidents
      ORDER BY last_seen_at DESC, id ASC
      LIMIT 20
    `;
    
    const incidentsResult = await pool.query(incidentsQuery);
    
    const recentIncidents: RecentIncident[] = incidentsResult.rows.map(row => ({
      id: row.id,
      severity: row.severity,
      category: row.category,
      lastSeenAt: row.last_seen_at.toISOString(),
      status: row.status,
    }));
    
    const response: DashboardResponse = {
      kpis,
      topCategories,
      playbooks,
      recentIncidents,
      filters: {
        window,
        from: fromDate,
        to: toDate,
      },
    };
    
    return jsonResponse(response, { requestId });
  } catch (error) {
    console.error('[API] Error fetching ops dashboard data:', error);
    
    return errorResponse('Failed to fetch ops dashboard data', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
