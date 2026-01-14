/**
 * API Route: POST /api/ops/db/repairs/execute
 * 
 * Execute a DB repair playbook (with full audit)
 * 
 * AFU-9 GUARDRAILS (strict ordering for fail-closed security):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ENV GATING (409) - Block prod/unknown environments, no DB calls
 * 3. ADMIN CHECK (403) - Verify admin allowlist, no DB calls
 * 4. DB OPERATIONS - Execute repair and write audit record
 * 
 * SECURITY:
 * - Stage-only: prod and unknown environments are blocked
 * - Admin-only: requires AFU9_ADMIN_SUBS allowlist
 * - Hash verification: expectedHash must match registry hash (fail-closed)
 * - Transactional: Repair SQL executed in transaction where possible
 * - Append-only audit: All executions logged to db_repair_runs
 * 
 * Request body:
 * - repairId: string - Repair playbook ID
 * - expectedHash: string - Expected SHA-256 hash (fail-closed verification)
 * 
 * Response:
 * - repairId: Repair ID
 * - repairRunId: UUID of audit record
 * - requestId: Request ID
 * - status: SUCCESS | FAILED
 * - summary: Execution summary with pre/post missing tables
 */

import { NextRequest } from 'next/server';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { checkProdWriteGuard } from '@/lib/guards/prod-write-guard';
import { getRepairPlaybook, validateRepairHash } from '@/lib/db/db-repair-registry';
import { getPool } from '@/lib/db';
import { getMissingTables } from '@/lib/db/migrations';
import { getActiveLawbook } from '@/lib/db/lawbook';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { insertDbRepairRun } from '@/lib/db/dbRepairRuns';
import { DbRepairRunStatus } from '@/lib/contracts/db-repair';

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

  const { repairId, expectedHash } = body;

  if (!repairId || typeof repairId !== 'string') {
    return errorResponse('MISSING_REPAIR_ID', 'repairId is required', {
      requestId,
      statusCode: 400,
    });
  }

  if (!expectedHash || typeof expectedHash !== 'string') {
    return errorResponse('MISSING_EXPECTED_HASH', 'expectedHash is required', {
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

  // Validate hash (fail-closed)
  if (!validateRepairHash(repairId, expectedHash)) {
    return errorResponse(
      'HASH_MISMATCH',
      `Hash mismatch: expected ${expectedHash}, got ${playbook.hash}`,
      {
        requestId,
        statusCode: 409,
        details: {
          expectedHash,
          actualHash: playbook.hash,
        },
      }
    );
  }

  // DB operations
  const pool = getPool();
  const deploymentEnv = getDeploymentEnv();

  // Get lawbook hash
  const activeLawbook = await getActiveLawbook('AFU9-LAWBOOK', pool);
  const lawbookHash = activeLawbook.success && activeLawbook.data
    ? activeLawbook.data.lawbook_hash
    : null;

  // Check required tables before repair
  const requiredBefore = playbook.requiredTablesBefore || [];
  const preMissingTables = await getMissingTables(pool, requiredBefore);

  let status: DbRepairRunStatus = 'SUCCESS';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  let statementsExecuted = 0;
  let postMissingTables: string[] = [];

  // Execute repair SQL
  // Note: DDL statements (CREATE TABLE, CREATE INDEX, etc.) auto-commit in PostgreSQL
  // and cannot be wrapped in a transaction. This is acceptable because all SQL is
  // idempotent (CREATE IF NOT EXISTS) and can be safely re-run if partially executed.
  try {
    // Execute each statement
    for (const stmt of playbook.sql) {
      await pool.query(stmt);
      statementsExecuted++;
    }

    // Check required tables after repair
    const requiredAfter = playbook.requiredTablesAfter || [];
    postMissingTables = await getMissingTables(pool, requiredAfter);

    if (postMissingTables.length > 0) {
      status = 'FAILED';
      errorCode = 'POST_CHECK_FAILED';
      errorMessage = `Tables still missing after repair: ${postMissingTables.join(', ')}`;
    }
  } catch (error) {
    status = 'FAILED';
    errorCode = 'EXECUTION_ERROR';
    errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check post-repair tables even on error
    try {
      const requiredAfter = playbook.requiredTablesAfter || [];
      postMissingTables = await getMissingTables(pool, requiredAfter);
    } catch (checkError) {
      // Ignore check errors
    }
  }

  // Write audit record (append-only)
  const auditRecord = await insertDbRepairRun(pool, {
    repair_id: repairId,
    expected_hash: expectedHash,
    actual_hash: playbook.hash,
    executed_by: userId,
    deployment_env: deploymentEnv,
    lawbook_hash: lawbookHash,
    request_id: requestId,
    status,
    error_code: errorCode,
    error_message: errorMessage,
    pre_missing_tables: preMissingTables,
    post_missing_tables: postMissingTables,
  });

  const response = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    requestId,
    repairId,
    repairRunId: auditRecord.id,
    status,
    summary: {
      preMissingTables: [...preMissingTables].sort((a, b) => a.localeCompare(b)),
      postMissingTables: [...postMissingTables].sort((a, b) => a.localeCompare(b)),
      statementsExecuted,
      ...(errorCode && { errorCode }),
      ...(errorMessage && { errorMessage }),
    },
  };

  return jsonResponse(response, { requestId, statusCode: status === 'SUCCESS' ? 200 : 500 });
}
