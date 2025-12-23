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
import { isValidUUID } from '../../../../../src/lib/utils/uuid-validator';

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

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: 'Invalid issue ID format' },
        { status: 400 }
      );
    }

    // Get the issue to activate
    const issueResult = await getAfu9IssueById(pool, id);
    if (!issueResult.success) {
      if (issueResult.error && issueResult.error.includes('not found')) {
        return NextResponse.json(
          { error: 'Issue not found', id },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: 'Failed to get issue', details: issueResult.error },
        { status: 500 }
      );
    }

    const issue = issueResult.data;

    // Check if already ACTIVE
    if (issue?.status === Afu9IssueStatus.ACTIVE) {
      return NextResponse.json({
        message: 'Issue is already ACTIVE',
        issue,
      });
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
    if (currentActiveIssue && currentActiveIssue.id !== id) {
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
    const activateResult = await updateAfu9Issue(pool, id, {
      status: Afu9IssueStatus.ACTIVE,
    });

    if (!activateResult.success) {
      return NextResponse.json(
        { error: 'Failed to activate issue', details: activateResult.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Issue activated successfully',
      issue: activateResult.data,
      deactivated: currentActiveIssue
        ? {
            id: currentActiveIssue.id,
            title: currentActiveIssue.title,
          }
        : null,
    });
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
