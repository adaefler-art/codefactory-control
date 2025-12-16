/**
 * API Route: Factory Status
 * 
 * GET /api/v1/factory/status
 * 
 * Central Factory Status API providing aggregated view of:
 * - Workflow execution runs
 * - Errors from failed executions
 * - Factory-wide KPIs (including Mean Time to Insight)
 * - Verdicts (placeholder for future Verdict Engine)
 * 
 * This is a read-only API implementing Issue 1.2 from AFU-9 Roadmap v0.3
 * 
 * Query Parameters:
 * - limit: Number of recent runs (default: 10, max: 100)
 * - errorLimit: Number of recent errors (default: 10, max: 100)
 * - kpiPeriodHours: Hours for KPI calculation (default: 24)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFactoryStatus } from '../../../../../src/lib/factory-status';

/**
 * GET handler - Retrieve factory status
 * 
 * @param request - Next.js request object
 * @returns JSON response with factory status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters with validation
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const errorLimit = parseInt(searchParams.get('errorLimit') || '10', 10);
    const kpiPeriodHours = parseInt(searchParams.get('kpiPeriodHours') || '24', 10);

    // Validate parameters
    if (limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'limit must be between 1 and 100' },
        { status: 400 }
      );
    }

    if (errorLimit < 1 || errorLimit > 100) {
      return NextResponse.json(
        { error: 'errorLimit must be between 1 and 100' },
        { status: 400 }
      );
    }

    if (kpiPeriodHours < 1 || kpiPeriodHours > 168) { // Max 1 week
      return NextResponse.json(
        { error: 'kpiPeriodHours must be between 1 and 168' },
        { status: 400 }
      );
    }

    console.log('[Factory Status API] Fetching status', {
      limit,
      errorLimit,
      kpiPeriodHours,
    });

    // Get factory status
    const status = await getFactoryStatus({
      limit,
      errorLimit,
      kpiPeriodHours,
    });

    return NextResponse.json(status, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[Factory Status API] Error:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to retrieve factory status',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST, PUT, DELETE handlers - Not allowed (read-only API)
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Method not allowed. This is a read-only API.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { error: 'Method not allowed. This is a read-only API.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { error: 'Method not allowed. This is a read-only API.' },
    { status: 405 }
  );
}

export async function PATCH() {
  return NextResponse.json(
    { error: 'Method not allowed. This is a read-only API.' },
    { status: 405 }
  );
}
