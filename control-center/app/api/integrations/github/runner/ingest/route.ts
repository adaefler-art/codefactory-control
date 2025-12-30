/**
 * API Route: POST /api/integrations/github/runner/ingest
 * 
 * E64.1: Ingest a completed GitHub Actions workflow run
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { ingestRun } from '@/lib/github-runner/adapter';
import type { IngestRunInput } from '@/lib/github-runner/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const input: IngestRunInput = {
      owner: body.owner,
      repo: body.repo,
      runId: body.runId,
    };

    // Validate required fields
    if (!input.owner || !input.repo || !input.runId) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          details: 'owner, repo, and runId are required',
        },
        { status: 400 }
      );
    }

    const pool = getPool();
    const result = await ingestRun(pool, input);

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      recordId: result.recordId,
      summary: result.summary,
      jobs: result.jobs,
      artifacts: result.artifacts,
      annotations: result.annotations,
      logsUrl: result.logsUrl,
    });
  } catch (error) {
    console.error('[API /api/integrations/github/runner/ingest] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to ingest workflow run',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
