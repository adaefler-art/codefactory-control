import { Octokit } from "octokit";

const GITHUB_OWNER = process.env.GITHUB_OWNER || "adaefler-art";
const GITHUB_REPO = process.env.GITHUB_REPO || "rhythmologicum-connect";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

/**
 * Minimal issue fields returned by listIssuesByLabel
 */
export interface MinimalIssue {
  id: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
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
 * Result from creating a GitHub issue
 */
export interface CreateIssueResult {
  html_url: string;
  number: number;
}

/**
 * Creates a new GitHub issue
 * @param params - Issue creation parameters
 * @returns The created issue with URL and number
 */
export async function createIssue(params: CreateIssueParams): Promise<CreateIssueResult> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const octokit = new Octokit({
    auth: GITHUB_TOKEN,
  });

  const { title, body, labels = [] } = params;

  console.log(`Creating GitHub issue in ${GITHUB_OWNER}/${GITHUB_REPO}...`);
  const { data: issue } = await octokit.rest.issues.create({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    title,
    body,
    labels,
  });

  console.log(`GitHub issue created: ${issue.html_url}`);

  return {
    html_url: issue.html_url,
    number: issue.number,
  };
}

/**
 * Lists issues by a specific label
 * @param label - The label to filter issues by
 * @returns Array of minimal issue objects
 */
export async function listIssuesByLabel(label: string): Promise<MinimalIssue[]> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const octokit = new Octokit({
    auth: GITHUB_TOKEN,
  });

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
}
