import { MCPServer, Tool, DependencyCheck } from '../../base/src/server';
import type { Octokit } from 'octokit';
import { loadGitHubAppConfig, getGitHubInstallationToken, GitHubAppConfigError } from './github-app-auth';

type OctokitConstructor = new (options: { auth: string }) => Octokit;

async function loadOctokitConstructor(): Promise<OctokitConstructor> {
  // IMPORTANT:
  // - The `octokit` package is ESM-only.
  // - Our build emits CommonJS, and TypeScript would downlevel `import('octokit')` to `require('octokit')`,
  //   which crashes at runtime with ERR_REQUIRE_ESM.
  // - Using a Function wrapper preserves a real dynamic import evaluated by Node at runtime.
  const importer = new Function('return import("octokit")') as () => Promise<any>;
  const mod = await importer();
  const OctokitCtor = mod?.Octokit;
  if (!OctokitCtor) {
    throw new Error('Failed to load Octokit from octokit module');
  }
  return OctokitCtor as OctokitConstructor;
}

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
 * - Uses GitHub App server-to-server authentication (JWT + installation tokens)
 * - No Personal Access Tokens (PATs) required
 * - Installation tokens are generated on-demand per repository
 * - Credentials loaded from AWS Secrets Manager or environment variables
 * 
 * Error Handling:
 * - Rate limit errors (403 with X-RateLimit-Remaining: 0)
 * - Invalid credentials (401 Unauthorized)
 * - Missing permissions (403 Forbidden)
 * - Resource not found (404)
 */
export class GitHubMCPServer extends MCPServer {
  private octokitCtor!: OctokitConstructor;
  private readonly octokitInit: Promise<void>;
  private readonly configInit: Promise<void>;

  constructor(port: number = 3001) {
    super(port, 'mcp-github', '0.2.0');
    
    // Validate GitHub App configuration on startup
    this.configInit = (async () => {
      try {
        const config = await loadGitHubAppConfig();
        console.log('[mcp-github] GitHub App authentication configured');
        console.log(`[mcp-github] App ID: ${config.appId}`);
      } catch (error) {
        if (error instanceof GitHubAppConfigError) {
          console.error('[mcp-github] GitHub App configuration error:', error.message);
          console.error('\nFor local dev, set environment variables:');
          console.error('  export GITHUB_APP_ID="..."');
          console.error('  export GITHUB_APP_PRIVATE_KEY_PEM="..."');
          console.error('\nFor production, ensure AWS Secrets Manager secret exists:');
          console.error('  Secret ID: afu9/github/app');
          console.error('  Required keys: appId, privateKeyPem');
        } else {
          console.error('[mcp-github] Unexpected error loading GitHub App config:', error);
        }
        throw error;
      }
    })();

    this.octokitInit = (async () => {
      this.octokitCtor = await loadOctokitConstructor();
    })();
  }

  override start() {
    Promise.all([this.configInit, this.octokitInit])
      .then(() => super.start())
      .catch((error) => {
        this.logger.error('Failed to initialize GitHub MCP Server', error);
        process.exit(1);
      });
  }

  /**
   * Create an authenticated Octokit instance for a specific repository
   * Uses GitHub App installation tokens (generated on-demand)
   */
  private async createOctokit(owner: string, repo: string): Promise<Octokit> {
    const { token } = await getGitHubInstallationToken({ owner, repo });
    return new this.octokitCtor({ auth: token });
  }

  /**
   * Check dependencies for readiness probe
   * Checks GitHub API connectivity and authentication
   */
  protected async checkDependencies(): Promise<Map<string, DependencyCheck>> {
    const checks = new Map<string, DependencyCheck>();

    // Check 1: Service is running
    checks.set('service', { status: 'ok' });

    // Check 2: GitHub API connectivity
    const githubApiCheck = await this.checkGitHubAPI();
    checks.set('github_api', githubApiCheck);

    // Check 3: GitHub App configuration validity
    const authCheck = await this.checkAuthentication();
    checks.set('authentication', authCheck);

    return checks;
  }

