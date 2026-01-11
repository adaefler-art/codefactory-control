/**
 * API Route: GET /api/ops/db/migrations
 * 
 * Migration Parity Check - Deterministic comparison of DB ledger vs. repo migrations
 * 
 * AFU-9 GUARDRAILS (strict ordering for fail-closed security):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ENV GATING (409) - Block prod/unknown environments, no DB calls
 * 3. ADMIN CHECK (403) - Verify admin allowlist, no DB calls
 * 4. DB OPERATIONS - Only executed if all gates pass
 * 
 * SECURITY:
 * - x-afu9-sub header is set by proxy.ts after server-side JWT verification
 * - Client-provided x-afu9-* headers are stripped by middleware to prevent spoofing
 * - Admin allowlist from AFU9_ADMIN_SUBS env var (fail-closed if missing/empty)
 * - Stage-only: prod and unknown environments are blocked before any DB access
 * 
 * Query parameters:
 * - env?: string - Optional environment filter (production|staging)
 * - limit?: number - Bounded results (default: 200, max: 500)
 * 
 * Response:
 * - version: API version
 * - generatedAt: ISO timestamp
 * - lawbookVersion: Current lawbook version
 * - db: Database reachability info
 * - repo: Repository migration count and latest
 * - ledger: DB ledger info (table, count, lastApplied)
 * - parity: Parity status and discrepancies
 * 
 * Error codes:
 * - 401 UNAUTHORIZED - Missing or empty x-afu9-sub
 * - 409 ENV_DISABLED - Production or unknown environment (stage-only tool)
 * - 403 FORBIDDEN - Not admin or admin allowlist missing
 * - 500 MIGRATION_LEDGER_MISSING - Ledger table doesn't exist
 * - 500 DB_UNREACHABLE - Cannot connect to database
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  checkDbReachability,
  AFU9_MIGRATIONS_LEDGER_TABLE,
  checkAfu9LedgerExists,
  validateAfu9LedgerShape,
  listAppliedAfu9Migrations,
  getLastAppliedAfu9Migration,
  getAppliedAfu9MigrationCount,
  checkLedgerExists,
  listAppliedMigrations,
  getLastAppliedMigration,
  getAppliedMigrationCount,
  getMissingTables,
} from '@/lib/db/migrations';
import {
  listRepoMigrations,
  computeParity,
  getLatestMigration,
} from '@/lib/utils/migration-parity';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { getActiveLawbookVersion } from '@/lib/lawbook-version-helper';
import { getActiveLawbook } from '@/lib/db/lawbook';
import { getDeploymentEnv } from '@/lib/utils/deployment-env';
import { getDbIdentity } from '@/lib/db/db-identity';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MigrationParityWarningSource = 'dbAppliedMigrations' | 'repoMigrationFiles';
type MigrationParityLedgerSource = 'afu9_migrations_ledger' | 'schema_migrations' | 'none';
type MigrationParityWarning =
  | {
      code: 'NON_STRING_MIGRATION_ENTRY';
      count: number;
      source: MigrationParityWarningSource;
    }
  | {
      code: 'LEDGER_COUNT_MISMATCH';
      source: 'ledgers';
      afu9AppliedCount: number;
      schemaMigrationsCount: number;
    }
  | {
      code: 'LEDGER_CONTENT_MISMATCH';
      source: 'ledgers';
      afu9AppliedCount: number;
      schemaMigrationsCount: number;
      diffCount: number;
    };

function sanitizeStringArray(
  values: unknown[],
  source: MigrationParityWarningSource,
  warnings: MigrationParityWarning[]
): string[] {
  const out: string[] = [];
  let filtered = 0;

  for (const value of values) {
    if (typeof value === 'string') {
      out.push(value);
      continue;
    }
    if (value === null || value === undefined) {
      filtered++;
      continue;
    }
    filtered++;
  }

  if (filtered > 0) {
    warnings.push({
      code: 'NON_STRING_MIGRATION_ENTRY',
      count: filtered,
      source,
    });
  }

  return out;
}

function sortWarningsDeterministically(warnings: MigrationParityWarning[]): MigrationParityWarning[] {
  return warnings
    .slice()
    .sort((a, b) =>
      a.source.localeCompare(b.source) ||
      a.code.localeCompare(b.code) ||
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    );
}

// NOTE: We intentionally do not depend on legacy schema_migrations shape.

/**
 * Check if user sub is in admin allowlist
 * Fail-closed: empty/missing AFU9_ADMIN_SUBS → deny all
 */
