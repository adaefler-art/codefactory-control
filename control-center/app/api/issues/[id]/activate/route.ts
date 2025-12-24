/**
 * API Route: /api/issues/[id]/activate
 * 
 * Activates an AFU9 issue (sets it to ACTIVE and all others to CREATED)
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import {
  getAfu9IssueById,
  updateAfu9Issue,
  getActiveIssue,
} from '../../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
} from '../../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { fetchIssueRowByIdentifier, normalizeIssueForApi } from '../../_shared';

/**
 * POST /api/issues/[id]/activate
 * 
 * Sets this issue to ACTIVE and all other ACTIVE issues to CREATED.
 * Leaves DONE and BLOCKED issues unchanged.
 * Only one issue can be ACTIVE at a time (Single-Active constraint).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const pool = getPool();
    const { id } = params;

    const resolved = await fetchIssueRowByIdentifier(pool, id);
    if (!resolved.ok) {
      return NextResponse.json(resolved.body, { status: resolved.status });
    }

    const issue = resolved.row as any;
    const internalId = String(issue.id);

    // Check if already ACTIVE
    if (issue?.status === Afu9IssueStatus.ACTIVE) {
      const responseBody: any = {
        message: 'Issue is already ACTIVE',
        issue: normalizeIssueForApi(issue),
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return NextResponse.json(responseBody);
    }

    // Get the current active issue (if any)
    const activeIssueResult = await getActiveIssue(pool);
    if (!activeIssueResult.success) {
      return NextResponse.json(
        {
          error: 'Failed to check active issue',
          details: activeIssueResult.error,
        },
        { status: 500 }
      );
    }

    const currentActiveIssue = activeIssueResult.data;

    // Deactivate the current active issue (if exists and different from target)
    if (currentActiveIssue && currentActiveIssue.id !== internalId) {
      const deactivateResult = await updateAfu9Issue(pool, currentActiveIssue.id, {
        status: Afu9IssueStatus.CREATED,
      });

      if (!deactivateResult.success) {
        return NextResponse.json(
          {
            error: 'Failed to deactivate current active issue',
            details: deactivateResult.error,
          },
          { status: 500 }
        );
      }
    }

    // Activate the target issue
    const activateResult = await updateAfu9Issue(pool, internalId, {
      status: Afu9IssueStatus.ACTIVE,
    });

    if (!activateResult.success) {
      return NextResponse.json(
        { error: 'Failed to activate issue', details: activateResult.error },
        { status: 500 }
      );
    }

    const responseBody: any = {
      message: 'Issue activated successfully',
      issue: normalizeIssueForApi(activateResult.data),
      deactivated: currentActiveIssue
        ? {
            id: currentActiveIssue.id,
            publicId: String(currentActiveIssue.id).substring(0, 8),
            title: currentActiveIssue.title,
          }
        : null,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[API /api/issues/[id]/activate] Error activating issue:', error);
    return NextResponse.json(
      {
        error: 'Failed to activate issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
