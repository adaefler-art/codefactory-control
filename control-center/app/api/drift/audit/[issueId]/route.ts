/**
 * API Route: Drift Audit Trail
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * GET /api/drift/audit/:issueId
 * 
 * Retrieves the full drift detection and resolution audit trail for an issue.
 * 
 * Guards:
 * - ✅ Read-only
 * - ✅ Full audit trail visibility
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDriftAuditTrail } from '@/lib/db/driftDetection';
import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drift/audit/:issueId
 * 
 * Get drift audit trail for an issue
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { issueId: string } }
): Promise<NextResponse> {
  const { issueId } = params;

  try {
    const pool = getPool();

    // Get audit trail
    const auditResult = await getDriftAuditTrail(pool, issueId);
    if (!auditResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: auditResult.error || 'Failed to retrieve audit trail',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: auditResult.data,
    });
  } catch (error) {
    console.error('[drift/audit] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
