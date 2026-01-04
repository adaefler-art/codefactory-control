import { createAuthenticatedClient } from "./github/auth-wrapper";

const GITHUB_OWNER = process.env.GITHUB_OWNER || "adaefler-art";
const GITHUB_REPO = process.env.GITHUB_REPO || "rhythmologicum-connect";

/**
 * Minimal issue fields returned by listIssuesByLabel
 */
export interface MinimalIssue {
  id: number; // Issue number (not the internal GitHub ID)
  title: string;
  state: string;
  html_url: string;
  created_at: string;
}

/**
 * Full issue data from GitHub API (for issue sync)
 */
export interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  node_id: string;
  body: string | null;
}

/**
 * Parameters for creating a GitHub issue
 */
export interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
}

/**
 * Parameters for updating a GitHub issue
 * E61.3: Support for idempotent handoff updates
 */
export interface UpdateIssueParams {
  number: number;
  title?: string;
  body?: string;
  labels?: string[];
}

/**
 * Result from creating a GitHub issue
 */
export interface CreateIssueResult {
  html_url: string;
  number: number;
}

/**
 * Result from updating a GitHub issue
 * E61.3: Support for idempotent handoff updates
 */
export interface UpdateIssueResult {
  html_url: string;
  number: number;
}

/**
 * Create an authenticated Octokit instance using GitHub App authentication
 * E71.1: Now enforces repo access policy via auth-wrapper
 */
async function createAuthenticatedOctokit(owner: string, repo: string) {
  return await createAuthenticatedClient({ owner, repo });
}

/**
 * Creates a new GitHub issue
 * @param params - Issue creation parameters
 * @returns The created issue with URL and number
 */
