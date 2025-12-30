/**
 * API Route: POST /api/integrations/github/runner/poll
 * 
 * E64.1: Poll a GitHub Actions workflow run for status updates
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { pollRun } from '@/lib/github-runner/adapter';
import type { PollRunInput } from '@/lib/github-runner/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const input: PollRunInput = {
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
    const result = await pollRun(pool, input);

    return NextResponse.json({
      ok: true,
      runId: result.runId,
      status: result.status,
      conclusion: result.conclusion,
      normalizedStatus: result.normalizedStatus,
      updatedAt: result.updatedAt,
      createdAt: result.createdAt,
      runStartedAt: result.runStartedAt,
    });
  } catch (error) {
    console.error('[API /api/integrations/github/runner/poll] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to poll workflow run',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
