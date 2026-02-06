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
  upsertS1S3Issue,
} from '@/lib/db/s1s3Flow';
import {
  S1S3IssueStatus,
  S1S3RunType,
  S1S3RunStatus,
  S1S3StepStatus,
} from '@/lib/contracts/s1s3Flow';
import { getRequestId, jsonResponse, errorResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifierOr404 } from '../../../../../issues/_shared';
import { parseIssueId } from '@/lib/contracts/ids';

// Avoid stale reads
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const AUTH_PATH = 'control';


function getStringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function getNumberField(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function deriveRepoFullName(issue: Record<string, unknown>): string | null {
  const repoField = getStringField(issue, 'github_repo', 'githubRepo');
  if (repoField && repoField.includes('/')) {
    return repoField;
  }

  const url = getStringField(issue, 'github_url', 'githubUrl');
  if (!url) return null;

  const match = url.match(/github\.com\/([^/]+\/[^/]+)(?:\/|$)/i);
  return match?.[1] ?? null;
}

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
  const routeHeaderValue = getRouteHeaderValue(request);
  const responseHeaders = getControlResponseHeaders(requestId, routeHeaderValue);

  try {
    const { id } = await context.params;
    const issueId = id;
    const parsedId = parseIssueId(issueId);
    let resolvedIssueId: string | null = null;
    let controlIssue: Record<string, unknown> | null = null;

    if (parsedId.isValid) {
      const resolved = await resolveIssueIdentifierOr404(issueId, requestId);
      if (!resolved.ok) {
        return jsonResponse(resolved.body, {
          status: resolved.status,
          requestId,
          headers: responseHeaders,
        });
      }
      resolvedIssueId = resolved.uuid;
      controlIssue = (resolved.issue as Record<string, unknown>) || null;
    }

    // Parse request body
    const body = await request.json();
    const { problem, scope, acceptanceCriteria, notes } = body;

    // Validate acceptance criteria (required for SPEC_READY)
    if (!acceptanceCriteria || !Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
      return errorResponse('Acceptance criteria required', {
        status: 400,
        requestId,
        details: 'acceptanceCriteria must be a non-empty array of strings',
        headers: responseHeaders,
      });
    }

    console.log('[S2] Spec ready request:', {
      requestId,
      issue_id: issueId,
      ac_count: acceptanceCriteria.length,
    });

    // Get existing issue
    let foundBy: 'id' | 'canonicalId' | 'seeded' | null = null;
    let issueResult = resolvedIssueId
      ? await getS1S3IssueById(pool, resolvedIssueId)
      : await getS1S3IssueByCanonicalId(pool, issueId);
    let issue = issueResult.success ? issueResult.data : undefined;

    if (issue) {
      foundBy = resolvedIssueId ? 'id' : 'canonicalId';
    } else {
      if (controlIssue) {
        const repoFullName = deriveRepoFullName(controlIssue);
        const issueNumber = getNumberField(controlIssue, 'github_issue_number', 'githubIssueNumber');
        const githubUrl = getStringField(controlIssue, 'github_url', 'githubUrl');

        if (!repoFullName || !issueNumber || !githubUrl) {
          return errorResponse('Issue missing GitHub metadata for spec', {
            status: 409,
            requestId,
            details: 'github_repo/github_url and github_issue_number are required to seed S1S3 issue',
            headers: responseHeaders,
          });
        }

        const seedResult = await upsertS1S3Issue(pool, {
          repo_full_name: repoFullName,
          github_issue_number: issueNumber,
          github_issue_url: githubUrl,
          owner: getStringField(controlIssue, 'assignee') || 'afu9',
          canonical_id: getStringField(controlIssue, 'canonical_id', 'canonicalId') || undefined,
          status: S1S3IssueStatus.CREATED,
        });

        if (!seedResult.success || !seedResult.data) {
          return errorResponse('Failed to seed S1S3 issue', {
            status: 500,
            requestId,
            details: seedResult.error,
            headers: responseHeaders,
          });
        }

        issue = seedResult.data;
        foundBy = 'seeded';
      }
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

      return jsonResponse(
        {
          errorCode: 'issue_not_found',
          issueId,
          requestId,
          lookupStore: 'control',
        },
        {
          status: 404,
          requestId,
          headers: responseHeaders,
        }
      );
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
        headers: responseHeaders,
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
        headers: responseHeaders,
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
        headers: responseHeaders,
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
        headers: responseHeaders,
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
        headers: responseHeaders,
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/s1s3/issues/[id]/spec] Error setting spec:', error);
    return errorResponse('Failed to set spec', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
      headers: responseHeaders,
    });
  }
}
