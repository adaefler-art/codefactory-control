import { MCPServer, Tool } from '../../base/src/server';
import { Octokit } from 'octokit';

/**
 * GitHub MCP Server
 * 
 * Provides GitHub operations as MCP tools:
 * - github.getIssue
 * - github.listIssues
 * - github.createBranch
 * - github.commitFileChanges
 * - github.createPullRequest
 * - github.mergePullRequest
 * 
 * Authentication:
 * - Supports GitHub Personal Access Token (PAT) or GitHub App token
 * - Token should be provided via GITHUB_TOKEN environment variable
 * - In production, token is loaded from AWS Secrets Manager
 * 
 * Error Handling:
 * - Rate limit errors (403 with X-RateLimit-Remaining: 0)
 * - Invalid credentials (401 Unauthorized)
 * - Missing permissions (403 Forbidden)
 * - Resource not found (404)
 */
export class GitHubMCPServer extends MCPServer {
  private octokit: Octokit;

  constructor(port: number = 3001) {
    super(port, 'mcp-github');
    
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }
    
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Wraps GitHub API calls with enhanced error handling
   */
  private async handleGitHubAPICall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      // Handle rate limit errors
      if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
        const resetTime = error.response.headers['x-ratelimit-reset'];
        const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : new Date();
        throw new Error(
          `GitHub API rate limit exceeded. Resets at ${resetDate.toISOString()}. ` +
          `Consider using a GitHub App for higher rate limits.`
        );
      }

      // Handle authentication errors
      if (error.status === 401) {
        throw new Error(
          'Invalid GitHub credentials. Please check your GITHUB_TOKEN. ' +
          'The token may be expired or invalid.'
        );
      }

      // Handle permission errors
      if (error.status === 403) {
        throw new Error(
          `Insufficient permissions for this operation. ` +
          `Please ensure your GitHub token has the required scopes. ` +
          `Details: ${error.message}`
        );
      }

      // Handle not found errors
      if (error.status === 404) {
        throw new Error(
          `Resource not found. Please verify the repository owner, name, and resource identifier. ` +
          `Details: ${error.message}`
        );
      }

      // Handle other errors
      throw new Error(
        `GitHub API error (${error.status || 'unknown'}): ${error.message}`
      );
    }
  }

  protected registerTools(): void {
    this.tools.set('getIssue', {
      name: 'getIssue',
      description: 'Get details of a GitHub issue',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          number: { type: 'number', description: 'Issue number' },
        },
        required: ['owner', 'repo', 'number'],
      },
    });

    this.tools.set('listIssues', {
      name: 'listIssues',
      description: 'List issues in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state' },
          labels: { type: 'string', description: 'Comma-separated list of labels' },
        },
        required: ['owner', 'repo'],
      },
    });

    this.tools.set('createBranch', {
      name: 'createBranch',
      description: 'Create a new branch in a repository',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          branch: { type: 'string', description: 'Name of the new branch' },
          from: { type: 'string', description: 'Base branch or commit SHA' },
        },
        required: ['owner', 'repo', 'branch', 'from'],
      },
    });

    this.tools.set('commitFileChanges', {
      name: 'commitFileChanges',
      description: 'Commit file changes to a branch',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          branch: { type: 'string', description: 'Branch to commit to' },
          message: { type: 'string', description: 'Commit message' },
          files: {
            type: 'array',
            description: 'Files to commit',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
                content: { type: 'string', description: 'File content (base64 encoded for binary files)' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['owner', 'repo', 'branch', 'message', 'files'],
      },
    });

    this.tools.set('createPullRequest', {
      name: 'createPullRequest',
      description: 'Create a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR description' },
          head: { type: 'string', description: 'Head branch (source)' },
          base: { type: 'string', description: 'Base branch (target)' },
        },
        required: ['owner', 'repo', 'title', 'head', 'base'],
      },
    });

    this.tools.set('mergePullRequest', {
      name: 'mergePullRequest',
      description: 'Merge a pull request',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          pull_number: { type: 'number', description: 'Pull request number' },
          commit_title: { type: 'string', description: 'Commit title (optional)' },
          commit_message: { type: 'string', description: 'Commit message (optional)' },
          merge_method: {
            type: 'string',
            enum: ['merge', 'squash', 'rebase'],
            description: 'Merge method (default: merge)',
          },
        },
        required: ['owner', 'repo', 'pull_number'],
      },
    });
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    switch (tool) {
      case 'getIssue':
        return this.getIssue(args as { owner: string; repo: string; number: number });
      case 'listIssues':
        return this.listIssues(args as { owner: string; repo: string; state?: string; labels?: string });
      case 'createBranch':
        return this.createBranch(args as { owner: string; repo: string; branch: string; from: string });
      case 'commitFileChanges':
        return this.commitFileChanges(args as {
          owner: string;
          repo: string;
          branch: string;
          message: string;
          files: Array<{ path: string; content: string }>;
        });
      case 'createPullRequest':
        return this.createPullRequest(args as { owner: string; repo: string; title: string; body?: string; head: string; base: string });
      case 'mergePullRequest':
        return this.mergePullRequest(args as {
          owner: string;
          repo: string;
          pull_number: number;
          commit_title?: string;
          commit_message?: string;
          merge_method?: 'merge' | 'squash' | 'rebase';
        });
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async getIssue(args: { owner: string; repo: string; number: number }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, number } = args;
      
      const { data } = await this.octokit.rest.issues.get({
        owner,
        repo,
        issue_number: number,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        state: data.state,
        labels: data.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
      };
    });
  }

  private async listIssues(args: { owner: string; repo: string; state?: string; labels?: string }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, state = 'open', labels } = args;
      
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: state as any,
        labels,
        per_page: 30,
      });

      return data.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
        created_at: issue.created_at,
        html_url: issue.html_url,
      }));
    });
  }

  private async createBranch(args: { owner: string; repo: string; branch: string; from: string }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, branch, from } = args;

      // Get the SHA of the base ref
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${from}`,
      });

      const sha = refData.object.sha;

      // Create the new branch
      const { data } = await this.octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha,
      });

      return {
        ref: data.ref,
        sha: data.object.sha,
        url: data.url,
      };
    });
  }

  private async commitFileChanges(args: {
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: Array<{ path: string; content: string }>;
  }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, branch, message, files } = args;

      // Get the current commit SHA of the branch
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const currentCommitSha = refData.object.sha;

      // Get the tree SHA of the current commit
      const { data: commitData } = await this.octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: currentCommitSha,
      });

      const baseTreeSha = commitData.tree.sha;

      // Create blobs for each file
      const tree = await Promise.all(
        files.map(async (file) => {
          const { data: blob } = await this.octokit.rest.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: 'utf-8',
          });

          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha,
          };
        })
      );

      // Create a new tree
      const { data: newTree } = await this.octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree,
      });

      // Create a new commit
      const { data: newCommit } = await this.octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: newTree.sha,
        parents: [currentCommitSha],
      });

      // Update the reference
      await this.octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      });

      return {
        commit_sha: newCommit.sha,
        commit_url: newCommit.html_url,
        message: newCommit.message,
        files_changed: files.length,
      };
    });
  }

  private async createPullRequest(args: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    head: string;
    base: string;
  }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, title, body, head, base } = args;

      const { data } = await this.octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body: body || '',
        head,
        base,
      });

      return {
        number: data.number,
        title: data.title,
        state: data.state,
        html_url: data.html_url,
        created_at: data.created_at,
      };
    });
  }

  private async mergePullRequest(args: {
    owner: string;
    repo: string;
    pull_number: number;
    commit_title?: string;
    commit_message?: string;
    merge_method?: 'merge' | 'squash' | 'rebase';
  }) {
    return this.handleGitHubAPICall(async () => {
      const { owner, repo, pull_number, commit_title, commit_message, merge_method = 'merge' } = args;

      const { data } = await this.octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number,
        commit_title,
        commit_message,
        merge_method,
      });

      return {
        sha: data.sha,
        merged: data.merged,
        message: data.message,
      };
    });
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3001', 10);
  const server = new GitHubMCPServer(port);
  server.start();
}
