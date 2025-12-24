/**
 * API Route: /api/issues/[id]/handoff
 * 
 * Hands off an AFU9 issue to GitHub (creates GitHub issue)
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import {
  getAfu9IssueById,
  updateAfu9Issue,
} from '../../../../../src/lib/db/afu9Issues';
import {
  Afu9HandoffState,
} from '../../../../../src/lib/contracts/afu9Issue';
import { createIssue } from '../../../../../src/lib/github';
import { isValidUUID } from '../../../../../src/lib/utils/uuid-validator';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';

/**
 * POST /api/issues/[id]/handoff
 * 
 * Handoff Semantics (MVP):
 * - Unidirectional: AFU9 → GitHub
 * - Idempotent: Uses AFU9-ISSUE:<id> marker in issue body
 * - Creates GitHub issue and updates handoff_state
 * - Updates github_url, github_issue_number on success
 * - Updates last_error on failure
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

    // Get the issue to handoff
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
    if (!issue) {
      return NextResponse.json(
        { error: 'Issue not found', id },
        { status: 404 }
      );
    }

    // Check if already handed off successfully
    if (issue.handoff_state === Afu9HandoffState.SYNCED) {
      const responseBody: any = {
        message: 'Issue already handed off to GitHub',
        issue,
        github_url: issue.github_url,
        github_issue_number: issue.github_issue_number,
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return NextResponse.json(responseBody);
    }

    // Mark as SENT before attempting GitHub creation
    const sentResult = await updateAfu9Issue(pool, id, {
      handoff_state: Afu9HandoffState.SENT,
      last_error: null, // Clear previous error
    });

    if (!sentResult.success) {
      return NextResponse.json(
        {
          error: 'Failed to update handoff state to SENT',
          details: sentResult.error,
        },
        { status: 500 }
      );
    }

    try {
      // Create idempotency key marker
      const idempotencyKey = `AFU9-ISSUE:${id}`;
      
      // Build GitHub issue body with idempotency marker
      const githubBody = [
        issue.body || '',
        '',
        '---',
        `<!-- ${idempotencyKey} -->`,
      ].join('\n');

      // Create GitHub issue
      const githubIssue = await createIssue({
        title: issue.title,
        body: githubBody,
        labels: issue.labels,
      });

      // Update AFU9 issue with GitHub details
      const syncedResult = await updateAfu9Issue(pool, id, {
        handoff_state: Afu9HandoffState.SYNCED,
        github_issue_number: githubIssue.number,
        github_url: githubIssue.html_url,
        last_error: null,
      });

      if (!syncedResult.success) {
        // GitHub issue created but failed to update AFU9 issue
        // This is a critical partial failure
        console.error(
          '[API /api/issues/[id]/handoff] GitHub issue created but failed to update AFU9 issue:',
          {
            id,
            github_number: githubIssue.number,
            github_url: githubIssue.html_url,
            error: syncedResult.error,
          }
        );

        return NextResponse.json(
          {
            error: 'Partial handoff failure: GitHub issue created but failed to update AFU9 issue',
            details: syncedResult.error,
            github_url: githubIssue.html_url,
            github_issue_number: githubIssue.number,
          },
          { status: 500 }
        );
      }

      const responseBody: any = {
        message: 'Issue handed off to GitHub successfully',
        issue: syncedResult.data,
        github_url: githubIssue.html_url,
        github_issue_number: githubIssue.number,
      };
      if (isDebugApiEnabled()) {
        responseBody.contextTrace = await buildContextTrace(request);
      }
      return NextResponse.json(responseBody);
    } catch (githubError) {
      // GitHub creation failed - update handoff_state to FAILED
      const errorMessage =
        githubError instanceof Error ? githubError.message : String(githubError);

      await updateAfu9Issue(pool, id, {
        handoff_state: Afu9HandoffState.FAILED,
        last_error: errorMessage,
      });

      console.error('[API /api/issues/[id]/handoff] GitHub issue creation failed:', {
        id,
        error: errorMessage,
      });

      return NextResponse.json(
        {
          error: 'Failed to create GitHub issue',
          details: errorMessage,
          handoff_state: Afu9HandoffState.FAILED,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[API /api/issues/[id]/handoff] Error during handoff:', error);
    return NextResponse.json(
      {
        error: 'Failed to handoff issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
