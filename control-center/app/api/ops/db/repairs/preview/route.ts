/**
 * API Route: POST /api/ops/db/repairs/preview
 * 
 * Preview a DB repair without executing it (no DB writes)
 * 
 * AFU-9 GUARDRAILS (strict ordering for fail-closed security):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ENV GATING (409) - Block prod/unknown environments, no DB calls
 * 3. ADMIN CHECK (403) - Verify admin allowlist, no DB calls
 * 4. DB OPERATIONS - Read-only checks (no writes)
 * 
 * SECURITY:
 * - Stage-only: prod and unknown environments are blocked
 * - Admin-only: requires AFU9_ADMIN_SUBS allowlist
 * - No DB writes: only reads for validation
 * 
 * Request body:
 * - repairId: string - Repair playbook ID
 * 
 * Response:
 * - repairId: Repair ID
 * - description: Human-readable description
 * - hash: SHA-256 hash of canonical SQL
 * - requiredTablesCheck: Pre-execution table validation
 * - wouldApply: Whether repair would execute
 * - plan: SQL statements (may be truncated for large repairs)
 * - requestId: Request ID
 * - deploymentEnv: Deployment environment
 * - lawbookHash: Current lawbook hash
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { checkProdWriteGuard } from '@/lib/guards/prod-write-guard';
import { getRepairPlaybook } from '@/lib/db/db-repair-registry';
import { getPool } from '@/lib/db';
import { getMissingTables } from '@/lib/db/migrations';
import { getActiveLawbook } from '@/lib/db/lawbook';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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

  const userId = guard.userId!;

  // Parse request body
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return errorResponse('INVALID_JSON', 'Request body must be valid JSON', {
      requestId,
      statusCode: 400,
    });
  }

  const { repairId } = body;

  if (!repairId || typeof repairId !== 'string') {
    return errorResponse('MISSING_REPAIR_ID', 'repairId is required', {
      requestId,
      statusCode: 400,
    });
  }

  // Get repair playbook
  const playbook = getRepairPlaybook(repairId);
  if (!playbook) {
    return errorResponse('REPAIR_NOT_FOUND', `Repair playbook not found: ${repairId}`, {
      requestId,
      statusCode: 404,
    });
  }

  // DB operations (read-only)
  const pool = getPool();
  const deploymentEnv = getDeploymentEnv();

  // Get lawbook hash
  const activeLawbook = await getActiveLawbook('AFU9-LAWBOOK', pool);
  const lawbookHash = activeLawbook.success && activeLawbook.data
    ? activeLawbook.data.lawbook_hash
    : null;

  // Check required tables before repair
  const requiredBefore = playbook.requiredTablesBefore || [];
  const missingBefore = await getMissingTables(pool, requiredBefore);

  const requiredTablesCheck = {
    required: [...requiredBefore].sort((a, b) => a.localeCompare(b)),
    missing: [...missingBefore].sort((a, b) => a.localeCompare(b)),
    allPresent: missingBefore.length === 0,
  };

  // Would apply if no required tables are missing
  const wouldApply = requiredTablesCheck.allPresent;

  // Build plan (may truncate for large repairs)
  const plan = playbook.sql.map((stmt, idx) => {
    const truncated = stmt.length > 500 ? stmt.substring(0, 500) + '...' : stmt;
    return truncated;
  });

  const response = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    requestId,
    repairId: playbook.repairId,
    description: playbook.description,
    hash: playbook.hash,
    requiredTablesCheck,
    wouldApply,
    plan,
    deploymentEnv,
    lawbookHash,
  };

  return jsonResponse(response, { requestId });
}
