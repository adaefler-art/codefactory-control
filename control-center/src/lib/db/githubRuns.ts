/**
 * E64.1: GitHub Runner Adapter - Database Functions
 * 
 * Functions for persisting and querying GitHub workflow run records.
 */

import type { Pool } from 'pg';
import type {
  GitHubRunRecord,
  DispatchWorkflowInput,
  IngestRunResult,
  NormalizedRunStatus,
} from '../github-runner/types';

/**
 * Find an existing run by correlation ID and workflow
 * Used for idempotency: if a run already exists for this correlation + workflow, return it
 */
export async function findExistingRun(
  pool: Pool,
  correlationId: string,
  workflowId: string,
  repo: string
): Promise<GitHubRunRecord | null> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      issue_id as "correlationId",
      title,
      playbook_id as "workflowId",
      status,
      spec_json as "specJson",
      result_json as "resultJson",
      created_at as "createdAt",
      started_at as "startedAt",
      finished_at as "finishedAt"
    FROM runs
    WHERE issue_id = $1
      AND playbook_id = $2
      AND spec_json->>'repo' = $3
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [correlationId, workflowId, repo]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const spec = row.specJson || {};
  const resultData = row.resultJson || {};

  return {
    id: row.id,
    correlationId: row.correlationId,
    githubRunId: spec.githubRunId || resultData.runId || 0,
    repo: spec.repo || repo,
    workflowId: row.workflowId || workflowId,
    ref: spec.ref || 'main',
    status: row.status as NormalizedRunStatus,
    inputs: spec.inputs || {},
    result: resultData.runId ? resultData : undefined,
    runUrl: spec.runUrl || '',
    dispatchedAt: row.createdAt,
    lastPolledAt: row.startedAt,
    ingestedAt: row.finishedAt,
    title: row.title,
  };
}

/**
 * Create a new run record
 */
export async function createRunRecord(
  pool: Pool,
  input: DispatchWorkflowInput,
  githubRunId: number,
  runUrl: string
): Promise<GitHubRunRecord> {
  const now = new Date().toISOString();
  const runId = `gh-${input.correlationId}-${Date.now()}`;
  
  const spec = {
    owner: input.owner,
    repo: input.repo,
    workflowId: String(input.workflowIdOrFile),
    ref: input.ref,
    inputs: input.inputs || {},
    githubRunId,
    runUrl,
  };

  const result = await pool.query<any>(
    `
    INSERT INTO runs (
      id,
      issue_id,
      title,
      playbook_id,
      status,
      spec_json,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING
      id,
      issue_id as "correlationId",
      title,
      playbook_id as "workflowId",
      status,
      spec_json as "specJson",
      created_at as "createdAt"
    `,
    [
      runId,
      input.correlationId,
      input.title || `GitHub Workflow: ${input.workflowIdOrFile}`,
      String(input.workflowIdOrFile),
      'QUEUED',
      JSON.stringify(spec),
      now,
    ]
  );

  const row = result.rows[0];
  const storedSpec = row.specJson || spec;

  return {
    id: row.id,
    correlationId: row.correlationId,
    githubRunId,
    repo: `${input.owner}/${input.repo}`,
    workflowId: String(input.workflowIdOrFile),
    ref: input.ref,
    status: row.status as NormalizedRunStatus,
    inputs: input.inputs || {},
    runUrl,
    dispatchedAt: row.createdAt,
    title: row.title,
  };
}

/**
 * Update run status after polling
 */
export async function updateRunStatus(
  pool: Pool,
  runId: string,
  status: NormalizedRunStatus,
  updatedAt: string
): Promise<void> {
  const now = new Date().toISOString();
  
  await pool.query(
    `
    UPDATE runs
    SET
      status = $1,
      started_at = CASE
        WHEN started_at IS NULL AND $1 IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')
        THEN $2
        ELSE started_at
      END,
      finished_at = CASE
        WHEN $1 IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
        THEN $2
        ELSE finished_at
      END,
      spec_json = jsonb_set(
        spec_json,
        '{lastPolledAt}',
        to_jsonb($3::text)
      )
    WHERE id = $4
    `,
    [status, updatedAt, now, runId]
  );
}

/**
 * Update run with ingested result
 */
