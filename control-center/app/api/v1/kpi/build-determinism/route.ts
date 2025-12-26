/**
 * Build Determinism KPI API
 * 
 * GET /api/v1/kpi/build-determinism
 * Returns current Build Determinism metrics and KPI
 * 
 * EPIC 5: Autonomous Build-Test-Deploy Loop
 * Issue 5.1: Deterministic Build Graphs
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  calculateBuildDeterminismKPI, 
  getBuildDeterminismMetrics 
} from '@/lib/kpi-service';
import { withApi } from '@/lib/http/withApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  // Get current metrics
  const metrics = await getBuildDeterminismMetrics();
  
  // Calculate and persist KPI
  let kpiSnapshot = null;
  try {
    kpiSnapshot = await calculateBuildDeterminismKPI();
  } catch (kpiError) {
    console.warn('[Build Determinism API] Failed to calculate KPI snapshot:', kpiError);
  }
  
  return NextResponse.json({
    data: {
      metrics,
      kpi: kpiSnapshot ? {
        value: kpiSnapshot.value,
        unit: kpiSnapshot.unit,
        calculatedAt: kpiSnapshot.calculatedAt,
        metadata: kpiSnapshot.metadata,
      } : null,
    },
    timestamp: new Date().toISOString(),
  });
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to retrieve Build Determinism metrics',
    details: error instanceof Error ? error.message : String(error),
  }),
});
