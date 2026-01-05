/**
 * API Route: POST /api/integrations/github/runner/dispatch
 * 
 * E64.1: Dispatch a GitHub Actions workflow run
 * 
 * GUARDS (strict ordering, Issue 3):
 * 1. AUTH CHECK (401-first) - Verify x-afu9-sub, NO DB calls
 * 2. PROD DISABLED (409) - Check ENABLE_PROD, NO DB calls
 * 3. DB operations - Only executed if all guards pass
 * 
 * Request body accepts either:
 * - `workflowIdOrFile` (preferred, matches GitHub API terminology)
 * - `workflow` (legacy/convenience alias)
 * Only one should be provided. If both are present, `workflowIdOrFile` takes precedence.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { dispatchWorkflow } from '@/lib/github-runner/adapter';
import type { DispatchWorkflowInput } from '@/lib/github-runner/types';
import { checkProdWriteGuard } from '@/lib/guards/prod-write-guard';
import { getRequestId } from '@/lib/api/response-helpers';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  // GUARDS (401 → 409): Auth and prod disabled check, NO DB calls
  const guard = checkProdWriteGuard(request, { requestId });
  if (guard.errorResponse) {
    return guard.errorResponse;
  }
  
  // Guard passed - userId is guaranteed to be set
  const userId = guard.userId!;

  try {
    const body = await request.json();

    // Validate input
    // Support both workflowIdOrFile (preferred) and workflow (alias) for flexibility
    const input: DispatchWorkflowInput = {
      owner: body.owner,
      repo: body.repo,
      workflowIdOrFile: body.workflowIdOrFile || body.workflow,
      ref: body.ref,
      inputs: body.inputs || {},
      correlationId: body.correlationId,
      title: body.title,
    };

    // Validate required fields
    if (!input.owner || !input.repo || !input.workflowIdOrFile || !input.ref) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          details:
            'owner, repo, workflowIdOrFile (or workflow), and ref are required',
        },
        { status: 400 }
      );
    }

    if (!input.correlationId) {
      return NextResponse.json(
        {
          error: 'Missing correlationId',
          details:
            'correlationId is required for idempotency and tracking (e.g., issue ID or execution ID)',
        },
        { status: 400 }
      );
    }

    const pool = getPool();
    const result = await dispatchWorkflow(pool, input);

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      runUrl: result.runUrl,
      recordId: result.recordId,
      isExisting: result.isExisting,
      message: result.isExisting
        ? 'Found existing workflow run (idempotent)'
        : 'Workflow dispatched successfully',
    });
  } catch (error) {
    console.error('[API /api/integrations/github/runner/dispatch] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to dispatch workflow',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
