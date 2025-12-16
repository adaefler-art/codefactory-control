/**
 * KPI Freshness API Route
 * 
 * GET /api/v1/kpi/freshness - Get KPI freshness metrics
 * 
 * Returns how current each KPI is (Issue 3.2: KPI Freshness)
 * EPIC 3: KPI System & Telemetry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getKpiFreshness } from '@/lib/kpi-service';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const kpiName = searchParams.get('kpiName') || undefined;
    
    // Get KPI freshness
    const freshness = await getKpiFreshness(kpiName);
    
    // Calculate overall freshness status
    const hasStale = freshness.some(f => f.status === 'stale');
    const hasExpired = freshness.some(f => f.status === 'expired');
    
    let overallStatus: 'fresh' | 'stale' | 'expired' = 'fresh';
    if (hasExpired) {
      overallStatus = 'expired';
    } else if (hasStale) {
      overallStatus = 'stale';
    }
    
    return NextResponse.json({
      status: 'success',
      data: {
        kpis: freshness,
        overall: {
          status: overallStatus,
          freshCount: freshness.filter(f => f.status === 'fresh').length,
          staleCount: freshness.filter(f => f.status === 'stale').length,
          expiredCount: freshness.filter(f => f.status === 'expired').length,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[KPI Freshness API] Error:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to retrieve KPI freshness',
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
