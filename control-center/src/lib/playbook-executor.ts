/**
 * Playbook Executor
 * 
 * Executes playbook steps and collects evidence.
 * Supports HTTP checks with timeout and retry logic.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  PlaybookStep,
  PlaybookStepResult,
  PlaybookRunResult,
  HttpCheckStep,
  DbCheckStep,
  LogCheckStep,
  StepEvidence,
  StepError,
  StepStatus,
  RunStatus,
  RunSummary,
} from './contracts/playbook';
import {
  insertPlaybookRun,
  updatePlaybookRunStatus,
  insertPlaybookRunStep,
  updatePlaybookRunStepStatus,
  getPlaybookRun,
} from './db/playbookRuns';

/**
 * Execute HTTP check step
 */
async function executeHttpCheck(
  step: HttpCheckStep,
  variables: Record<string, string>
): Promise<{ evidence: StepEvidence; error: StepError | null }> {
  // Replace variables in URL
  let url = step.url;
  for (const [key, value] of Object.entries(variables)) {
    url = url.replace(`\${${key}}`, value);
  }

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), step.timeoutSeconds * 1000);

    const response = await fetch(url, {
      method: step.method,
      headers: step.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;
    const body = await response.text();

    // Check expected status
    if (response.status !== step.expectedStatus) {
      return {
        evidence: {
          type: 'http_check',
          status: response.status,
          responseTime,
          body: body.substring(0, 1000), // Limit body size
        },
        error: {
          code: 'STATUS_MISMATCH',
          message: `Expected status ${step.expectedStatus}, got ${response.status}`,
        },
      };
    }

    // Check expected body content
    if (step.expectedBodyIncludes && !body.includes(step.expectedBodyIncludes)) {
      return {
        evidence: {
          type: 'http_check',
          status: response.status,
          responseTime,
          body: body.substring(0, 1000),
        },
        error: {
          code: 'BODY_MISMATCH',
          message: `Response body does not include expected content: "${step.expectedBodyIncludes}"`,
        },
      };
    }

    return {
      evidence: {
        type: 'http_check',
        status: response.status,
        responseTime,
        message: 'HTTP check passed',
      },
      error: null,
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;

    if (error.name === 'AbortError') {
      return {
        evidence: {
          type: 'http_check',
          responseTime,
        },
        error: {
          code: 'TIMEOUT',
          message: `Request timed out after ${step.timeoutSeconds} seconds`,
        },
      };
    }

    return {
      evidence: {
        type: 'http_check',
        responseTime,
      },
      error: {
        code: 'FETCH_ERROR',
        message: error.message || 'HTTP request failed',
        details: error.stack,
      },
    };
  }
}

/**
 * Execute DB check step (stub for future implementation)
 */
async function executeDbCheck(
  step: DbCheckStep
): Promise<{ evidence: StepEvidence; error: StepError | null }> {
  return {
    evidence: {
      type: 'db_check',
      message: 'DB check not yet implemented (stub)',
    },
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'DB check is not yet implemented',
    },
  };
}

/**
 * Execute log check step (stub for future implementation)
 */
async function executeLogCheck(
  step: LogCheckStep
): Promise<{ evidence: StepEvidence; error: StepError | null }> {
  return {
    evidence: {
      type: 'log_check',
      message: 'Log check not yet implemented (stub)',
    },
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Log check is not yet implemented',
    },
  };
}

/**
 * Execute a single playbook step with retry logic
 */
