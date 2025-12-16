/**
 * KPI Extended Factory Metrics API Route
 * 
 * GET /api/v1/kpi/factory - Get extended factory-level KPIs
 * 
 * Returns factory KPIs with steering accuracy and KPI freshness
 * EPIC 3: KPI System & Telemetry
 */

import { NextRequest, NextResponse } from 'next/server';
import { getExtendedFactoryKPIs } from '@/lib/kpi-service';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const periodHours = parseInt(searchParams.get('periodHours') || '24', 10);
    
    // Validate parameters
    if (periodHours < 1 || periodHours > 168) {
      return NextResponse.json(
        { error: 'periodHours must be between 1 and 168 (1 week)' },
        { status: 400 }
      );
    }
    
    // Get extended factory KPIs
    const kpis = await getExtendedFactoryKPIs(periodHours);
    
    return NextResponse.json({
      status: 'success',
      data: kpis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[KPI Factory API] Error:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        error: 'Failed to retrieve factory KPIs',
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

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}
