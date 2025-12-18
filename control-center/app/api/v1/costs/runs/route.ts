/**
 * Cost Attribution API - Run Level
 * 
 * GET /api/v1/costs/runs
 * 
 * Returns cost data for recent workflow executions.
 * EPIC 9: Cost & Efficiency Engine
 * Issue 9.1: Cost Attribution per Run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecentExecutionCosts, getExecutionCost } from '@/lib/cost-service';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const executionId = searchParams.get('executionId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Single execution cost query
    if (executionId) {
      const cost = await getExecutionCost(executionId);
      
      if (!cost) {
        return NextResponse.json(
          { error: 'Cost data not found for execution' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        api: {
          version: '1.0.0',
          endpoint: '/api/v1/costs/runs',
        },
        timestamp: new Date().toISOString(),
        data: cost,
      });
    }

    // Recent executions costs query
    const costs = await getRecentExecutionCosts(Math.min(limit, 100));

    return NextResponse.json({
      api: {
        version: '1.0.0',
        endpoint: '/api/v1/costs/runs',
      },
      timestamp: new Date().toISOString(),
      data: costs,
      meta: {
        count: costs.length,
        limit,
      },
    });
  } catch (error) {
    console.error('[Cost API - Runs] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cost data' },
      { status: 500 }
    );
  }
}
