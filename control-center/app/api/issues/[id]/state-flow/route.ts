/**
 * API Route: Get State Flow Data
 * E85.3: UI: State Flow Viewer
 * 
 * Returns state flow data for an issue including:
 * - Current state
 * - Valid next states
 * - Blocking reasons
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { computeStateFlow, getBlockersForDone } from '../../../../../src/lib/state-flow';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../_shared';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Next.js 15 App Router: params is a Promise
  const { id } = await params;
  const requestId = getRequestId(request);
  const responseHeaders = getControlResponseHeaders(requestId);
  const resolved = await resolveIssueIdentifier(id, requestId);
  if (!resolved.ok) {
    return jsonResponse(resolved.body, {
      status: resolved.status,
      requestId,
      headers: responseHeaders,
    });
  }

  const issueId = resolved.uuid;

  try {
    const pool = getPool();
    
    // Fetch issue data
    const result = await pool.query(
      `SELECT 
        id,
        status,
        github_issue_number,
        github_url,
        handoff_state,
        execution_state
      FROM afu9_issues
      WHERE id = $1`,
      [issueId]
    );

    if (result.rows.length === 0) {
      return jsonResponse(
        { error: 'Issue not found' },
        { status: 404, requestId, headers: responseHeaders }
      );
    }

    const issue = result.rows[0];
    const currentStatus = issue.status || 'CREATED';

    // TODO: In a real implementation, fetch actual evidence from:
    // - GitHub API (PR status, reviews, checks)
    // - Database (sync audit events)
    // For now, we'll use placeholder evidence based on handoff/execution state
    const evidence = {
      hasCode: issue.execution_state === 'DONE' || issue.execution_state === 'RUNNING',
      testsPass: issue.execution_state === 'DONE',
      reviewApproved: false, // Would fetch from GitHub
      ciChecksPass: false, // Would fetch from GitHub
      noMergeConflicts: true, // Would fetch from GitHub
      prMerged: false, // Would fetch from GitHub
      specificationComplete: currentStatus !== 'CREATED',
    };

    // Compute state flow
    const stateFlow = computeStateFlow(currentStatus, evidence);
    
    // Get blockers for DONE
    const blockersForDone = getBlockersForDone(currentStatus, evidence);

    return jsonResponse(
      {
        issueId: issue.id,
        currentStatus,
        githubIssueNumber: issue.github_issue_number,
        githubUrl: issue.github_url,
        stateFlow,
        blockersForDone,
      },
      { requestId, headers: responseHeaders }
    );
  } catch (error) {
    console.error('[GET /api/issues/[id]/state-flow] Error:', error);
    const requestId = getRequestId(request);
    return jsonResponse(
      { error: 'Failed to compute state flow' },
      { status: 500, requestId, headers: getControlResponseHeaders(requestId) }
    );
  }
}
