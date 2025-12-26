/**
 * API Route: Prompt & Action KPI Metrics
 * 
 * GET /api/metrics?type=prompt-stability - Get prompt stability metrics
 * GET /api/metrics?type=action-usage - Get action usage metrics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPromptLibraryService } from '../../../src/lib/prompt-library-service';
import { getActionRegistryService } from '../../../src/lib/action-registry-service';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/metrics
 * Get prompt stability or action usage metrics (KPI)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'prompt-stability';
    const category = searchParams.get('category') || undefined;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (type === 'prompt-stability') {
      const promptService = getPromptLibraryService();
      const metrics = await promptService.getPromptStabilityMetrics({ category, limit });

      return jsonResponse({
        type: 'prompt-stability',
        metrics,
        total: metrics.length,
      }, { requestId });
    } else if (type === 'action-usage') {
      const actionService = getActionRegistryService();
      const metrics = await actionService.getActionUsageMetrics({ category, limit });

      return jsonResponse({
        type: 'action-usage',
        metrics,
        total: metrics.length,
      }, { requestId });
    } else {
      return errorResponse('Invalid metric type. Use: prompt-stability or action-usage', {
        status: 400,
        requestId,
      });
    }
  } catch (error) {
    console.error('[API] Error fetching metrics:', error);
    
    return errorResponse('Failed to fetch metrics', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
