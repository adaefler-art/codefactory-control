/**
 * KPI Aggregation Trigger API
 * POST /api/v1/kpi/aggregate
 * 
 * Triggers on-demand KPI aggregation pipeline execution
 * EPIC 3: KPI System & Telemetry
 * Issue 3.2: KPI Aggregation Pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeKpiAggregationPipeline } from '@/lib/kpi-service';
import { withApi, apiError } from '@/lib/http/withApi';

export const POST = withApi(async (request: NextRequest) => {
  // Parse request body for optional parameters
  let periodHours = 24;
  
  try {
    const body = await request.json();
    if (body.periodHours && typeof body.periodHours === 'number') {
      periodHours = body.periodHours;
    }
  } catch {
    // Body is optional, use defaults
  }
  
  console.log(`[KPI API] Triggering aggregation pipeline (periodHours: ${periodHours})`);
  
  // Execute the aggregation pipeline
  const job = await executeKpiAggregationPipeline(periodHours);
  
  return NextResponse.json({
    job,
    message: 'KPI aggregation pipeline triggered successfully',
  });
}, {
  mapError: (error, requestId) => ({
    error: error instanceof Error ? error.message : 'Unknown error',
    details: 'Failed to trigger KPI aggregation pipeline',
  }),
});

// Return method not allowed for other HTTP methods
export async function GET() {
  return apiError('Method not allowed', 405, 'Use POST to trigger aggregation');
}
