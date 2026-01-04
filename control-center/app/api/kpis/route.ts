/**
 * API Route: KPI Aggregates (E78.1)
 * 
 * GET /api/kpis?window=daily&from=...&to=... - Get KPI aggregates for a time range
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getKpiAggregates } from '@/lib/kpi-service';

/**
 * GET /api/kpis
 * Get KPI aggregates for a time range
 * 
 * Query parameters:
 * - window: Aggregation window (daily, weekly, release, custom)
 * - from: Start timestamp (ISO 8601)
 * - to: End timestamp (ISO 8601)
 * - kpiNames: Comma-separated list of KPI names (e.g., "incident_rate,mttr,autofix_rate")
 * - limit: Maximum number of results (default: 100)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || undefined;
    const fromDate = searchParams.get('from') || undefined;
    const toDate = searchParams.get('to') || undefined;
    const kpiNamesParam = searchParams.get('kpiNames') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    
    // Parse kpiNames if provided
    const kpiNames = kpiNamesParam ? kpiNamesParam.split(',').map(k => k.trim()) : undefined;
    
    const aggregates = await getKpiAggregates({
      window,
      fromDate,
      toDate,
      kpiNames,
      limit,
    });
    
    return jsonResponse({
      aggregates,
      count: aggregates.length,
      filters: {
        window,
        fromDate,
        toDate,
        kpiNames,
        limit,
      },
    }, { requestId });
  } catch (error) {
    console.error('[API] Error fetching KPI aggregates:', error);
    
    return errorResponse('Failed to fetch KPI aggregates', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