export async function updateRunResult(
  pool: Pool,
  runId: string,
  result: IngestRunResult
): Promise<void> {
  const now = new Date().toISOString();
  
  await pool.query(
    `
    UPDATE runs
    SET
      result_json = $1,
      finished_at = CASE
        WHEN finished_at IS NULL
        THEN $2
        ELSE finished_at
      END,
      spec_json = jsonb_set(
        spec_json,
        '{ingestedAt}',
        to_jsonb($2::text)
      )
    WHERE id = $3
    `,
    [JSON.stringify(result), now, runId]
  );
}

/**
 * Find a run record by internal ID
 */
export async function findRunById(
  pool: Pool,
  runId: string
): Promise<GitHubRunRecord | null> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      issue_id as "correlationId",
      title,
      playbook_id as "workflowId",
      status,
      spec_json as "specJson",
      result_json as "resultJson",
      created_at as "createdAt",
      started_at as "startedAt",
      finished_at as "finishedAt"
    FROM runs
    WHERE id = $1
    `,
    [runId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const spec = row.specJson || {};
  const resultData = row.resultJson || {};

  return {
    id: row.id,
    correlationId: row.correlationId,
    githubRunId: spec.githubRunId || resultData.runId || 0,
    repo: spec.repo || '',
    workflowId: row.workflowId || '',
    ref: spec.ref || '',
    status: row.status as NormalizedRunStatus,
    inputs: spec.inputs || {},
    result: resultData.runId ? resultData : undefined,
    runUrl: spec.runUrl || '',
    dispatchedAt: row.createdAt,
    lastPolledAt: spec.lastPolledAt || row.startedAt,
    ingestedAt: spec.ingestedAt || row.finishedAt,
    title: row.title,
  };
}

/**
 * Find a run record by GitHub run ID
 */
export async function findRunByGitHubRunId(
  pool: Pool,
  githubRunId: number
): Promise<GitHubRunRecord | null> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      issue_id as "correlationId",
      title,
      playbook_id as "workflowId",
      status,
      spec_json as "specJson",
      result_json as "resultJson",
      created_at as "createdAt",
      started_at as "startedAt",
      finished_at as "finishedAt"
    FROM runs
    WHERE spec_json->>'githubRunId' = $1
    LIMIT 1
    `,
    [String(githubRunId)]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const spec = row.specJson || {};
  const resultData = row.resultJson || {};

  return {
    id: row.id,
    correlationId: row.correlationId,
    githubRunId: spec.githubRunId || resultData.runId || 0,
    repo: spec.repo || '',
    workflowId: row.workflowId || '',
    ref: spec.ref || '',
    status: row.status as NormalizedRunStatus,
    inputs: spec.inputs || {},
    result: resultData.runId ? resultData : undefined,
    runUrl: spec.runUrl || '',
    dispatchedAt: row.createdAt,
    lastPolledAt: spec.lastPolledAt || row.startedAt,
    ingestedAt: spec.ingestedAt || row.finishedAt,
    title: row.title,
  };
}

/**
 * List runs by correlation ID (e.g., all runs for an issue)
 */
export async function listRunsByCorrelationId(
  pool: Pool,
  correlationId: string
): Promise<GitHubRunRecord[]> {
  const result = await pool.query<any>(
    `
    SELECT
      id,
      issue_id as "correlationId",
      title,
      playbook_id as "workflowId",
      status,
      spec_json as "specJson",
      result_json as "resultJson",
      created_at as "createdAt",
      started_at as "startedAt",
      finished_at as "finishedAt"
    FROM runs
    WHERE issue_id = $1
    ORDER BY created_at DESC
    `,
    [correlationId]
  );

  return result.rows.map((row) => {
    const spec = row.specJson || {};
    const resultData = row.resultJson || {};

    return {
      id: row.id,
      correlationId: row.correlationId,
      githubRunId: spec.githubRunId || resultData.runId || 0,
      repo: spec.repo || '',
      workflowId: row.workflowId || '',
      ref: spec.ref || '',
      status: row.status as NormalizedRunStatus,
      inputs: spec.inputs || {},
      result: resultData.runId ? resultData : undefined,
      runUrl: spec.runUrl || '',
      dispatchedAt: row.createdAt,
      lastPolledAt: spec.lastPolledAt || row.startedAt,
      ingestedAt: spec.ingestedAt || row.finishedAt,
      title: row.title,
    };
  });
}
