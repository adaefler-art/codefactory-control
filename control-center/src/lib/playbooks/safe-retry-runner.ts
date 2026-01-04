/**
 * SAFE_RETRY_RUNNER Playbook (I772 / E77.2)
 * 
 * Re-dispatches and re-runs a failed GitHub Action workflow run deterministically.
 * 
 * Applicable categories:
 * - RUNNER_WORKFLOW_FAILED
 * 
 * Required evidence:
 * - kind="runner" or "github_run" with runId and workflow ref
 * 
 * Steps:
 * 1. Dispatch Runner - call E64.1 adapter dispatch with same workflow inputs
 * 2. Poll Runner - call E64.1 poll until completion or timeout
 * 3. Ingest Runner - call E64.1 ingest; attach artifacts refs as evidence
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  StepDefinition,
  StepContext,
  StepResult,
  computeInputsHash,
} from '../contracts/remediation-playbook';
import { dispatchWorkflow, pollRun, ingestRun } from '../github-runner/adapter';
import { isRepoAllowed } from '../github/auth-wrapper';

/**
 * Step 1: Dispatch Runner
 * Re-dispatch the workflow with the same inputs (or a safe subset)
 * 
 * HARDENING (E77.2):
 * - Enforces I711 repo allowlist before dispatch
 * - Requires deterministic ref (headSha or specific ref, no default branch)
 * - Sanitizes outputs to prevent secret persistence
 */
export async function executeDispatchRunner(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Extract workflow information from evidence
    const runnerEvidence = context.evidence.find(
      e => e.kind === 'runner' || e.kind === 'github_run'
    );

    if (!runnerEvidence) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_MISSING',
          message: 'No runner or github_run evidence found',
        },
      };
    }

    const { ref } = runnerEvidence;
    const owner = ref.owner || context.inputs.owner;
    const repo = ref.repo || context.inputs.repo;
    const workflowIdOrFile = ref.workflowIdOrFile || ref.workflow || context.inputs.workflow;
    const sourceRunId = ref.runId || context.inputs.sourceRunId;

    if (!owner || !repo || !workflowIdOrFile) {
      return {
        success: false,
        error: {
          code: 'INVALID_EVIDENCE',
          message: 'Missing required workflow parameters (owner, repo, workflow)',
          details: JSON.stringify({ owner, repo, workflowIdOrFile }),
        },
      };
    }

    // HARDENING: Enforce I711 repo allowlist (fail-closed)
    if (!isRepoAllowed(owner, repo)) {
      return {
        success: false,
        error: {
          code: 'REPO_NOT_ALLOWED',
          message: `Repository ${owner}/${repo} is not in the allowlist`,
          details: JSON.stringify({ owner, repo }),
        },
      };
    }

    // HARDENING: Require deterministic ref (headSha or explicit ref, no default branch)
    // Prefer headSha for exact commit pinning, fall back to explicit ref
    const headSha = ref.headSha || ref.head_sha;
    const explicitRef = ref.ref || ref.branch;
    
    if (!headSha && !explicitRef) {
      return {
        success: false,
        error: {
          code: 'DETERMINISM_REQUIRED',
          message: 'Evidence must include headSha or explicit ref for deterministic retry',
          details: JSON.stringify({ 
            availableFields: Object.keys(ref),
            required: ['headSha OR ref/branch'],
          }),
        },
      };
    }

    // Use headSha if available (most deterministic), otherwise use explicit ref
    const gitRef = headSha || explicitRef;

    // Dispatch the workflow
    const result = await dispatchWorkflow(pool, {
      correlationId: `${context.incidentKey}:retry:${sourceRunId}`,
      owner,
      repo,
      workflowIdOrFile,
      ref: gitRef!,
      inputs: ref.inputs || {},
    });

    // HARDENING: Return only minimal, sanitized fields (no raw API responses)
    return {
      success: true,
      output: {
        newRunId: result.runId,
        runUrl: result.runUrl,
        recordId: result.recordId,
        isExisting: result.isExisting,
        // Explicitly omit any raw response data
      },
    };
  } catch (error: any) {
    // Check if this is a repo access denied error
    if (error.code === 'REPO_NOT_ALLOWED') {
      return {
        success: false,
        error: {
          code: 'REPO_NOT_ALLOWED',
          message: error.message,
          details: error.details,
        },
      };
    }
    
    return {
      success: false,
      error: {
        code: 'DISPATCH_FAILED',
        message: error.message || 'Failed to dispatch workflow',
        details: error.stack,
      },
    };
  }
}

/**
 * Step 2: Poll Runner
 * Poll the newly dispatched run until completion or timeout
 * 
 * HARDENING (E77.2):
 * - Returns only minimal, sanitized fields (no raw API responses)
 */
