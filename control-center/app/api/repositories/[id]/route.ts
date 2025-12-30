/**
 * API Route: Repository Details with GitHub Data
 * 
 * GET /api/repositories/[id] - Fetches repository details
 * DELETE /api/repositories/[id] - Removes a repository
 * PATCH /api/repositories/[id] - Updates repository configuration
 * 
 * Fetches repository details from database along with PRs and issues from GitHub.
 */

import { NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getGitHubInstallationToken } from '../../../../src/lib/github-app-auth';
import { Octokit } from 'octokit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  
  try {
    const pool = getPool();
    
    // Fetch repository from database
    const repoQuery = `
      SELECT 
        id,
        owner,
        name,
        full_name,
        default_branch,
        enabled,
        config,
        created_at,
        updated_at
      FROM repositories
      WHERE id = $1
    `;
    
    const repoResult = await pool.query(repoQuery, [id]);
    
    if (repoResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }
    
    const repo = repoResult.rows[0];
    
    // Fetch data from GitHub using GitHub App authentication
    let pullRequests: PullRequestData[] = [];
    let issues: IssueData[] = [];
    
    try {
      const { token } = await getGitHubInstallationToken({
        owner: repo.owner,
        repo: repo.name,
      });
      const octokit = new Octokit({ auth: token });
    
    interface PullRequestData {
      number: number;
      title: string;
      state: string;
      htmlUrl: string;
      createdAt: string;
      updatedAt: string;
      author: string;
      draft: boolean;
      head: string;
      base: string;
      labels: { name: string; color: string | null }[];
      automated: boolean;
    }
    
    // Fetch open pull requests
      try {
        const { data: prs } = await octokit.rest.pulls.list({
          owner: repo.owner,
          repo: repo.name,
          state: 'open',
          sort: 'created',
          direction: 'desc',
          per_page: 20,
        });
        
        pullRequests = prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          htmlUrl: pr.html_url,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          author: pr.user?.login || 'unknown',
          draft: pr.draft || false,
          head: pr.head.ref,
          base: pr.base.ref,
          labels: pr.labels.map((label) => ({
            name: typeof label === 'string' ? label : label.name || '',
            color: typeof label === 'object' && label !== null ? (label.color || null) : null,
          })),
          // Mark as automated if created by known bots or has specific labels
          automated: pr.user?.type === 'Bot' || 
                    pr.labels.some((label) => 
                      typeof label === 'object' && label !== null && 
                      (label.name === 'automated' || label.name === 'afu-9' || label.name === 'bot')
                    ),
        }));
      } catch (error) {
        console.error('[API] Error fetching pull requests:', error);
        // Continue with empty array
      }
    
    interface IssueData {
      number: number;
      title: string;
      state: string;
      htmlUrl: string;
      createdAt: string;
      updatedAt: string;
      author: string;
      labels: { name: string; color: string | null }[];
      comments: number;
      important: boolean;
    }
    
    // Fetch open issues (exclude PRs)
      try {
        const { data: issuesData } = await octokit.rest.issues.listForRepo({
          owner: repo.owner,
          repo: repo.name,
          state: 'open',
          sort: 'created',
          direction: 'desc',
          per_page: 20,
        });
        
        // Filter out pull requests (GitHub API returns PRs as issues)
        issues = issuesData
          .filter((issue) => !issue.pull_request)
          .map((issue) => ({
            number: issue.number,
            title: issue.title,
            state: issue.state,
            htmlUrl: issue.html_url,
            createdAt: issue.created_at,
            updatedAt: issue.updated_at,
            author: issue.user?.login || 'unknown',
            labels: issue.labels.map((label) => ({
              name: typeof label === 'string' ? label : label.name || '',
              color: typeof label === 'object' && label !== null ? (label.color || null) : null,
            })),
            comments: issue.comments,
            // Mark as important if it has high priority labels or many comments
            important: issue.labels.some((label) => 
              typeof label === 'object' && label !== null &&
              (label.name === 'bug' || label.name === 'critical' || label.name === 'high-priority')
            ) || issue.comments > 5,
          }));
      } catch (error) {
        console.error('[API] Error fetching issues:', error);
        // Continue with empty array
      }
    } catch (error) {
      console.error('[API] Error fetching GitHub data:', error);
      // Continue with empty arrays (already initialized above)
    }
    
    // Get workflow executions count for this repository
    let executionsCount = 0;
    try {
      const executionsQuery = `
        SELECT COUNT(*) as count
        FROM workflow_executions
        WHERE context->>'repository' = $1
      `;
      const executionsResult = await pool.query(executionsQuery, [repo.full_name]);
      executionsCount = parseInt(executionsResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error('[API] Error fetching executions count:', error);
    }
    
    interface ExecutionData {
      id: string;
      workflowId: string;
      status: string;
      startedAt: string;
      completedAt: string | null;
      error: string | null;
      triggeredBy: string | null;
      githubRunId: string | null;
    }
    
    // Get recent workflow executions for pipeline status
    let recentExecutions: ExecutionData[] = [];
    try {
      const recentQuery = `
        SELECT 
          id,
          workflow_id,
          status,
          started_at,
          completed_at,
          error,
          triggered_by,
          github_run_id
        FROM workflow_executions
        WHERE context->>'repository' = $1
        ORDER BY started_at DESC
        LIMIT 5
      `;
      const recentResult = await pool.query(recentQuery, [repo.full_name]);
      recentExecutions = recentResult.rows.map((row) => ({
        id: row.id,
        workflowId: row.workflow_id,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error,
        triggeredBy: row.triggered_by,
        githubRunId: row.github_run_id,
      }));
    } catch (error) {
      console.error('[API] Error fetching recent executions:', error);
    }
    
    return NextResponse.json({
      repository: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        enabled: repo.enabled,
        config: repo.config,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        executionsCount,
      },
      pullRequests,
      issues,
      recentExecutions,
    });
  } catch (error) {
    console.error('[API] Error fetching repository details:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to fetch repository details',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  
  try {
    const pool = getPool();
    
    // Check if repository exists
    const checkQuery = `SELECT id FROM repositories WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    // Delete repository
    const deleteQuery = `DELETE FROM repositories WHERE id = $1`;
    await pool.query(deleteQuery, [id]);

    return NextResponse.json({ success: true, message: 'Repository deleted' });
  } catch (error) {
    console.error('[API] Error deleting repository:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to delete repository',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  
  try {
    const body = await request.json();
    const { enabled, config, defaultBranch } = body;

    const pool = getPool();
    
    // Check if repository exists
    const checkQuery = `SELECT id FROM repositories WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: (string | boolean | object)[] = [];
    let paramCount = 1;

    if (enabled !== undefined) {
      updates.push(`enabled = $${paramCount++}`);
      values.push(enabled);
    }

    if (config !== undefined) {
      updates.push(`config = $${paramCount++}`);
      values.push(JSON.stringify(config));
    }

    if (defaultBranch !== undefined) {
      updates.push(`default_branch = $${paramCount++}`);
      values.push(defaultBranch);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const updateQuery = `
      UPDATE repositories
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, owner, name, full_name, default_branch, enabled, config, created_at, updated_at
    `;

    const result = await pool.query(updateQuery, values);
    const repo = result.rows[0];

    return NextResponse.json({
      repository: {
        id: repo.id,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        enabled: repo.enabled,
        config: repo.config,
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
      },
    });
  } catch (error) {
    console.error('[API] Error updating repository:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to update repository',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