export async function createIssue(params: CreateIssueParams): Promise<CreateIssueResult> {
  try {
    const octokit = await createAuthenticatedOctokit(GITHUB_OWNER, GITHUB_REPO);

    const { title, body, labels = [] } = params;

    console.log(`Creating GitHub issue in ${GITHUB_OWNER}/${GITHUB_REPO}...`, { title });
    const { data: issue } = await octokit.rest.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title,
      body,
      labels,
    });

    console.log(`GitHub issue created: ${issue.html_url}`, { number: issue.number });

    return {
      html_url: issue.html_url,
      number: issue.number,
    };
  } catch (error) {
    console.error("Error creating GitHub issue:", {
      error: error instanceof Error ? error.message : String(error),
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    
    if (error instanceof Error && error.message.includes("Bad credentials")) {
      throw new Error("GitHub App authentication failed");
    }
    
    if (error instanceof Error && error.message.includes("Not Found")) {
      throw new Error(`GitHub-Repository ${GITHUB_OWNER}/${GITHUB_REPO} nicht gefunden`);
    }
    
    if (error instanceof Error && error.message.includes("rate limit")) {
      throw new Error("GitHub API-Limit erreicht");
    }
    
    throw new Error(`GitHub-Fehler: ${error instanceof Error ? error.message : "Unbekannter Fehler"}`);
  }
}

/**
 * Updates an existing GitHub issue
 * E61.3: Support for idempotent handoff updates
 * 
 * @param params - Issue update parameters including issue number
 * @returns The updated issue with URL and number
 */
export async function updateIssue(params: UpdateIssueParams): Promise<UpdateIssueResult> {
  try {
    const octokit = await createAuthenticatedOctokit(GITHUB_OWNER, GITHUB_REPO);

    const { number, title, body, labels } = params;

    console.log(`Updating GitHub issue #${number} in ${GITHUB_OWNER}/${GITHUB_REPO}...`, { title });
    
    // Build update payload with only provided fields
    const updatePayload: {
      owner: string;
      repo: string;
      issue_number: number;
      title?: string;
      body?: string;
      labels?: string[];
    } = {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      issue_number: number,
    };
    
    if (title !== undefined) {
      updatePayload.title = title;
    }
    if (body !== undefined) {
      updatePayload.body = body;
    }
    if (labels !== undefined) {
      updatePayload.labels = labels;
    }

    const { data: issue } = await octokit.rest.issues.update(updatePayload);

    console.log(`GitHub issue updated: ${issue.html_url}`, { number: issue.number });

    return {
      html_url: issue.html_url,
      number: issue.number,
    };
  } catch (error) {
    console.error("Error updating GitHub issue:", {
      error: error instanceof Error ? error.message : String(error),
      number: params.number,
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    
    if (error instanceof Error && error.message.includes("Bad credentials")) {
      throw new Error("GitHub App authentication failed");
    }
    
    if (error instanceof Error && error.message.includes("Not Found")) {
      throw new Error(`GitHub-Issue #${params.number} nicht gefunden in ${GITHUB_OWNER}/${GITHUB_REPO}`);
    }
    
    if (error instanceof Error && error.message.includes("rate limit")) {
      throw new Error("GitHub API-Limit erreicht");
    }
    
    throw new Error(`GitHub-Fehler: ${error instanceof Error ? error.message : "Unbekannter Fehler"}`);
  }
}

/**
 * Lists issues by a specific label
 * @param label - The label to filter issues by
 * @returns Array of minimal issue objects
 */
export async function listIssuesByLabel(label: string): Promise<MinimalIssue[]> {
  try {
    const octokit = await createAuthenticatedOctokit(GITHUB_OWNER, GITHUB_REPO);

    console.log(`Fetching issues with label ${label} from ${GITHUB_OWNER}/${GITHUB_REPO}...`);
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      labels: label,
      state: "all",
      sort: "created",
      direction: "desc",
    });

    const minimalIssues = issues.map((issue) => ({
      id: issue.number,
      title: issue.title,
      state: issue.state,
      html_url: issue.html_url,
      created_at: issue.created_at,
    }));

    console.log(`Found ${minimalIssues.length} issues with label ${label}`);

    return minimalIssues;
  } catch (error) {
    console.error("Error fetching GitHub issues:", {
      error: error instanceof Error ? error.message : String(error),
      label,
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
    });
    
    if (error instanceof Error && error.message.includes("Bad credentials")) {
      throw new Error("GitHub App authentication failed");
    }
    
    if (error instanceof Error && error.message.includes("Not Found")) {
      throw new Error(`GitHub-Repository ${GITHUB_OWNER}/${GITHUB_REPO} nicht gefunden`);
    }
    
    if (error instanceof Error && error.message.includes("rate limit")) {
      throw new Error("GitHub API-Limit erreicht");
    }
    
    throw new Error(`GitHub-Fehler: ${error instanceof Error ? error.message : "Unbekannter Fehler"}`);
  }
}

/**
 * Search/list issues with pagination support
 * Used for AFU-9 Issue Sync (deterministic, paginated retrieval)
 * 
 * @param options - Search options
 * @returns Array of full issue objects
 */
export async function searchIssues(options: {
  owner?: string;
  repo?: string;
  query?: string;
  state?: 'open' | 'closed' | 'all';
  sort?: 'created' | 'updated' | 'comments';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}): Promise<{ issues: GitHubIssue[]; total_count: number }> {
  try {
    const owner = options.owner || GITHUB_OWNER;
    const repo = options.repo || GITHUB_REPO;
    const octokit = await createAuthenticatedOctokit(owner, repo);

    const {
      query,
      state = 'all',
      sort = 'updated',
      direction = 'desc',
      per_page = 100,
      page = 1,
    } = options;

    // Build deterministic query
    let searchQuery = query || `repo:${owner}/${repo}`;
    
    // Ensure repo is in query if custom query provided
    if (query && !query.includes('repo:')) {
      searchQuery = `${query} repo:${owner}/${repo}`;
    }

    // Add state filter to query (GitHub search API uses 'is:' prefix)
    if (state !== 'all') {
      if (!searchQuery.includes('is:')) {
        searchQuery += ` is:${state}`;
      }
    }

    console.log(`Searching GitHub issues: ${searchQuery}`, {
      owner,
      repo,
      sort,
      direction,
      per_page,
      page,
    });

    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: searchQuery,
      sort: sort as any,
      order: direction,
      per_page,
      page,
    });

    // Filter out pull requests (search API returns both issues and PRs)
    const issues = data.items
      .filter((item: any) => !item.pull_request)
      .map((item: any): GitHubIssue => ({
        number: item.number,
        title: item.title,
        state: item.state as 'open' | 'closed',
        html_url: item.html_url,
        created_at: item.created_at,
        updated_at: item.updated_at,
        labels: item.labels || [],
        assignees: item.assignees || [],
        node_id: item.node_id,
        body: item.body || null,
      }));

    console.log(`Found ${issues.length} issues (total: ${data.total_count})`);

    return {
      issues,
      total_count: data.total_count,
    };
  } catch (error) {
    console.error('Error searching GitHub issues:', {
      error: error instanceof Error ? error.message : String(error),
      owner: options.owner || GITHUB_OWNER,
      repo: options.repo || GITHUB_REPO,
    });

    if (error instanceof Error && error.message.includes('Bad credentials')) {
      throw new Error('GitHub App authentication failed');
    }

    if (error instanceof Error && error.message.includes('Not Found')) {
      throw new Error(
        `GitHub-Repository ${options.owner || GITHUB_OWNER}/${options.repo || GITHUB_REPO} nicht gefunden`
      );
    }

    if (error instanceof Error && error.message.includes('rate limit')) {
      throw new Error('GitHub API-Limit erreicht');
    }

    throw new Error(`GitHub-Fehler: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
  }
}
