/**
 * API Route: GET /api/ops/db/repairs
 * 
 * List all available DB repair playbooks
 * 
 * AFU-9 GUARDRAILS (strict ordering for fail-closed security):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ENV GATING (409) - Block prod/unknown environments, no DB calls
 * 3. ADMIN CHECK (403) - Verify admin allowlist, no DB calls
 * 4. READ OPERATIONS - Only executed if all gates pass (no DB writes)
 * 
 * SECURITY:
 * - Stage-only: prod and unknown environments are blocked
 * - Admin-only: requires AFU9_ADMIN_SUBS allowlist
 * - Read-only: no DB modifications
 * 
 * Response:
 * - version: API version
 * - generatedAt: ISO timestamp
 * - repairs: List of available repair playbooks (stable-sorted)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { checkProdWriteGuard } from '@/lib/guards/prod-write-guard';
import { getAllRepairPlaybooks } from '@/lib/db/db-repair-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // GUARD ORDER (verbindlich):
  // 1. AUTH CHECK (401)
  // 2. ENV GATING (409) - stage-only
  // 3. ADMIN CHECK (403)
  const guard = checkProdWriteGuard(request, {
    requireAdmin: true,
    requestId,
  });

  if (guard.errorResponse) {
    return guard.errorResponse;
  }

  // All guards passed - proceed with read operations
  const repairs = getAllRepairPlaybooks();

  // Format response (deterministic, stable-sorted)
  const response = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    requestId,
    repairs: repairs.map(r => ({
      repairId: r.repairId,
      description: r.description,
      hash: r.hash,
      version: r.version,
      stageOnly: r.stageOnly,
      requiresAdmin: r.requiresAdmin,
      requiredTablesAfter: r.requiredTablesAfter || [],
    })),
  };

  return jsonResponse(response, { requestId });
}
