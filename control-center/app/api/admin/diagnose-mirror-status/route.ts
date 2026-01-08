/**
 * Admin Diagnose Endpoint für GitHub Mirror Status
 * 
 * Issue #624: GitHub Mirror Status Persistierung schlägt fehl
 * 
 * Führt 4 SQL-Queries aus, um Probleme mit github_mirror_status zu identifizieren:
 * 1. Issue I691 (Beispiel-Issue) prüfen
 * 2. Status-Verteilung aller Issues mit GitHub-Links
 * 3. Count der nie-gesyncten Issues
 * 4. Letzter erfolgreicher Sync-Timestamp
 * 
 * Auth: Erfordert x-afu9-sub Header (admin-only via AFU9_ADMIN_SUBS)
 * 
 * AFU-9 GUARDRAILS (strict ordering):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, no DB calls
 * 2. ADMIN CHECK (403) - Verify AFU9_ADMIN_SUBS allowlist, no DB calls
 * 3. DB OPERATIONS - Only executed if all guards pass
 * 
 * Usage:
 *   curl http://localhost:3000/api/admin/diagnose-mirror-status \
 *     -H "x-afu9-sub: admin@example.com"
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, errorResponse } from '@/lib/api/response-helpers';

// ============================================================================
// TypeScript Interfaces
// ============================================================================

interface IssueI691Result {
  public_id: string;
  title: string;
  github_issue_number: number | null;
  github_mirror_status: string;
  github_url: string | null;
  github_repo: string | null;
  handoff_state: string;
  github_issue_last_sync_at: string | null;
  github_sync_error: string | null;
}

interface StatusDistributionResult {
  github_mirror_status: string;
  count: string; // PostgreSQL COUNT returns bigint as string
}

interface NeverSyncedResult {
  never_synced_count: string;
}

interface LastSyncResult {
  last_sync_time: string | null;
  synced_issues_count: string;
}

interface DiagnosisResults {
  issueI691: IssueI691Result | null;
  statusDistribution: StatusDistributionResult[];
  neverSyncedCount: number;
  lastSync: LastSyncResult;
}

type DiagnosisStatus = 'OK' | 'WARNING' | 'CRITICAL' | 'INFO';
type DiagnosisProblem = 'ALL_UNKNOWN' | 'PARTIAL_UNKNOWN';

interface Diagnosis {
  status: DiagnosisStatus;
  problem?: DiagnosisProblem;
  message: string;
  recommendation?: string;
  databaseConnection: 'OK' | 'FAILED';
  issuesFound: number;
}

interface DiagnoseResponse {
  ok: boolean;
  timestamp: string;
  results: DiagnosisResults;
  diagnosis: Diagnosis;
}

interface ErrorResponse {
  ok: false;
  error: string;
  code?: string;
  details?: string;
  timestamp: string;
}

// ============================================================================
// Auth Helper
// ============================================================================

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

// ============================================================================
// Diagnosis Logic
// ============================================================================

/**
 * Analyzes query results and provides diagnosis
 * 
 * Status levels:
 * - CRITICAL: All issues have UNKNOWN status (sync never worked)
 * - WARNING: Some issues have UNKNOWN status (partial failure)
 * - OK: All issues have correct status (OPEN/CLOSED/ERROR)
 * - INFO: No issues with GitHub links found
 */
function analyzeDiagnosis(results: DiagnosisResults): Diagnosis {
  const { statusDistribution, neverSyncedCount } = results;

  // Calculate total issues and unknown count
  const totalIssues = statusDistribution.reduce((sum, item) => sum + parseInt(item.count), 0);
  const unknownEntry = statusDistribution.find(item => item.github_mirror_status === 'UNKNOWN');
  const unknownCount = unknownEntry ? parseInt(unknownEntry.count) : 0;

  // No issues found
  if (totalIssues === 0) {
    return {
      status: 'INFO',
      message: 'Keine Issues mit GitHub-Links gefunden',
      databaseConnection: 'OK',
      issuesFound: 0,
    };
  }

  // All issues are UNKNOWN - critical problem
  if (unknownCount === totalIssues && totalIssues > 0) {
    return {
      status: 'CRITICAL',
      problem: 'ALL_UNKNOWN',
      message: `Alle ${totalIssues} Issues haben github_mirror_status = UNKNOWN`,
      recommendation: 
        'Sync wurde nie erfolgreich ausgeführt oder Persist schlägt fehl. ' +
        'Prüfe Server-Logs nach "Persist failed" Fehlern. ' +
        'Verifiziere Type-Safety in control-center/app/api/ops/issues/sync/route.ts',
      databaseConnection: 'OK',
      issuesFound: totalIssues,
    };
  }

  // Some issues are UNKNOWN - warning
  if (unknownCount > 0) {
    return {
      status: 'WARNING',
      problem: 'PARTIAL_UNKNOWN',
      message: `${unknownCount} von ${totalIssues} Issues haben UNKNOWN Status`,
      recommendation: 
        'Einige Issues konnten nicht gesynct werden. ' +
        'Prüfe github_sync_error Spalte für Details.',
      databaseConnection: 'OK',
      issuesFound: totalIssues,
    };
  }

  // All issues have correct status - success
  return {
    status: 'OK',
    message: `Alle ${totalIssues} Issues haben korrekten Status`,
    databaseConnection: 'OK',
    issuesFound: totalIssues,
  };
}

