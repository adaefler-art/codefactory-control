/**
 * API Route: Feature Flags & Environment Variables Inventory
 * 
 * GET /api/system/flags-env
 * 
 * Returns effective configuration values with source attribution.
 * Detects missing expected flags and provides catalog information.
 * 
 * E7.0.4: Central source of truth for configuration
 * Auth: Requires authentication (x-afu9-sub header from middleware)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getEffectiveConfigReportSanitized } from '@/lib/effective-config';
import { FLAGS_CATALOG } from '@/lib/flags-env-catalog';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // Require authentication - check for user ID from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId) {
    return jsonResponse(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Authentication required to access system configuration',
      },
      { requestId, status: 401 }
    );
  }

  try {
    const report = getEffectiveConfigReportSanitized();

    return jsonResponse(
      {
        ok: true,
        catalog: {
          version: FLAGS_CATALOG.version,
          lastUpdated: FLAGS_CATALOG.lastUpdated,
          totalFlags: FLAGS_CATALOG.flags.length,
        },
        effective: report,
      },
      { requestId, status: 200 }
    );
  } catch (error) {
    console.error('[API] Error resolving effective config:', error);
    
    return jsonResponse(
      {
        ok: false,
        error: 'Failed to resolve effective configuration',
        message: error instanceof Error ? error.message : String(error),
      },
      { requestId, status: 500 }
    );
  }
}
