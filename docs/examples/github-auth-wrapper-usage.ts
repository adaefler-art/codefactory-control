/**
 * Example: Using GitHub Auth Wrapper in API Routes
 * 
 * This example demonstrates how to use the policy-enforced GitHub auth wrapper
 * in Next.js API routes for AFU-9.
 * 
 * Reference: I711 (E71.1) - Repo Access Policy + Auth Wrapper
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  createAuthenticatedClient,
  getAuthenticatedToken,
  isRepoAllowed,
  RepoAccessDeniedError
} from '@/lib/github/auth-wrapper';

/**
 * Example 1: Preflight check before processing
 * Use isRepoAllowed() to check if a repository is in the allowlist
 * before doing any heavy processing.
 */
export async function GET_PreflightCheck(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');

  if (!owner || !repo) {
    return NextResponse.json(
      { error: 'Missing owner or repo' },
      { status: 400 }
    );
  }

  // Preflight check (does not make network calls)
  if (!isRepoAllowed(owner, repo)) {
    return NextResponse.json(
      { 
        error: {
          code: 'REPO_NOT_ALLOWED',
          message: `Repository ${owner}/${repo} is not in allowlist`,
          details: { owner, repo }
        }
      },
      { status: 403 }
    );
  }

  // Continue with processing...
  return NextResponse.json({ 
    message: `Repository ${owner}/${repo} is allowed` 
  });
}

/**
 * Example 2: Get authenticated token
 * Use getAuthenticatedToken() when you need the raw token
 * (e.g., for custom API calls or passing to other libraries).
 */
export async function POST_GetToken(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing owner or repo' },
        { status: 400 }
      );
    }

    // Get token with policy enforcement
    const { token, expiresAt } = await getAuthenticatedToken({
      owner,
      repo,
      branch,
    });

    // Use token for custom API calls
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    const repoData = await response.json();

    return NextResponse.json({
      repository: repoData,
      tokenExpiresAt: expiresAt,
    });

  } catch (error) {
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        { 
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Example 3: Create authenticated Octokit client
 * Use createAuthenticatedClient() for most GitHub API operations.
 * This is the recommended approach.
 */
export async function POST_GetRepositoryInfo(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch } = body;

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing owner or repo' },
        { status: 400 }
      );
    }

    // Create authenticated client with policy enforcement
    const octokit = await createAuthenticatedClient({
      owner,
      repo,
      branch,
    });

    // Use Octokit REST API
    const { data: repository } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    const { data: branches } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 10,
    });

    return NextResponse.json({
      repository: {
        name: repository.name,
        full_name: repository.full_name,
        description: repository.description,
        default_branch: repository.default_branch,
        visibility: repository.visibility,
      },
      branches: branches.map(b => ({
        name: b.name,
        protected: b.protected,
      })),
    });

  } catch (error) {
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        { 
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        },
        { status: 403 }
      );
    }

    console.error('GitHub API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Example 4: Access with path restrictions
 * When repository has path restrictions in allowlist,
 * include path in request.
 */
export async function POST_GetFileContent(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo, branch, path } = body;

    if (!owner || !repo || !path) {
      return NextResponse.json(
        { error: 'Missing owner, repo, or path' },
        { status: 400 }
      );
    }

    // Create client with path enforcement
    const octokit = await createAuthenticatedClient({
      owner,
      repo,
      branch,
      path, // Path will be validated against allowlist
    });

    // Get file content
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    }) as { data: { content?: string; encoding?: string } };

    if (!data.content) {
      return NextResponse.json(
        { error: 'File not found or is a directory' },
        { status: 404 }
      );
    }

    // Decode base64 content
    const content = Buffer.from(data.content, 'base64').toString('utf-8');

    return NextResponse.json({
      path,
      content,
    });

  } catch (error) {
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        { 
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        },
        { status: 403 }
      );
    }

    console.error('GitHub API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Example 5: Combining with existing GitHub App auth
 * If you're migrating from direct getGitHubInstallationToken calls,
 * you can gradually adopt the auth wrapper.
 */
import { getGitHubInstallationToken } from '@/lib/github-app-auth';

export async function POST_MigrationExample(request: NextRequest) {
  try {
    const body = await request.json();
    const { owner, repo } = body;

    // Option A: Use auth wrapper (recommended - includes policy check)
    const octokit = await createAuthenticatedClient({ owner, repo });

    // Option B: Direct token (legacy - no policy enforcement)
    // const { token } = await getGitHubInstallationToken({ owner, repo });
    // const octokit = new Octokit({ auth: token });

    const { data: repository } = await octokit.rest.repos.get({
      owner,
      repo,
    });

    return NextResponse.json({ repository });

  } catch (error) {
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        { 
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          }
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Notes:
 * 
 * 1. Always use try-catch to handle RepoAccessDeniedError
 * 2. Return appropriate HTTP status codes:
 *    - 403 Forbidden: Repository not in allowlist
 *    - 400 Bad Request: Missing required parameters
 *    - 500 Internal Server Error: Unexpected errors
 * 
 * 3. The auth wrapper enforces policy BEFORE making network calls,
 *    ensuring deny-by-default behavior with no unnecessary API requests.
 * 
 * 4. Token security:
 *    - Tokens are never sent to the client
 *    - All operations are server-side only
 *    - Use Next.js API routes or server actions
 * 
 * 5. Configuration:
 *    - Set GITHUB_REPO_ALLOWLIST environment variable
 *    - See docs/E71_1_REPO_ACCESS_POLICY.md for details
 */