async function executeStep(
  step: PlaybookStep,
  stepIndex: number,
  runId: string,
  pool: Pool,
  variables: Record<string, string>
): Promise<PlaybookStepResult> {
  const maxAttempts = step.retries + 1;
  let lastEvidence: StepEvidence | null = null;
  let lastError: StepError | null = null;

  // Insert step record
  const stepRow = await insertPlaybookRunStep(pool, {
    runId,
    stepId: step.id,
    stepIndex,
    status: 'pending',
  });

  // Mark as running
  await updatePlaybookRunStepStatus(pool, stepRow.id, 'running', {
    startedAt: new Date(),
  });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let result: { evidence: StepEvidence; error: StepError | null };

      switch (step.input.type) {
        case 'http_check':
          result = await executeHttpCheck(step.input, variables);
          break;
        case 'db_check':
          result = await executeDbCheck(step.input);
          break;
        case 'log_check':
          result = await executeLogCheck(step.input);
          break;
        default:
          throw new Error(`Unknown step type: ${(step.input as any).type}`);
      }

      lastEvidence = result.evidence;
      lastError = result.error;

      // If no error, mark as success
      if (!result.error) {
        await updatePlaybookRunStepStatus(pool, stepRow.id, 'success', {
          completedAt: new Date(),
          evidence: result.evidence,
        });

        return {
          stepId: step.id,
          stepIndex,
          status: 'success',
          startedAt: stepRow.started_at,
          completedAt: new Date().toISOString(),
          evidence: result.evidence,
          error: null,
        };
      }

      // If error and no more retries, fail
      if (attempt === maxAttempts - 1) {
        break;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    } catch (error: any) {
      lastError = {
        code: 'EXECUTION_ERROR',
        message: error.message || 'Step execution failed',
        details: error.stack,
      };
    }
  }

  // All retries exhausted, mark as failed
  await updatePlaybookRunStepStatus(pool, stepRow.id, 'failed', {
    completedAt: new Date(),
    evidence: lastEvidence,
    error: lastError,
  });

  return {
    stepId: step.id,
    stepIndex,
    status: 'failed',
    startedAt: stepRow.started_at,
    completedAt: new Date().toISOString(),
    evidence: lastEvidence,
    error: lastError,
  };
}

/**
 * Calculate run summary from step results
 */
function calculateSummary(
  steps: PlaybookStepResult[],
  startedAt: Date,
  completedAt: Date
): RunSummary {
  return {
    totalSteps: steps.length,
    successCount: steps.filter(s => s.status === 'success').length,
    failedCount: steps.filter(s => s.status === 'failed').length,
    skippedCount: steps.filter(s => s.status === 'skipped').length,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  };
}

/**
 * Execute a complete playbook
 */
export async function executePlaybook(
  pool: Pool,
  playbook: PlaybookDefinition,
  env: 'stage' | 'prod',
  variables: Record<string, string>
): Promise<PlaybookRunResult> {
  // Create run record
  const run = await insertPlaybookRun(pool, {
    playbookId: playbook.metadata.id,
    playbookVersion: playbook.metadata.version,
    env,
  });

  const startedAt = new Date();

  // Update to running status
  await updatePlaybookRunStatus(pool, run.id, 'running', {
    startedAt,
  });

  const stepResults: PlaybookStepResult[] = [];

  try {
    // Execute each step sequentially
    for (let i = 0; i < playbook.steps.length; i++) {
      const step = playbook.steps[i];
      const result = await executeStep(step, i, run.id, pool, variables);
      stepResults.push(result);

      // Stop on first failure (fail-fast)
      if (result.status === 'failed') {
        break;
      }
    }

    const completedAt = new Date();
    const summary = calculateSummary(stepResults, startedAt, completedAt);

    // Determine final status
    const finalStatus: RunStatus = stepResults.some(s => s.status === 'failed')
      ? 'failed'
      : 'success';

    // Update run with final status
    await updatePlaybookRunStatus(pool, run.id, finalStatus, {
      completedAt,
      summary,
    });

    return {
      id: run.id,
      playbookId: playbook.metadata.id,
      playbookVersion: playbook.metadata.version,
      env,
      status: finalStatus,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      summary,
      steps: stepResults,
      createdAt: run.created_at,
    };
  } catch (error: any) {
    const completedAt = new Date();
    const summary = calculateSummary(stepResults, startedAt, completedAt);

    // Mark as failed due to execution error
    await updatePlaybookRunStatus(pool, run.id, 'failed', {
      completedAt,
      summary,
    });

    throw error;
  }
}

/**
 * Get playbook run result from database
 */
export async function getPlaybookRunResult(
  pool: Pool,
  runId: string
): Promise<PlaybookRunResult | null> {
  const data = await getPlaybookRun(pool, runId);

  if (!data) {
    return null;
  }

  const { run, steps } = data;

  const stepResults: PlaybookStepResult[] = steps.map(step => ({
    stepId: step.step_id,
    stepIndex: step.step_index,
    status: step.status as StepStatus,
    startedAt: step.started_at,
    completedAt: step.completed_at,
    evidence: step.evidence,
    error: step.error,
  }));

  return {
    id: run.id,
    playbookId: run.playbook_id,
    playbookVersion: run.playbook_version,
    env: run.env as 'stage' | 'prod',
    status: run.status as RunStatus,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    summary: run.summary,
    steps: stepResults,
    createdAt: run.created_at,
  };
}
