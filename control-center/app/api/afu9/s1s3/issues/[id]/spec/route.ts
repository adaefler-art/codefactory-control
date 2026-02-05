/**
 * API Route: POST /api/afu9/s1s3/issues/[id]/spec
 * 
 * S2 - Spec Ready: Persists minimal spec with acceptance criteria.
 * Updates issue status to SPEC_READY.
 * Logs S2 step event for audit trail.
 * 
 * Request body:
 * {
 *   problem?: string,
 *   scope?: string,
 *   acceptanceCriteria: string[] (required, min 1),
 *   notes?: string
 * }
 * 
 * Response format:
 * {
 *   issue: S1S3IssueRow,
 *   run: S1S3RunRow,
 *   step: S1S3RunStepRow
 * }
 * 
 * Reference: E9.1_F1 - S1-S3 Live Flow MVP
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getS1S3IssueById,
  getS1S3IssueByCanonicalId,
  createS1S3Run,
  createS1S3RunStep,
  updateS1S3RunStatus,
  updateS1S3IssueSpec,
} from '@/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

/**
 * POST /api/afu9/s1s3/issues/[id]/spec
 * Set spec ready with acceptance criteria
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = getRequestId(request);
  const pool = getPool();

  try {
    const { id } = await context.params;
    const issueId = id;

    // Parse request body
    const body = await request.json();
    const { problem, scope, acceptanceCriteria, notes } = body;

    // Validate acceptance criteria (required for SPEC_READY)
    if (!acceptanceCriteria || !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
      return errorResponse('Acceptance criteria required', {
        status: 400,
        requestId,
        details: 'acceptanceCriteria must be a non-empty array of strings',
      });
    }

    console.log('[S2] Spec ready request:', {
      requestId,
      issue_id: issueId,
      ac_count: acceptanceCriteria.length,
    });

    // Get existing issue
    let foundBy: 'id' | 'canonicalId' | null = null;
    let issueResult = await getS1S3IssueById(pool, issueId);
    let issue = issueResult.success ? issueResult.data : undefined;

    if (issue) {
      foundBy = 'id';
    } else {
      issueResult = await getS1S3IssueByCanonicalId(pool, issueId);
      issue = issueResult.success ? issueResult.data : undefined;
      if (issue) foundBy = 'canonicalId';
    }

    if (!issue) {
      const pathMatch = request.nextUrl.pathname.match(/\/issues\/([^/]+)\/spec$/);
      const pathIssueId = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
      console.warn('[S2] Spec ready issue lookup failed:', {
        requestId,
        issue_id: issueId,
        path_issue_id: pathIssueId,
        foundBy,
      });

      return errorResponse('Issue not found', {
        status: 404,
        requestId,
        details: issueResult.error,
      });
    }

    console.log('[S2] Spec ready issue resolved:', {
      requestId,
      issue_id: issue.id,
      foundBy,
    });

    // Check if issue is in valid state for spec
    if (issue.status !== S1S3IssueStatus.CREATED && issue.status !== S1S3IssueStatus.SPEC_READY) {
      return errorResponse('Invalid issue state', {
        status: 400,
        requestId,
        details: `Issue must be in CREATED or SPEC_READY state. Current: ${issue.status}`,
      });
    }

    // Create run record
    const runResult = await createS1S3Run(pool, {
      type: S1S3RunType.S2_SPEC_READY,
      issue_id: issue.id,
      request_id: requestId,
      actor: issue.owner,
      status: S1S3RunStatus.RUNNING,
    });

    if (!runResult.success || !runResult.data) {
      return errorResponse('Failed to create run record', {
        status: 500,
        requestId,
        details: runResult.error,
      });
    }

    const run = runResult.data;

    // Create step event - STARTED
    await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S2',
      step_name: 'Spec Ready',
      status: S1S3StepStatus.STARTED,
      evidence_refs: {
        issue_id: issue.id,
        issue_url: issue.github_issue_url,
        request_id: requestId,
      },
    });

    // Update issue with spec data
    const updateResult = await updateS1S3IssueSpec(pool, issue.id, {
      problem: problem?.trim() || null,
      scope: scope?.trim() || null,
      acceptance_criteria: acceptanceCriteria,
      notes: notes?.trim() || null,
    });

    if (!updateResult.success || !updateResult.data) {
      return errorResponse('Failed to update issue', {
        status: 500,
        requestId,
        details: updateResult.error,
      });
    }

    const updatedIssue = updateResult.data;

    console.log('[S2] Spec persisted:', {
      requestId,
      issue_id: updatedIssue.id,
      status: updatedIssue.status,
      ac_count: acceptanceCriteria.length,
    });

    // Create step event - SUCCEEDED
    const stepResult = await createS1S3RunStep(pool, {
      run_id: run.id,
      step_id: 'S2',
      step_name: 'Spec Ready',
      status: S1S3StepStatus.SUCCEEDED,
      evidence_refs: {
        issue_id: updatedIssue.id,
        issue_url: updatedIssue.github_issue_url,
        status: updatedIssue.status,
        spec_ready_at: updatedIssue.spec_ready_at,
        acceptance_criteria_count: acceptanceCriteria.length,
        request_id: requestId,
      },
    });

    if (!stepResult.success || !stepResult.data) {
      return errorResponse('Failed to create step event', {
        status: 500,
        requestId,
        details: stepResult.error,
      });
    }

    // Update run status to DONE
    await updateS1S3RunStatus(pool, run.id, S1S3RunStatus.DONE);

    console.log('[S2] Spec ready completed successfully:', {
      requestId,
      issue_id: updatedIssue.id,
      run_id: run.id,
    });

    return jsonResponse(
      {
        issue: updatedIssue,
        run: run,
        step: stepResult.data,
      },
      {
        requestId,
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/spec] Error setting spec:', error);
    return errorResponse('Failed to set spec', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
