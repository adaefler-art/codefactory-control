/**
 * GitHub File Fetcher
 * 
 * Fetches file content from GitHub repository using GitHub App authentication.
 */

import { Octokit } from 'octokit';
import { getGitHubInstallationToken } from '../github-app-auth';

export interface FetchFileOptions {
  owner: string;
  repo: string;
  path: string;
  ref?: string;
}

export interface FetchFileResult {
  success: boolean;
  content?: string;
  error?: string;
  sha?: string;
}

/**
 * Fetch file content from GitHub repository
 * 
 * @param options - Fetch options
 * @returns File content or error
 */
export async function fetchGitHubFile(
  options: FetchFileOptions
): Promise<FetchFileResult> {
  try {
    // Get installation token from GitHub App for this specific repository
    const { token } = await getGitHubInstallationToken({
      owner: options.owner,
      repo: options.repo,
    });
    const octokit = new Octokit({ auth: token });
    
    const response = await octokit.rest.repos.getContent({
      owner: options.owner,
      repo: options.repo,
      path: options.path,
      ref: options.ref || 'main',
    });

    // Check if response is a file (not directory or submodule)
    if (!('content' in response.data) || Array.isArray(response.data)) {
      return {
        success: false,
        error: `Path ${options.path} is not a file`,
      };
    }

    // Decode base64 content
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');

    return {
      success: true,
      content,
      sha: response.data.sha,
    };
  } catch (error: any) {
    console.error('[fetchGitHubFile] Error:', {
      error: error instanceof Error ? error.message : String(error),
      options,
      timestamp: new Date().toISOString(),
    });

    // Handle specific error cases
    if (error.status === 404) {
      return {
        success: false,
        error: `File not found: ${options.path}${options.ref ? ` (ref: ${options.ref})` : ''}`,
      };
    }

    if (error.status === 403) {
      return {
        success: false,
        error: 'GitHub API access forbidden. Check GitHub App permissions.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch file from GitHub',
    };
  }
}
