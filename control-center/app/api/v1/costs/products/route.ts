/**
 * Cost Attribution API - Product Level
 * 
 * GET /api/v1/costs/products
 * 
 * Returns aggregated cost data per product/repository.
 * EPIC 9: Cost & Efficiency Engine
 * Issue 9.1: Cost Attribution per Run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProductCostAnalysis, refreshCostViews } from '@/lib/cost-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const refresh = searchParams.get('refresh') === 'true';

    // Refresh materialized views if requested
    if (refresh) {
      await refreshCostViews();
    }

    const productCosts = await getProductCostAnalysis();

    return NextResponse.json({
      api: {
        version: '1.0.0',
        endpoint: '/api/v1/costs/products',
      },
      timestamp: new Date().toISOString(),
      data: productCosts,
      meta: {
        count: productCosts.length,
        period: '7 days',
      },
    });
  } catch (error) {
    console.error('[Cost API - Products] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product cost data' },
      { status: 500 }
    );
  }
}
