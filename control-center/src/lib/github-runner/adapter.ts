/**
 * E64.1: GitHub Runner Adapter - Core Implementation
 * 
 * Provides functions to dispatch, poll, and ingest GitHub Actions workflow runs.
 * E71.1: Enforces repo access policy via auth-wrapper
 */

import type { Pool } from 'pg';
import { getAuthenticatedToken, RepoAccessDeniedError } from '../github/auth-wrapper';
import {
  type DispatchWorkflowInput,
  type DispatchWorkflowResult,
  type PollRunInput,
  type PollRunResult,
  type IngestRunInput,
  type IngestRunResult,
  type WorkflowJob,
  type WorkflowArtifact,
  type WorkflowAnnotation,
  type GitHubRunStatus,
  type GitHubRunConclusion,
  normalizeGitHubRunStatus,
} from './types';
import {
  findExistingRun,
  createRunRecord,
  updateRunStatus,
  updateRunResult,
  findRunByGitHubRunId,
} from '../db/githubRuns';

const GH_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'codefactory-control-center';

/**
 * Dispatch a GitHub Actions workflow
 * Idempotent: returns existing run if one exists for the same correlation + workflow
 */
export async function dispatchWorkflow(
  pool: Pool,
  input: DispatchWorkflowInput
): Promise<DispatchWorkflowResult> {
  console.log('[dispatchWorkflow] Starting dispatch:', {
    correlationId: input.correlationId,
    workflow: input.workflowIdOrFile,
    repo: `${input.owner}/${input.repo}`,
    ref: input.ref,
  });

  // Check for existing run (idempotency)
  const existing = await findExistingRun(
    pool,
    input.correlationId,
    String(input.workflowIdOrFile),
    `${input.owner}/${input.repo}`
  );

  if (existing) {
    console.log('[dispatchWorkflow] Found existing run:', {
      recordId: existing.id,
      githubRunId: existing.githubRunId,
      status: existing.status,
    });

    return {
      runId: existing.githubRunId,
      runUrl: existing.runUrl,
      recordId: existing.id,
      isExisting: true,
    };
  }

  // E71.1: Get GitHub installation token with policy enforcement
  const { token } = await getAuthenticatedToken({
    owner: input.owner,
    repo: input.repo,
    branch: input.ref,
  });

  // Dispatch the workflow via GitHub API
  const dispatchUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/workflows/${encodeURIComponent(input.workflowIdOrFile)}/dispatches`;

  console.log('[dispatchWorkflow] Calling GitHub API:', { dispatchUrl, ref: input.ref });

  const dispatchRes = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: input.ref,
      inputs: input.inputs || {},
    }),
  });

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text().catch(() => '');
    throw new Error(
      `Failed to dispatch workflow (${dispatchRes.status}): ${text}`
    );
  }

  // GitHub workflow_dispatch returns 204 with no body
  // We need to poll for the run to get the run ID
  // Wait for run to appear with configurable delay and retries
  const initialDelayMs = parseInt(process.env.GITHUB_DISPATCH_DELAY_MS || '2000', 10);
  const maxRetries = parseInt(process.env.GITHUB_DISPATCH_MAX_RETRIES || '3', 10);
  const perPage = parseInt(process.env.GITHUB_DISPATCH_LOOKUP_PER_PAGE || '20', 10);
  
  let githubRunId: number | null = null;
  let runUrl: string | null = null;
  const dispatchTimestamp = new Date();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log(`[dispatchWorkflow] Retry ${attempt}/${maxRetries} to find workflow run`);
    }
    
    await new Promise((resolve) => setTimeout(resolve, initialDelayMs * (attempt + 1)));

    // List recent workflow runs to find the one we just dispatched
    // Use higher per_page to handle concurrent dispatches
    const runsUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/workflows/${encodeURIComponent(input.workflowIdOrFile)}/runs?per_page=${perPage}`;

    const runsRes = await fetch(runsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': USER_AGENT,
      },
    });

    if (!runsRes.ok) {
      const text = await runsRes.text().catch(() => '');
      throw new Error(
        `Failed to list workflow runs (${runsRes.status}): ${text}`
      );
    }

    const runsData = (await runsRes.json()) as {
      workflow_runs: Array<{
        id: number;
        html_url: string;
        status: GitHubRunStatus;
        created_at: string;
      }>;
    };

    // Find the most recent run created after dispatch time
    // This handles concurrent dispatches more reliably
    const candidateRuns = runsData.workflow_runs.filter(
      (run) => new Date(run.created_at) >= new Date(dispatchTimestamp.getTime() - 5000)
    );

    if (candidateRuns.length > 0) {
      const latestRun = candidateRuns[0];
      githubRunId = latestRun.id;
      runUrl = latestRun.html_url;
      break;
    }
  }

  if (!githubRunId || !runUrl) {
    throw new Error(
      `Workflow dispatched successfully but run not found after ${maxRetries} attempts. ` +
      `The workflow may be queued or GitHub API may be delayed. ` +
      `Try polling later with the workflow file: ${input.workflowIdOrFile} ref: ${input.ref}`
    );
  }

  console.log('[dispatchWorkflow] Workflow dispatched:', {
    githubRunId,
    runUrl,
  });

  // Create run record in database
  const record = await createRunRecord(pool, input, githubRunId, runUrl);

  return {
    runId: githubRunId,
    runUrl,
    recordId: record.id,
    isExisting: false,
  };
}

/**
 * Poll a GitHub Actions workflow run for status updates
 */
