/**
 * API Route: KPI Recompute (E78.1)
 * 
 * POST /api/kpis/recompute - Trigger recomputation of KPIs for a time window
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { computeKpisForWindow } from '@/lib/kpi-service';
import type { ComputeKpisForWindowRequest } from '@/lib/types/kpi';

/**
 * POST /api/kpis/recompute
 * Trigger recomputation of KPIs for a time window (admin-only)
 * 
 * Request body:
 * {
 *   "window": "daily" | "weekly" | "release" | "custom",
 *   "windowStart": "2024-01-01T00:00:00Z",
 *   "windowEnd": "2024-01-02T00:00:00Z",
 *   "kpiNames": ["incident_rate", "mttr", "autofix_rate"], // optional
 *   "forceRecompute": false // optional
 * }
 * 
 * Response:
 * {
 *   "aggregates": [...],
 *   "inputsHash": "sha256...",
 *   "computeVersion": "0.7.0",
 *   "computedAt": "2024-01-01T12:00:00Z",
 *   "windowStart": "2024-01-01T00:00:00Z",
 *   "windowEnd": "2024-01-02T00:00:00Z"
 * }
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const body = await request.json() as ComputeKpisForWindowRequest;
    
    // Validate required fields
    if (!body.window || !body.windowStart || !body.windowEnd) {
      return errorResponse('Missing required fields: window, windowStart, windowEnd', {
        status: 400,
        requestId,
      });
    }
    
    // Validate window type
    const validWindows = ['daily', 'weekly', 'release', 'custom'];
    if (!validWindows.includes(body.window)) {
      return errorResponse(`Invalid window type. Must be one of: ${validWindows.join(', ')}`, {
        status: 400,
        requestId,
      });
    }
    
    // Validate timestamps
    try {
      new Date(body.windowStart);
      new Date(body.windowEnd);
    } catch {
      return errorResponse('Invalid timestamp format. Use ISO 8601 format.', {
        status: 400,
        requestId,
      });
    }
    
    // Compute KPIs for the window
    const result = await computeKpisForWindow(body);
    
    return jsonResponse(result, { 
      requestId,
      status: 200,
    });
  } catch (error) {
    console.error('[API] Error recomputing KPIs:', error);
    
    return errorResponse('Failed to recompute KPIs', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
