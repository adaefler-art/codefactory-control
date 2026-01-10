/**
 * API Route: Admin Cost Control Settings
 *
 * - GET /api/admin/cost-control/settings?env=staging
 * - PATCH /api/admin/cost-control/settings
 *
 * Admin-only, staging-only writes.
 * Stores desired-state settings and an append-only audit event with deterministic hashes.
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getActiveLawbookVersion } from '@/lib/lawbook-version-helper';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { createCostControlEvidence } from '@/lib/cost-control/evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_SIZE_BYTES = 100 * 1024; // 100KB cap (reuse evidence cap intent)

function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

function isMissingRelationError(error: unknown): boolean {
  const anyErr = error as any;
  return Boolean(anyErr && (anyErr.code === '42P01' || anyErr?.message?.includes('does not exist')));
}

function parseEnvParam(value: string | null | undefined): 'staging' | null {
  if (!value) return null;
  const normalized = String(value).toLowerCase().trim();
  return normalized === 'staging' ? 'staging' : null;
}

async function readBoundedJson(request: NextRequest, requestId: string): Promise<any | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE_BYTES) {
      return null;
    }
  }

  const bodyText = await request.text();
  const bytes = Buffer.byteLength(bodyText, 'utf8');
  if (bytes > MAX_BODY_SIZE_BYTES) {
    return null;
  }

  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  const env = parseEnvParam(request.nextUrl.searchParams.get('env'));
  if (!env) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_ENV',
      details: 'env query param must be staging',
    });
  }

  const pool = getPool();

  try {
    const settingsRes = await pool.query(
      `SELECT key, value_json, updated_at, updated_by
       FROM cost_control_settings
       WHERE env = $1
       ORDER BY key ASC`,
      [env]
    );

    const eventsRes = await pool.query(
      `SELECT request_id, sub, env, action, params_hash, result_hash, lawbook_version, created_at
       FROM cost_control_events
       WHERE env = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [env]
    );

    return jsonResponse(
      {
        ok: true,
        env,
        settings: settingsRes.rows.map(r => ({
          key: r.key,
          value: r.value_json,
          updatedAt: r.updated_at,
          updatedBy: r.updated_by,
        })),
        events: eventsRes.rows.map(r => ({
          requestId: r.request_id,
          sub: r.sub,
          env: r.env,
          action: r.action,
          paramsHash: r.params_hash,
          resultHash: r.result_hash,
          lawbookVersion: r.lawbook_version,
          createdAt: r.created_at,
        })),
      },
      { requestId, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (isMissingRelationError(error)) {
      return jsonResponse(
        {
          ok: true,
          env,
          settings: [],
          events: [],
          diagnostics: {
            tablesMissing: true,
            message: 'cost_control_* tables not found (apply scripts/050_cost_control.sql)',
          },
        },
        { requestId, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    console.error('[API /api/admin/cost-control/settings] Error:', error);
    return errorResponse('Failed to load cost control settings', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);

  // 1) AUTH CHECK (401-first)
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  // 2) BODY PARSE (bounded) + HARD ENV DENY
  // Spec: hard deny any env != staging for PATCH (403)
  const body = await readBoundedJson(request, requestId);
  if (!body || typeof body !== 'object') {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_JSON',
      details: `Request body must be valid JSON and not exceed ${MAX_BODY_SIZE_BYTES} bytes`,
    });
  }

  const env = parseEnvParam((body as any).env);
  const key = typeof (body as any).key === 'string' ? (body as any).key.trim() : '';
  const value = (body as any).value;

  // HARD DENY: only staging
  if (env !== 'staging') {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'ENV_FORBIDDEN',
      details: 'Only env=staging is allowed for cost control writes',
    });
  }

  // 3) ENV GATING (deployment env) - stage-only tool
  const deploymentEnv = getDeploymentEnv();
  if (deploymentEnv === 'production' || deploymentEnv === 'unknown') {
    return errorResponse('Environment access disabled', {
      status: 409,
      requestId,
      code: 'ENV_DISABLED',
      details: `Cost control writes are disabled in ${deploymentEnv} environments. This is a stage-only tool.`,
    });
  }

  // 4) ADMIN CHECK (403)
  if (!isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required',
    });
  }

  if (!key) {
    return errorResponse('Bad Request', {
      status: 400,
      requestId,
      code: 'INVALID_KEY',
      details: 'key is required',
    });
  }

  const pool = getPool();

  // Evidence payloads exclude env (stored separately and redacted by E81.5 rules).
  const params = { key, value };

  try {
    const updatedAt = new Date().toISOString();

    const result = {
      key,
      value,
      updatedAt,
      updatedBy: userId,
    };

    const evidence = createCostControlEvidence({ params, result });
    const lawbookVersion = await getActiveLawbookVersion(pool);

    await pool.query('BEGIN;');
    try {
      await pool.query(
        `INSERT INTO cost_control_settings (env, key, value_json, updated_at, updated_by)
         VALUES ($1, $2, $3::jsonb, NOW(), $4)
         ON CONFLICT (env, key)
         DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [env, key, JSON.stringify(value ?? null), userId]
      );

      await pool.query(
        `INSERT INTO cost_control_events (
           request_id, sub, env, action,
           params_json, params_hash,
           result_json, result_hash,
           lawbook_version, created_at
         ) VALUES (
           $1, $2, $3, $4,
           $5::jsonb, $6,
           $7::jsonb, $8,
           $9, NOW()
         )`,
        [
          requestId,
          userId,
          env,
          'settings_patch',
          JSON.stringify(evidence.paramsJson),
          evidence.paramsHash,
          JSON.stringify(evidence.resultJson),
          evidence.resultHash,
          lawbookVersion,
        ]
      );

      await pool.query('COMMIT;');
    } catch (err) {
      await pool.query('ROLLBACK;');
      throw err;
    }

    return jsonResponse(
      {
        ok: true,
        env,
        key,
        requestId,
        paramsHash: evidence.paramsHash,
        resultHash: evidence.resultHash,
        lawbookVersion,
      },
      { requestId }
    );
  } catch (error) {
    if (isMissingRelationError(error)) {
      return errorResponse('Cost control tables missing', {
        status: 500,
        requestId,
        code: 'TABLES_MISSING',
        details: 'Apply scripts/050_cost_control.sql before using this endpoint',
      });
    }

    console.error('[API /api/admin/cost-control/settings PATCH] Error:', error);
    return errorResponse('Failed to update cost control setting', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