export async function pollRun(
  pool: Pool,
  input: PollRunInput
): Promise<PollRunResult> {
  console.log('[pollRun] Polling run:', {
    repo: `${input.owner}/${input.repo}`,
    runId: input.runId,
  });

  // E71.1: Get GitHub installation token with policy enforcement
  const { token } = await getAuthenticatedToken({
    owner: input.owner,
    repo: input.repo,
  });

  // Get workflow run details
  const runUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}`;

  const runRes = await fetch(runUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => '');
    throw new Error(
      `Failed to get workflow run (${runRes.status}): ${text}`
    );
  }

  const runData = (await runRes.json()) as {
    id: number;
    status: GitHubRunStatus;
    conclusion: GitHubRunConclusion;
    updated_at: string;
    created_at: string;
    run_started_at?: string;
  };

  const normalizedStatus = normalizeGitHubRunStatus(
    runData.status,
    runData.conclusion
  );

  console.log('[pollRun] Run status:', {
    runId: input.runId,
    status: runData.status,
    conclusion: runData.conclusion,
    normalizedStatus,
  });

  // Update run record in database
  const existingRecord = await findRunByGitHubRunId(pool, input.runId);
  if (existingRecord) {
    await updateRunStatus(
      pool,
      existingRecord.id,
      normalizedStatus,
      runData.updated_at
    );
  }

  return {
    runId: input.runId,
    status: runData.status,
    conclusion: runData.conclusion,
    updatedAt: runData.updated_at,
    createdAt: runData.created_at,
    runStartedAt: runData.run_started_at,
    normalizedStatus,
  };
}

/**
 * Ingest a completed GitHub Actions workflow run
 * Fetches jobs, artifacts, and annotations
 */
export async function ingestRun(
  pool: Pool,
  input: IngestRunInput
): Promise<IngestRunResult> {
  console.log('[ingestRun] Ingesting run:', {
    repo: `${input.owner}/${input.repo}`,
    runId: input.runId,
  });

  // E71.1: Get GitHub installation token with policy enforcement
  const { token } = await getAuthenticatedToken({
    owner: input.owner,
    repo: input.repo,
  });

  // Get workflow run details
  const runUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}`;

  const runRes = await fetch(runUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });

  if (!runRes.ok) {
    const text = await runRes.text().catch(() => '');
    throw new Error(
      `Failed to get workflow run (${runRes.status}): ${text}`
    );
  }

  const runData = (await runRes.json()) as {
    id: number;
    status: GitHubRunStatus;
    conclusion: GitHubRunConclusion;
    created_at: string;
    updated_at: string;
    run_started_at?: string;
    html_url: string;
    logs_url: string;
  };

  // Get jobs
  const jobsUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}/jobs`;

  const jobsRes = await fetch(jobsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });

  let jobs: WorkflowJob[] = [];
  if (jobsRes.ok) {
    const jobsData = (await jobsRes.json()) as {
      jobs: Array<{
        id: number;
        name: string;
        status: GitHubRunStatus;
        conclusion: GitHubRunConclusion;
        started_at?: string;
        completed_at?: string;
        steps?: Array<{ name: string }>;
      }>;
    };

    jobs = jobsData.jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      stepCount: job.steps?.length || 0,
    }));
  }

  // Get artifacts
  const artifactsUrl = `${GH_API}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/runs/${input.runId}/artifacts`;

  const artifactsRes = await fetch(artifactsUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });

  let artifacts: WorkflowArtifact[] = [];
  if (artifactsRes.ok) {
    const artifactsData = (await artifactsRes.json()) as {
      artifacts: Array<{
        id: number;
        name: string;
        size_in_bytes: number;
        archive_download_url: string;
        created_at: string;
        expires_at: string;
      }>;
    };

    artifacts = artifactsData.artifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      downloadUrl: artifact.archive_download_url,
      createdAt: artifact.created_at,
      expiresAt: artifact.expires_at,
    }));
  }

  // Get annotations (check runs)
  const annotations: WorkflowAnnotation[] = [];
  // TODO(E64.1-enhancement): Implement annotations via Check Runs API
  // Required API calls:
  // 1. GET /repos/{owner}/{repo}/commits/{head_sha}/check-runs
  // 2. Parse annotations from check_run.output.annotations[]
  // 3. Map to WorkflowAnnotation type (level, message, path, line)
  // Note: This requires additional API calls and should be implemented
  // as a follow-up enhancement to avoid initial implementation complexity.
  // For MVP, we return an empty array.

  // Calculate summary
  const successfulJobs = jobs.filter(
    (j) => j.conclusion === 'success' || j.conclusion === 'neutral'
  ).length;
  const failedJobs = jobs.filter(
    (j) =>
      j.conclusion === 'failure' ||
      j.conclusion === 'timed_out' ||
      j.conclusion === 'action_required'
  ).length;

  const durationMs = runData.run_started_at
    ? new Date(runData.updated_at).getTime() -
      new Date(runData.run_started_at).getTime()
    : undefined;

  const summary = {
    status: runData.status,
    conclusion: runData.conclusion,
    totalJobs: jobs.length,
    successfulJobs,
    failedJobs,
    durationMs,
  };

  // Find run record
  const existingRecord = await findRunByGitHubRunId(pool, input.runId);
  if (!existingRecord) {
    throw new Error(
      `No run record found for GitHub run ID ${input.runId}. Cannot ingest.`
    );
  }

  const result: IngestRunResult = {
    runId: input.runId,
    recordId: existingRecord.id,
    summary,
    jobs,
    artifacts,
    annotations,
    logsUrl: runData.logs_url,
  };

  // Update run record with ingested result
  await updateRunResult(pool, existingRecord.id, result);

  console.log('[ingestRun] Ingestion complete:', {
    runId: input.runId,
    recordId: existingRecord.id,
    totalJobs: jobs.length,
    artifacts: artifacts.length,
  });

  return result;
}