// ============================================================================
// Main Handler
// ============================================================================

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const requestId = getRequestId(request);

  // ========================================
  // 1. AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  // This must happen BEFORE any DB calls to maintain auth-first principle
  // ========================================
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
        timestamp,
      } satisfies ErrorResponse,
      { status: 401 }
    );
  }

  // ========================================
  // 2. AUTHORIZATION CHECK: Admin-only (fail-closed)
  // ========================================
  if (!isAdminUser(userId)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Forbidden',
        code: 'FORBIDDEN',
        details: 'Admin privileges required to access diagnostic endpoints',
        timestamp,
      } satisfies ErrorResponse,
      { status: 403 }
    );
  }

  // ========================================
  // 3. Database Connection
  // ========================================
  const pool = getPool();

  try {
    // ========================================
    // Query 1: Check Issue I691 (GitHub #477)
    // ========================================
    // This is the example issue from Issue #624 that shows the problem
    const query1 = `
      SELECT 
        LEFT(id::text, 8) as public_id,
        title,
        github_issue_number,
        github_mirror_status,
        github_url,
        github_repo,
        handoff_state,
        github_issue_last_sync_at,
        github_sync_error
      FROM afu9_issues
      WHERE title LIKE '%I691%' OR github_issue_number = 477
      LIMIT 1;
    `;

    const result1 = await pool.query<IssueI691Result>(query1);
    const issueI691 = result1.rows.length > 0 ? result1.rows[0] : null;

    // ========================================
    // Query 2: GitHub Mirror Status Distribution
    // ========================================
    // Shows how many issues have UNKNOWN vs OPEN/CLOSED/ERROR status
    const query2 = `
      SELECT 
        github_mirror_status,
        COUNT(*) as count
      FROM afu9_issues
      WHERE github_issue_number IS NOT NULL
      GROUP BY github_mirror_status
      ORDER BY count DESC;
    `;

    const result2 = await pool.query<StatusDistributionResult>(query2);
    const statusDistribution = result2.rows;

    // ========================================
    // Query 3: Never-Synced Issues Count
    // ========================================
    // Issues with GitHub links but github_issue_last_sync_at = NULL
    const query3 = `
      SELECT COUNT(*) as never_synced_count
      FROM afu9_issues
      WHERE github_issue_number IS NOT NULL
        AND github_issue_last_sync_at IS NULL;
    `;

    const result3 = await pool.query<NeverSyncedResult>(query3);
    const neverSyncedCount = parseInt(result3.rows[0].never_synced_count);

    // ========================================
    // Query 4: Last Successful Sync
    // ========================================
    // When was the last time ANY issue was successfully synced?
    const query4 = `
      SELECT 
        MAX(github_issue_last_sync_at) as last_sync_time,
        COUNT(*) as synced_issues_count
      FROM afu9_issues
      WHERE github_issue_last_sync_at IS NOT NULL;
    `;

    const result4 = await pool.query<LastSyncResult>(query4);
    const lastSync = result4.rows[0];

    // ========================================
    // 3. Build Results Object
    // ========================================
    const results: DiagnosisResults = {
      issueI691,
      statusDistribution,
      neverSyncedCount,
      lastSync,
    };

    // ========================================
    // 4. Run Diagnosis Logic
    // ========================================
    const diagnosis = analyzeDiagnosis(results);

    // ========================================
    // 5. Return Success Response
    // ========================================
    return NextResponse.json(
      {
        ok: true,
        timestamp,
        results,
        diagnosis,
      } satisfies DiagnoseResponse,
      { status: 200 }
    );

  } catch (error: any) {
    // ========================================
    // Database Error Handling
    // ========================================
    console.error('[API /api/admin/diagnose-mirror-status] Database error:', error);

    return NextResponse.json(
      {
        ok: false,
        error: `Database query failed: ${error.message}`,
        timestamp,
        diagnosis: {
          status: 'CRITICAL' as DiagnosisStatus,
          message: 'Database connection failed',
          databaseConnection: 'FAILED',
          issuesFound: 0,
        },
      },
      { status: 500 }
    );
  }
}
