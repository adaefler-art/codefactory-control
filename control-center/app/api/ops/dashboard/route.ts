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
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getPool } from '@/lib/db';
import { z } from 'zod';

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
 * - window: Aggregation window (daily, weekly) - default: daily
 * - from: Start timestamp (ISO 8601) - optional
 * - to: End timestamp (ISO 8601) - optional
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // Authentication: fail-closed, require x-afu9-sub BEFORE any DB calls
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    const { searchParams } = new URL(request.url);
    const windowParam = searchParams.get('window') || 'daily';
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    
    // Validate query parameters with Zod
    const querySchema = z.object({
      window: z.enum(['daily', 'weekly']),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    });
    
    const validationResult = querySchema.safeParse({
      window: windowParam,
      from: fromParam || undefined,
      to: toParam || undefined,
    });
    
    if (!validationResult.success) {
      return errorResponse('Invalid query parameters', {
        status: 400,
        requestId,
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
      });
    }
    
    const { window, from, to } = validationResult.data;
    const fromDate = from || null;
    const toDate = to || null;
    
    // Validate date range: start <= end and max 90 days
    if (fromDate && toDate) {
      const startTime = new Date(fromDate).getTime();
      const endTime = new Date(toDate).getTime();
      
      if (startTime > endTime) {
        return errorResponse('Invalid date range', {
          status: 400,
          requestId,
          details: 'Start date must be before or equal to end date',
        });
      }
      
      const maxRangeMs = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds
      if (endTime - startTime > maxRangeMs) {
        return errorResponse('Date range too large', {
          status: 400,
          requestId,
          details: 'Date range must not exceed 90 days',
        });
      }
    }
    
    const pool = getPool();
    
    // 1. Fetch KPI trends from kpi_aggregates
    const kpiQuery = `
      SELECT 
        kpi_name,
        window_start AS t,
        value_num AS value
      FROM kpi_aggregates
      WHERE window_type = $1
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
    
    const totalIncidents = categoryResult.rows.reduce((sum, row) => sum + Number(row.count), 0);
    const topCategories: TopCategory[] = categoryResult.rows.map(row => ({
      category: row.category,
      count: Number(row.count),
      share: totalIncidents > 0 ? parseFloat(((Number(row.count) / totalIncidents) * 100).toFixed(2)) : 0,
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
      const runs = Number(row.runs);
      const succeeded = Number(row.succeeded);
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
      LIMIT 50
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
