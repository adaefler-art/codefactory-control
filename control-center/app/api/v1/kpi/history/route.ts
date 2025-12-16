/**
 * KPI History API Route
 * 
 * GET /api/v1/kpi/history - Get time-series history for a KPI
 * 
 * Returns historized KPI data points for trending
 * EPIC 3: KPI System & Telemetry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getKpiHistory } from '@/lib/kpi-service';
import type { KpiHistoryQueryParams } from '@/lib/types/kpi';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const kpiName = searchParams.get('kpiName');
    
    if (!kpiName) {
      return NextResponse.json(
        { error: 'kpiName query parameter is required' },
        { status: 400 }
      );
    }
    
    const params: KpiHistoryQueryParams = {
      kpiName,
      level: (searchParams.get('level') as any) || 'factory',
      scopeId: searchParams.get('scopeId') || undefined,
      fromDate: searchParams.get('fromDate') || undefined,
      toDate: searchParams.get('toDate') || undefined,
      limit: parseInt(searchParams.get('limit') || '100', 10),
    };
    
    // Validate limit
    if (params.limit && (params.limit < 1 || params.limit > 1000)) {
      return NextResponse.json(
        { error: 'limit must be between 1 and 1000' },
        { status: 400 }
      );
    }
    
    // Get KPI history
    const history = await getKpiHistory(params);
    
    return NextResponse.json({
      status: 'success',
      data: history,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[KPI History API] Error:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to retrieve KPI history',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Only GET is allowed
export async function POST() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}
