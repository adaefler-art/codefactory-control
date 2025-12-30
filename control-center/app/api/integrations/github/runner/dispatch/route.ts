/**
 * API Route: POST /api/integrations/github/runner/dispatch
 * 
 * E64.1: Dispatch a GitHub Actions workflow run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { dispatchWorkflow } from '@/lib/github-runner/adapter';
import type { DispatchWorkflowInput } from '@/lib/github-runner/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
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
