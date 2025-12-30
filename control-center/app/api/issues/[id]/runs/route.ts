/**
 * API Route: /api/issues/[id]/runs
 * 
 * List and create runs for a specific issue.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getRunsDAO } from '../../../../../src/lib/db/afu9Runs';
import { getRunnerService } from '../../../../../src/lib/runner-service';
import { withApi } from '../../../../../src/lib/http/withApi';
import { RunSpecSchema } from '../../../../../src/lib/contracts/afu9Runner';
import { z } from 'zod';

/**
 * GET /api/issues/[id]/runs
 * List runs for a specific issue
 * 
 * Query params:
 * - limit: number (default 20)
 * - offset: number (default 0)
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const dao = getRunsDAO(pool);
  const { id: issueId } = await params;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const runs = await dao.listRunsByIssue(issueId, limit, offset);

  return NextResponse.json({
    runs,
    total: runs.length, // Simple approximation; could query total count if needed
  });
});

/**
 * POST /api/issues/[id]/runs
 * Create and optionally execute a run for an issue
 * 
 * Body:
 * - playbookId?: string (load spec from playbook)
 * - spec?: RunSpec (provide custom spec)
 * - title?: string (override title)
 * - autoExecute?: boolean (default true - execute immediately)
 */
export const POST = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const runnerService = getRunnerService(pool);
  const { id: issueId } = await params;

  const body = await request.json();
  const { playbookId, spec: customSpec, title, autoExecute = true } = body;

  let spec;

  if (playbookId) {
    // Load spec from playbook
    const playbook = await runnerService.getPlaybook(playbookId);
    if (!playbook) {
      return NextResponse.json(
        { error: `Playbook ${playbookId} not found` },
        { status: 404 }
      );
    }
    spec = { ...playbook.spec };
    if (title) {
      spec.title = title;
    }
  } else if (customSpec) {
    // Validate custom spec
    spec = RunSpecSchema.parse(customSpec);
  } else {
    return NextResponse.json(
      { error: 'Either playbookId or spec must be provided' },
      { status: 400 }
    );
  }

  // Create run
  const runId = await runnerService.createRun(spec, issueId, playbookId, undefined);

  // Execute if requested
  if (autoExecute) {
    // Execute asynchronously (don't await)
    runnerService.executeRun(runId).catch((err) => {
      console.error(`[API] Failed to execute run ${runId}:`, err);
    });
  }

  return NextResponse.json({
    runId,
    status: autoExecute ? 'executing' : 'created',
  });
});