function isAdminUser(userId: string): boolean {
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) {
    // Fail-closed: no admin allowlist configured → deny all
    return false;
  }
  
  const allowedSubs = adminSubs.split(',').map(s => s.trim()).filter(s => s);
  return allowedSubs.includes(userId);
}

/**
 * GET /api/ops/db/migrations
 * 
 * Returns deterministic parity report between database ledger and repo migrations
 * 
 * AFU-9 GUARDRAILS (strict ordering):
 * 1. AUTH CHECK (401-first) - no DB calls
 * 2. ENV GATING (prod/unknown → disabled) - no DB calls
 * 3. ADMIN CHECK (403) - no DB calls
 * 4. DB operations (only if all gates pass)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  // 1. AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  // This must happen BEFORE env gating to maintain auth-first principle
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Authentication required - no verified user context',
    });
  }

  const authVia = (request.headers.get('x-afu9-auth-via') || '').trim();

  // 2. ENV GATING: Stage-only endpoint (fail-closed for prod/unknown)
  // Blocks prod and unknown environments before any DB operations
  // Development environment is allowed for local dev
  const deploymentEnv = getDeploymentEnv();
  if (deploymentEnv === 'production' || deploymentEnv === 'unknown') {
    const envLabel = deploymentEnv === 'production' ? 'production' : 'unknown/unconfigured';
    return errorResponse('Environment access disabled', {
      status: 409,
      requestId,
      code: 'ENV_DISABLED',
      details: `Migration parity checks are disabled in ${envLabel} environments. This is a stage-only tool.`,
    });
  }

  // 3. AUTHORIZATION CHECK: Admin-only (fail-closed)
  // Note: middleware can assert smoke-auth (staging-only) and set x-afu9-auth-via=smoke.
  if (authVia !== 'smoke' && !isAdminUser(userId)) {
    return errorResponse('Forbidden', {
      status: 403,
      requestId,
      code: 'FORBIDDEN',
      details: 'Admin privileges required to access migration parity checks',
    });
  }

  // Log diagnostic info (no secrets)
  console.log(`[API /api/ops/db/migrations] RequestId: ${requestId}, Environment: ${deploymentEnv}, User: ${userId}`);

  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    const warnings: MigrationParityWarning[] = [];

    // Parse query parameters with bounds
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10), 1), 500);
    const env = searchParams.get('env') || undefined;

    // Check DB reachability
    const dbInfo = await checkDbReachability(pool);
    if (!dbInfo.reachable) {
      return errorResponse('Database unreachable', {
        status: 500,
        requestId,
        code: 'DB_UNREACHABLE',
        details: dbInfo.error || 'Cannot connect to database',
      });
    }

    const dbIdentity = await getDbIdentity(pool);

    // Check if canonical AFU-9 ledger exists
    const ledgerExists = await checkAfu9LedgerExists(pool);
    if (!ledgerExists) {
      return jsonResponse(
        {
          error: 'Migrations required',
          code: 'MIGRATION_REQUIRED',
          details: `${AFU9_MIGRATIONS_LEDGER_TABLE} table does not exist. Run migrations to create the canonical AFU-9 ledger.`,
          requestId,
          timestamp: new Date().toISOString(),
          diagnostics: {
            expectedTable: AFU9_MIGRATIONS_LEDGER_TABLE,
          },
        },
        { status: 503, requestId }
      );
    }

    const shape = await validateAfu9LedgerShape(pool);
    if (!shape.ok) {
      return jsonResponse(
        {
          error: 'Migrations required',
          code: 'MIGRATION_REQUIRED',
          details: `${AFU9_MIGRATIONS_LEDGER_TABLE} exists but has an unexpected schema. Run migrations to repair the ledger.`,
          requestId,
          timestamp: new Date().toISOString(),
          diagnostics: {
            expectedTable: AFU9_MIGRATIONS_LEDGER_TABLE,
            detectedColumns: shape.detectedColumns,
            missingColumns: shape.missingColumns,
          },
        },
        { status: 503, requestId }
      );
    }

    // Get repo migrations (from database/migrations/ directory)
    const migrationsDir = path.join(process.cwd(), '..', 'database', 'migrations');
    const repoMigrations = listRepoMigrations(migrationsDir);
    const latestRepoMigration = getLatestMigration(repoMigrations);

    // Filter before sorting to avoid runtime crashes when migration entries are malformed.
    const repoMigrationFilesRaw = repoMigrations.map((m: any) => m?.filename);
    const repoMigrationFiles = sanitizeStringArray(repoMigrationFilesRaw, 'repoMigrationFiles', warnings)
      .slice()
      .sort((a, b) => a.localeCompare(b));

    // Get DB migrations from canonical AFU-9 ledger
    const afu9DbMigrations = await listAppliedAfu9Migrations(pool, limit);
    const afu9LastApplied = await getLastAppliedAfu9Migration(pool);
    const afu9AppliedCount = await getAppliedAfu9MigrationCount(pool);

    const schemaMigrationsExists = await checkLedgerExists(pool);
    const schemaDbMigrations = schemaMigrationsExists ? await listAppliedMigrations(pool, limit) : [];
    const schemaLastApplied = schemaMigrationsExists ? await getLastAppliedMigration(pool) : null;
    const schemaMigrationsCount = schemaMigrationsExists ? await getAppliedMigrationCount(pool) : 0;

    const afu9AppliedFilenames = sanitizeStringArray(
      afu9DbMigrations.map((m: any) => m?.filename),
      'dbAppliedMigrations',
      warnings
    )
      .slice()
      .sort((a, b) => a.localeCompare(b));

    const schemaAppliedFilenames = sanitizeStringArray(
      schemaDbMigrations.map((m: any) => m?.filename),
      'dbAppliedMigrations',
      warnings
    )
      .slice()
      .sort((a, b) => a.localeCompare(b));

    // Deterministic source selection (counts are authoritative)
    let ledgerSource: MigrationParityLedgerSource = 'none';
    if (afu9AppliedCount > 0) ledgerSource = 'afu9_migrations_ledger';
    else if (schemaMigrationsCount > 0) ledgerSource = 'schema_migrations';

    // Emit warnings when both tables exist but diverge (counts and/or content)
    if (schemaMigrationsExists) {
      if (afu9AppliedCount !== schemaMigrationsCount) {
        warnings.push({
          code: 'LEDGER_COUNT_MISMATCH',
          source: 'ledgers',
          afu9AppliedCount,
          schemaMigrationsCount,
        });
      } else {
        // Only compare content when we have full sets within the requested limit to avoid false positives.
        const canCompareContent = afu9AppliedCount <= limit && schemaMigrationsCount <= limit;
        if (canCompareContent) {
          let diffCount = 0;
          const a = afu9AppliedFilenames;
          const b = schemaAppliedFilenames;
          if (a.length !== b.length) {
            diffCount = Math.abs(a.length - b.length);
          } else {
            for (let i = 0; i < a.length; i++) {
              if (a[i] !== b[i]) diffCount++;
            }
          }

          if (diffCount > 0) {
            warnings.push({
              code: 'LEDGER_CONTENT_MISMATCH',
              source: 'ledgers',
              afu9AppliedCount,
              schemaMigrationsCount,
              diffCount,
            });
          }
        }
      }
    }

    const selectedDbMigrations =
      ledgerSource === 'afu9_migrations_ledger'
        ? afu9DbMigrations
        : ledgerSource === 'schema_migrations'
          ? schemaDbMigrations
          : [];

    const selectedAppliedFilenames =
      ledgerSource === 'afu9_migrations_ledger'
        ? afu9AppliedFilenames
        : ledgerSource === 'schema_migrations'
          ? schemaAppliedFilenames
          : [];

    const selectedAppliedCount =
      ledgerSource === 'afu9_migrations_ledger'
        ? afu9AppliedCount
        : ledgerSource === 'schema_migrations'
          ? schemaMigrationsCount
          : 0;

    const selectedLastApplied =
      ledgerSource === 'afu9_migrations_ledger'
        ? afu9LastApplied
        : ledgerSource === 'schema_migrations'
          ? schemaLastApplied
          : null;

    // Required tables check (stage migration sanity)
    const requiredTables = [
      'intent_issue_drafts',
      'intent_issue_sets',
    ];
    const missingTables = await getMissingTables(pool, requiredTables);

    // Compute parity (defensive: filter malformed entries before passing to parity computation)
    const safeRepoMigrations = repoMigrations.filter((m: any) => !!m && typeof m.filename === 'string');
    const safeDbMigrations = selectedDbMigrations.filter((m: any) => !!m && typeof m.filename === 'string');
    const parity = computeParity(safeRepoMigrations, safeDbMigrations);
    const deterministicParity = {
      status: parity.status,
      missingInDb: [...parity.missingInDb].sort((a, b) => a.localeCompare(b)),
      extraInDb: [...parity.extraInDb].sort((a, b) => a.localeCompare(b)),
      hashMismatches: [...parity.hashMismatches].sort((a, b) => a.filename.localeCompare(b.filename)),
    };

    const parityStatus =
      deterministicParity.missingInDb.length === 0 &&
      deterministicParity.extraInDb.length === 0 &&
      deterministicParity.hashMismatches.length === 0 &&
      missingTables.length === 0
        ? 'PASS'
        : 'FAIL';

    const sortedWarnings = sortWarningsDeterministically(warnings);

    // Get lawbook version + hash (if available)
    const activeLawbook = await getActiveLawbook('AFU9-LAWBOOK', pool);
    const lawbookVersion = activeLawbook.success && activeLawbook.data
      ? activeLawbook.data.lawbook_version
      : await getActiveLawbookVersion(pool);
    const lawbookHash = activeLawbook.success && activeLawbook.data
      ? activeLawbook.data.lawbook_hash
      : null;

    // Build response (stable key order)
    const response = {
      version: '0.7.0',
      generatedAt: new Date().toISOString(),
      requestId,
      warnings: sortedWarnings,
      ledgerSource,
      deploymentEnv,
      lawbookVersion,
      lawbookHash,
      db: {
        reachable: dbInfo.reachable,
        host: dbInfo.host,
        port: dbInfo.port,
        database: dbInfo.database,
      },
      dbIdentity,
      repo: {
        migrationCount: repoMigrations.length,
        latest: latestRepoMigration,
      },
      ledger: {
        table: ledgerSource === 'none' ? AFU9_MIGRATIONS_LEDGER_TABLE : ledgerSource,
        appliedCount: selectedAppliedCount,
        lastApplied: selectedLastApplied?.filename || null,
        lastAppliedAt:
          selectedLastApplied && selectedLastApplied.applied_at && selectedLastApplied.applied_at.getTime() !== 0
            ? selectedLastApplied.applied_at.toISOString()
            : null,
      },
      parity: {
        status: parityStatus,
        missingInDb: deterministicParity.missingInDb.slice(0, limit), // Bounded
        extraInDb: deterministicParity.extraInDb.slice(0, limit), // Bounded
        hashMismatches: deterministicParity.hashMismatches.slice(0, limit), // Bounded
      },
      requiredTablesCheck: {
        requiredTables: requiredTables.slice().sort((a, b) => a.localeCompare(b)),
        missingTables,
      },
      repoMigrationFiles,
      dbAppliedMigrations: selectedAppliedFilenames,
      missingInDb: deterministicParity.missingInDb.slice(0, limit),
      extraInDb: deterministicParity.extraInDb.slice(0, limit),
    };

    return jsonResponse(response, { requestId });
  } catch (error) {
    console.error('[API /api/ops/db/migrations] Error:', error);
    return errorResponse('Failed to generate migration parity report', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
