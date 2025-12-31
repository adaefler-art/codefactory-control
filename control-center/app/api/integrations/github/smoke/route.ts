/**
 * E71.1: GitHub Smoke Test Endpoint
 * 
 * Tests repo access policy enforcement with a minimal read-only GitHub call.
 * Only available in dev/stage environments.
 * 
 * GET /api/integrations/github/smoke?owner=X&repo=Y&branch=Z
 * 
 * Returns:
 * - 403: Repository not allowed by policy
 * - 200: Repository allowed + minimal repo info from GitHub
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClient, RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

export async function GET(request: NextRequest) {
  // Only allow in non-production environments
  const env = process.env.NODE_ENV;
  if (env === 'production') {
    return NextResponse.json(
      {
        error: 'Smoke test endpoint not available in production',
        code: 'NOT_AVAILABLE',
      },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const branch = searchParams.get('branch') || undefined;

  if (!owner || !repo) {
    return NextResponse.json(
      {
        error: 'Missing required parameters',
        code: 'MISSING_PARAMS',
        details: {
          required: ['owner', 'repo'],
          optional: ['branch'],
        },
      },
      { status: 400 }
    );
  }

  try {
    // E71.1: This will enforce the policy
    const octokit = await createAuthenticatedClient({
      owner,
      repo,
      branch,
    });

    // Make a minimal read-only call
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    return NextResponse.json(
      {
        ok: true,
        message: 'Repository access allowed',
        policy: {
          owner,
          repo,
          branch: branch || '(not specified)',
        },
        github: {
          name: repoData.name,
          full_name: repoData.full_name,
          default_branch: repoData.default_branch,
          visibility: repoData.visibility,
          private: repoData.private,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: 403 }
      );
    }

    console.error('[GitHub Smoke Test] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'GITHUB_API_ERROR',
      },
      { status: 500 }
    );
  }
}