  /**
   * Check if GitHub API is reachable
   */
  private async checkGitHubAPI(): Promise<DependencyCheck> {
    const startTime = Date.now();
    try {
      // Use the /zen endpoint for a quick connectivity check
      const response = await fetch('https://api.github.com/zen', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });
      
      const latency = Date.now() - startTime;

      if (!response.ok) {
        return {
          status: 'error',
          message: `GitHub API returned status ${response.status}`,
          latency_ms: latency,
        };
      }

      return {
        status: latency > 2000 ? 'warning' : 'ok',
        message: latency > 2000 ? 'High latency detected' : 'GitHub API reachable',
        latency_ms: latency,
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
        latency_ms: latency,
      };
    }
  }

  /**
   * Check if GitHub App authentication is valid
   */
  private async checkAuthentication(): Promise<DependencyCheck> {
    try {
      // Check if GitHub App config is loaded
      const config = await loadGitHubAppConfig();
      
      if (!config.appId || !config.privateKeyPem) {
        return {
          status: 'error',
          message: 'GitHub App configuration incomplete',
        };
      }

      return {
        status: 'ok',
        message: `GitHub App configured (App ID: ${config.appId})`,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Authentication check failed',
      };
    }
  }

  /**
   * Get required dependencies for this service
   */
  protected getRequiredDependencies(): string[] {
    return ['github_api', 'authentication'];
  }

  /**
   * Get optional dependencies for this service
   */
  protected getOptionalDependencies(): string[] {
    return [];
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
        const limit = error.response?.headers?.['x-ratelimit-limit'];
        this.logger.error('GitHub API rate limit exceeded', error, {
          resetTime: resetDate.toISOString(),
          limit: limit ? parseInt(limit) : undefined,
          resource: error.response?.headers?.['x-ratelimit-resource']
        });
        throw new Error(
          `GitHub API rate limit exceeded. Resets at ${resetDate.toISOString()}. ` +
          `Consider using a GitHub App for higher rate limits.`
        );
      }

      // Handle authentication errors
      if (error.status === 401) {
        this.logger.error('GitHub authentication failed', error);
        throw new Error(
          'Invalid GitHub credentials. Please check your GITHUB_TOKEN. ' +
          'The token may be expired or invalid.'
        );
      }

      // Handle permission errors
      if (error.status === 403) {
        this.logger.error('GitHub permission denied', error);
        throw new Error(
          `Insufficient permissions for this operation. ` +
          `Please ensure your GitHub token has the required scopes. ` +
          `Details: ${error.message}`
        );
      }

      // Handle not found errors
      if (error.status === 404) {
        this.logger.warn('GitHub resource not found', { 
          status: error.status,
          message: error.message 
        });
        throw new Error(
          `Resource not found. Please verify the repository owner, name, and resource identifier. ` +
          `Details: ${error.message}`
        );
      }

      // Handle other errors
      this.logger.error('GitHub API error', error, { status: error.status });
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
      
      this.logger.info('Fetching GitHub issue', { owner, repo, issueNumber: number });

      const octokit = await this.createOctokit(owner, repo);
      const { data } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: number,
      });

      this.logger.info('Successfully fetched issue', { 
        owner, 
        repo, 
        issueNumber: number,
        state: data.state 
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
      
      const octokit = await this.createOctokit(owner, repo);
      const { data } = await octokit.rest.issues.listForRepo({
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

      this.logger.info('Creating branch', { owner, repo, branch, from });

      const octokit = await this.createOctokit(owner, repo);

      // Get the SHA of the base ref
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${from}`,
      });

      const sha = refData.object.sha;

      // Create the new branch
      const { data } = await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha,
      });

      this.logger.info('Successfully created branch', { 
        owner, 
        repo, 
        branch, 
        sha: data.object.sha 
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

      const octokit = await this.createOctokit(owner, repo);

      // Get the current commit SHA of the branch
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const currentCommitSha = refData.object.sha;

      // Get the tree SHA of the current commit
      const { data: commitData } = await octokit.rest.git.getCommit({
        owner,
        repo,
        commit_sha: currentCommitSha,
      });

      const baseTreeSha = commitData.tree.sha;

      // Create blobs for each file
      const tree = await Promise.all(
        files.map(async (file) => {
          // Auto-detect encoding: if content looks like base64, use base64, otherwise utf-8
          // Base64 content typically doesn't contain newlines and uses base64 character set
          const isBase64 = /^[A-Za-z0-9+/=]+$/.test(file.content.replace(/\s/g, ''));
          const encoding = isBase64 && file.content.length > 100 ? 'base64' : 'utf-8';
          
          const { data: blob } = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: file.content,
            encoding: encoding as 'utf-8' | 'base64',
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
      const { data: newTree } = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree,
      });

      // Create a new commit
      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner,
        repo,
        message,
        tree: newTree.sha,
        parents: [currentCommitSha],
      });

      // Update the reference
      await octokit.rest.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      });

      // Construct the commit URL manually since the Git API doesn't provide html_url
      const commit_url = `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`;

      return {
        commit_sha: newCommit.sha,
        commit_url,
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

      this.logger.info('Creating pull request', { owner, repo, title, head, base });

      const octokit = await this.createOctokit(owner, repo);
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body: body || '',
        head,
        base,
      });

      this.logger.info('Successfully created pull request', { 
        owner, 
        repo, 
        prNumber: data.number,
        htmlUrl: data.html_url 
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

      const octokit = await this.createOctokit(owner, repo);
      const { data } = await octokit.rest.pulls.merge({
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
