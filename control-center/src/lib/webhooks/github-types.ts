/**
 * GitHub Webhook Payload Type Definitions
 * 
 * Simplified type definitions for GitHub webhook payloads.
 * These are not exhaustive but cover the fields we use.
 */

export interface GitHubRepository {
  name: string;
  owner?: {
    login: string;
  };
  default_branch?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  labels?: Array<{ name: string }>;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body?: string;
  state: string;
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  html_url?: string;
  head?: {
    ref: string;
  };
  base?: {
    ref: string;
  };
}

export interface GitHubCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion?: string;
  head_sha: string;
}

export interface GitHubSender {
  login: string;
}

export interface GitHubWebhookPayload {
  action?: string;
  repository?: GitHubRepository;
  sender?: GitHubSender;
  issue?: GitHubIssue;
  pull_request?: GitHubPullRequest;
  check_run?: GitHubCheckRun;
  [key: string]: unknown;
}
