/**
 * API Route: Repository Details with GitHub Data
 * 
 * GET /api/repositories/[id]
 * 
 * Fetches repository details from database along with PRs and issues from GitHub.
 */

import { NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { Octokit } from 'octokit';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
    
    // If no GitHub token, return repository without GitHub data
    if (!GITHUB_TOKEN) {
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
        pullRequests: [],
        issues: [],
      });
    }
    
    // Fetch data from GitHub
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    
    // Fetch open pull requests
    let pullRequests: any[] = [];
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
        draft: pr.draft,
        head: pr.head.ref,
        base: pr.base.ref,
        labels: pr.labels.map((label) => ({
          name: typeof label === 'string' ? label : label.name || '',
          color: typeof label === 'object' && label !== null ? label.color : null,
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
    
    // Fetch open issues (exclude PRs)
    let issues: any[] = [];
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
            color: typeof label === 'object' && label !== null ? label.color : null,
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
    
    // Get recent workflow executions for pipeline status
    let recentExecutions: any[] = [];
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
