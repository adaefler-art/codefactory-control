/**
 * GitHub Integration Utilities
 * Handles GitHub API interactions and webhook processing
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GitHubWebhookEvent {
  action: string;
  issue?: {
    number: number;
    title: string;
    body: string;
    labels: Array<{ name: string }>;
  };
  pull_request?: {
    number: number;
    state: string;
    head: { sha: string };
  };
  repository: {
    name: string;
    owner: { login: string };
    default_branch: string;
  };
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(auth: { appId: string; privateKey: string; installationId: number }) {
    this.octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: auth.appId,
        privateKey: auth.privateKey,
        installationId: auth.installationId,
      },
    });
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string) {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data;
  }

  /**
   * Get issue details
   */
  async getIssue(owner: string, repo: string, issueNumber: number) {
    const { data } = await this.octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return data;
  }

  /**
   * List repository files
   */
  async listFiles(owner: string, repo: string, path: string = ''): Promise<string[]> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
      });

      if (Array.isArray(data)) {
        const files: string[] = [];
        for (const item of data) {
          if (item.type === 'file') {
            files.push(item.path);
          } else if (item.type === 'dir') {
            const subFiles = await this.listFiles(owner, repo, item.path);
            files.push(...subFiles);
          }
        }
        return files;
      }

      return [];
    } catch (error) {
      console.error(`Failed to list files at ${path}:`, error);
      return [];
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(owner: string, repo: string, branchName: string, baseBranch: string = 'main') {
    // Get the SHA of the base branch
    const { data: ref } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    // Create new branch
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });
  }

  /**
   * Create or update file in repository
   */
  async createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    content: string,
    message: string,
    branch: string
  ) {
    // Check if file exists
    let sha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      if ('sha' in data) {
        sha = data.sha;
      }
    } catch (error) {
      // File doesn't exist, that's okay
    }

    await this.octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      sha,
    });
  }

  /**
   * Detect programming languages in repository
   */
  async getRepositoryLanguages(owner: string, repo: string): Promise<string[]> {
    const { data } = await this.octokit.repos.listLanguages({ owner, repo });
    return Object.keys(data);
  }
}

/**
 * Verify GitHub webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Parse GitHub webhook event
 */
export function parseWebhookEvent(body: string): GitHubWebhookEvent {
  return JSON.parse(body);
}
