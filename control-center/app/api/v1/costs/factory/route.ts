/**
 * Cost Attribution API - Factory Level
 * 
 * GET /api/v1/costs/factory
 * 
 * Returns factory-wide cost overview and Cost per Outcome KPI.
 * EPIC 9: Cost & Efficiency Engine
 * Issue 9.1: Cost Attribution per Run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFactoryCostOverview, refreshCostViews } from '@/lib/cost-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const refresh = searchParams.get('refresh') === 'true';

    // Refresh materialized views if requested
    if (refresh) {
      await refreshCostViews();
    }

    const factoryCosts = await getFactoryCostOverview();

    return NextResponse.json({
      api: {
        version: '1.0.0',
        endpoint: '/api/v1/costs/factory',
      },
      timestamp: new Date().toISOString(),
      kpi: {
        costPerOutcome: factoryCosts.costPerOutcome,
        unit: 'usd',
        description: 'Total costs divided by successful outcomes',
      },
      data: factoryCosts,
      meta: {
        period: '24 hours',
      },
    });
  } catch (error) {
    console.error('[Cost API - Factory] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch factory cost data' },
      { status: 500 }
    );
  }
}
