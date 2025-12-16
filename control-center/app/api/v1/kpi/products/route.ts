/**
 * KPI Product Metrics API Route
 * 
 * GET /api/v1/kpi/products - Get product-level KPIs
 * 
 * Returns KPIs aggregated by product/repository
 * EPIC 3: KPI System & Telemetry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProductKPIs } from '@/lib/kpi-service';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const repositoryId = searchParams.get('repositoryId') || undefined;
    const periodDays = parseInt(searchParams.get('periodDays') || '7', 10);
    
    // Validate parameters
    if (periodDays < 1 || periodDays > 90) {
      return NextResponse.json(
        { error: 'periodDays must be between 1 and 90' },
        { status: 400 }
      );
    }
    
    // Get product KPIs
    const products = await getProductKPIs(repositoryId, periodDays);
    
    return NextResponse.json({
      status: 'success',
      data: {
        products,
        count: products.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[KPI Products API] Error:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to retrieve product KPIs',
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