export async function executePollRunner(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get the runId from previous step output
    const dispatchStepOutput = context.inputs.dispatchStepOutput;
    if (!dispatchStepOutput || !dispatchStepOutput.newRunId) {
      return {
        success: false,
        error: {
          code: 'MISSING_RUN_ID',
          message: 'No newRunId from dispatch step',
        },
      };
    }

    const runnerEvidence = context.evidence.find(
      e => e.kind === 'runner' || e.kind === 'github_run'
    );
    const { ref } = runnerEvidence!;
    const owner = ref.owner || context.inputs.owner;
    const repo = ref.repo || context.inputs.repo;

    const maxPollAttempts = 30; // ~5 minutes with 10s interval
    const pollIntervalMs = 10000; // 10 seconds

    let pollResult;
    let attempts = 0;

    while (attempts < maxPollAttempts) {
      pollResult = await pollRun(pool, {
        owner,
        repo,
        runId: dispatchStepOutput.newRunId,
      });

      // Check if run is completed
      if (pollResult.normalizedStatus === 'completed') {
        // HARDENING: Return only minimal, sanitized fields
        return {
          success: true,
          output: {
            runId: pollResult.runId,
            status: pollResult.status,
            conclusion: pollResult.conclusion,
            normalizedStatus: pollResult.normalizedStatus,
            updatedAt: pollResult.updatedAt,
            // Explicitly omit raw API response data
          },
        };
      }

      attempts++;
      if (attempts < maxPollAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    // Timeout reached
    return {
      success: false,
      error: {
        code: 'POLL_TIMEOUT',
        message: `Workflow run did not complete within ${maxPollAttempts * pollIntervalMs / 1000}s`,
        details: JSON.stringify({
          runId: dispatchStepOutput.newRunId,
          lastStatus: pollResult?.status,
          lastNormalizedStatus: pollResult?.normalizedStatus,
        }),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'POLL_FAILED',
        message: error.message || 'Failed to poll workflow run',
        details: error.stack,
      },
    };
  }
}

/**
 * Step 3: Ingest Runner
 * Ingest the completed run and attach artifacts as evidence
 * 
 * HARDENING (E77.2):
 * - Returns only minimal, sanitized artifact metadata (no download URLs with tokens)
 */
export async function executeIngestRunner(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get the runId from poll step output
    const pollStepOutput = context.inputs.pollStepOutput;
    if (!pollStepOutput || !pollStepOutput.runId) {
      return {
        success: false,
        error: {
          code: 'MISSING_RUN_ID',
          message: 'No runId from poll step',
        },
      };
    }

    const runnerEvidence = context.evidence.find(
      e => e.kind === 'runner' || e.kind === 'github_run'
    );
    const { ref } = runnerEvidence!;
    const owner = ref.owner || context.inputs.owner;
    const repo = ref.repo || context.inputs.repo;

    // Ingest the run
    const result = await ingestRun(pool, {
      owner,
      repo,
      runId: pollStepOutput.runId,
    });

    // HARDENING: Return only minimal, sanitized artifact metadata
    // Omit download URLs (which may contain temporary tokens)
    return {
      success: true,
      output: {
        runId: result.runId,
        recordId: result.recordId,
        summary: {
          status: result.summary.status,
          conclusion: result.summary.conclusion,
          totalJobs: result.summary.totalJobs,
          successfulJobs: result.summary.successfulJobs,
          failedJobs: result.summary.failedJobs,
          durationMs: result.summary.durationMs,
        },
        jobsCount: result.jobs.length,
        artifactsCount: result.artifacts.length,
        // Sanitized artifact metadata (no download URLs)
        artifacts: result.artifacts.map(a => ({
          id: a.id,
          name: a.name,
          sizeInBytes: a.sizeInBytes,
          // Omit downloadUrl - it contains temporary tokens
        })),
        // Omit logsUrl - it contains temporary tokens
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'INGEST_FAILED',
        message: error.message || 'Failed to ingest workflow run',
        details: error.stack,
      },
    };
  }
}

/**
 * Compute step idempotency key for dispatch
 */
export function computeDispatchIdempotencyKey(context: StepContext): string {
  const runnerEvidence = context.evidence.find(
    e => e.kind === 'runner' || e.kind === 'github_run'
  );
  const sourceRunId = runnerEvidence?.ref?.runId || context.inputs.sourceRunId;
  const paramsHash = computeInputsHash({
    owner: context.inputs.owner,
    repo: context.inputs.repo,
    workflow: context.inputs.workflow,
    sourceRunId,
  });
  return `dispatch:${context.incidentKey}:${paramsHash}`;
}

/**
 * Compute step idempotency key for poll
 */
export function computePollIdempotencyKey(context: StepContext): string {
  const dispatchStepOutput = context.inputs.dispatchStepOutput;
  const newRunId = dispatchStepOutput?.newRunId;
  return `poll:${context.incidentKey}:${newRunId}`;
}

/**
 * Compute step idempotency key for ingest
 */
export function computeIngestIdempotencyKey(context: StepContext): string {
  const pollStepOutput = context.inputs.pollStepOutput;
  const runId = pollStepOutput?.runId;
  return `ingest:${context.incidentKey}:${runId}`;
}

/**
 * SAFE_RETRY_RUNNER Playbook Definition
 */
export const SAFE_RETRY_RUNNER_PLAYBOOK: PlaybookDefinition = {
  id: 'safe-retry-runner',
  version: '1.0.0',
  title: 'Safe Retry Runner - Re-dispatch Failed GitHub Workflow',
  applicableCategories: ['RUNNER_WORKFLOW_FAILED'],
  requiredEvidence: [
    {
      kind: 'runner',
      requiredFields: ['ref.runId', 'ref.owner', 'ref.repo', 'ref.workflowIdOrFile'],
    },
    {
      kind: 'github_run',
      requiredFields: ['ref.runId', 'ref.owner', 'ref.repo', 'ref.workflow'],
    },
  ],
  steps: [
    {
      stepId: 'dispatch-runner',
      actionType: 'RUN_VERIFICATION',
      description: 'Dispatch Runner - Re-dispatch the workflow',
    },
    {
      stepId: 'poll-runner',
      actionType: 'RUN_VERIFICATION',
      description: 'Poll Runner - Wait for run completion',
    },
    {
      stepId: 'ingest-runner',
      actionType: 'RUN_VERIFICATION',
      description: 'Ingest Runner - Collect artifacts and results',
    },
  ],
};
