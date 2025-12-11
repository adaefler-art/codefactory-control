import { MCPServer, Tool } from '../../base/src/server';
import { Octokit } from 'octokit';

/**
 * GitHub MCP Server
 * 
 * Provides GitHub operations as MCP tools:
 * - github.getIssue
 * - github.listIssues
 * - github.createBranch
 * - github.commitFiles
 * - github.createPullRequest
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
  }

  protected async handleToolCall(tool: string, args: Record<string, any>): Promise<any> {
    switch (tool) {
      case 'getIssue':
        return this.getIssue(args);
      case 'listIssues':
        return this.listIssues(args);
      case 'createBranch':
        return this.createBranch(args);
      case 'createPullRequest':
        return this.createPullRequest(args);
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  private async getIssue(args: { owner: string; repo: string; number: number }) {
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
  }

  private async listIssues(args: { owner: string; repo: string; state?: string; labels?: string }) {
    const { owner, repo, state = 'open', labels } = args;
    
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: state as any,
      labels,
      per_page: 30,
    });

    return data.map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: issue.labels.map((l: any) => (typeof l === 'string' ? l : l.name)),
      created_at: issue.created_at,
      html_url: issue.html_url,
    }));
  }

  private async createBranch(args: { owner: string; repo: string; branch: string; from: string }) {
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
  }

  private async createPullRequest(args: {
    owner: string;
    repo: string;
    title: string;
    body?: string;
    head: string;
    base: string;
  }) {
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
  }
}

// Start server if run directly
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3001', 10);
  const server = new GitHubMCPServer(port);
  server.start();
}
