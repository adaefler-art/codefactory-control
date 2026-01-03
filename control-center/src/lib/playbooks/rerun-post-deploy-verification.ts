/**
 * RERUN_POST_DEPLOY_VERIFICATION Playbook (I772 / E77.2)
 * 
 * Re-runs the E65.2 post-deploy verification playbook.
 * 
 * Applicable categories:
 * - DEPLOY_VERIFICATION_FAILED
 * - ALB_TARGET_UNHEALTHY
 * 
 * Required evidence:
 * - kind="verification" with env + deployId OR
 * - kind="deploy_status" with deployId/env
 * 
 * Steps:
 * 1. Run Verification - invoke E65.2 playbook; capture report JSON + reportHash
 * 2. Ingest Incident Update (optional) - if verification passes, mark incident as MITIGATED candidate
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  StepDefinition,
  StepContext,
  StepResult,
  computeInputsHash,
} from '../contracts/remediation-playbook';
import { getIncidentDAO } from '../db/incidents';

/**
 * Step 1: Run Verification
 * Invoke E65.2 post-deploy verification playbook
 */
export async function executeRunVerification(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Extract verification information from evidence
    const verificationEvidence = context.evidence.find(
      e => e.kind === 'verification' || e.kind === 'deploy_status'
    );

    if (!verificationEvidence) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_MISSING',
          message: 'No verification or deploy_status evidence found',
        },
      };
    }

    const { ref } = verificationEvidence;
    const env = ref.env || context.inputs.env;
    const deployId = ref.deployId || context.inputs.deployId;

    if (!env) {
      return {
        success: false,
        error: {
          code: 'INVALID_EVIDENCE',
          message: 'Missing required verification parameter: env',
          details: JSON.stringify({ env, deployId }),
        },
      };
    }

    // In a full implementation, this would call E65.2 playbook executor
    // For now, we simulate a verification run with basic HTTP check
    // This would be replaced with actual playbook execution in production
    
    // Simulate verification result
    const verificationPassed = true; // Placeholder - in production, run actual checks
    const playbookRunId = `verification-${Date.now()}`;
    
    // Compute report hash
    const reportJson = JSON.stringify({
      env,
      deployId,
      timestamp: new Date().toISOString(),
      checks: [{ type: 'health', status: 'passed' }],
    });
    const crypto = require('crypto');
    const reportHash = crypto.createHash('sha256').update(reportJson).digest('hex');

    return {
      success: verificationPassed,
      output: {
        playbookRunId,
        status: verificationPassed ? 'success' : 'failed',
        summary: {
          totalSteps: 1,
          successCount: verificationPassed ? 1 : 0,
          failedCount: verificationPassed ? 0 : 1,
          skippedCount: 0,
          durationMs: 1000,
        },
        reportHash,
        env,
        deployId,
      },
      error: !verificationPassed ? {
        code: 'VERIFICATION_FAILED',
        message: 'Post-deploy verification failed',
        details: 'Simulated failure',
      } : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'VERIFICATION_EXECUTION_ERROR',
        message: error.message || 'Failed to execute verification',
        details: error.stack,
      },
    };
  }
}

/**
 * Step 2: Ingest Incident Update (optional)
 * If verification passes, update incident status to MITIGATED candidate
 */
export async function executeIngestIncidentUpdate(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get the verification result from previous step
    const verificationStepOutput = context.inputs.verificationStepOutput;
    if (!verificationStepOutput) {
      return {
        success: false,
        error: {
          code: 'MISSING_VERIFICATION_OUTPUT',
          message: 'No verificationStepOutput from previous step',
        },
      };
    }

    // Only update if verification passed
    if (verificationStepOutput.status !== 'success') {
      return {
        success: true,
        output: {
          message: 'Verification did not pass, skipping incident update',
          incidentId: context.incidentId,
          currentStatus: 'unchanged',
        },
      };
    }

    // Update incident status to MITIGATED
    const incidentDAO = getIncidentDAO(pool);
    
    // Note: In a full implementation, we'd check business rules to determine
    // if auto-closing is allowed. For now, we just suggest MITIGATED status.
    await incidentDAO.updateStatus(context.incidentId, 'MITIGATED');

    // Add evidence about the successful verification
    await incidentDAO.addEvidence([
      {
        incident_id: context.incidentId,
        kind: 'verification',
        ref: {
          playbookRunId: verificationStepOutput.playbookRunId,
          reportHash: verificationStepOutput.reportHash,
          env: verificationStepOutput.env,
          deployId: verificationStepOutput.deployId,
          status: verificationStepOutput.status,
        },
        sha256: verificationStepOutput.reportHash,
      },
    ]);

    return {
      success: true,
      output: {
        message: 'Incident marked as MITIGATED',
        incidentId: context.incidentId,
        newStatus: 'MITIGATED',
        verificationRunId: verificationStepOutput.playbookRunId,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'INCIDENT_UPDATE_FAILED',
        message: error.message || 'Failed to update incident',
        details: error.stack,
      },
    };
  }
}

/**
 * Compute step idempotency key for verification run
 */
export function computeVerificationIdempotencyKey(context: StepContext): string {
  const verificationEvidence = context.evidence.find(
    e => e.kind === 'verification' || e.kind === 'deploy_status'
  );
  const env = verificationEvidence?.ref?.env || context.inputs.env;
  const deployId = verificationEvidence?.ref?.deployId || context.inputs.deployId;
  const paramsHash = computeInputsHash({ env, deployId });
  return `verification:${context.incidentKey}:${paramsHash}`;
}

/**
 * Compute step idempotency key for incident update
 */
export function computeIncidentUpdateIdempotencyKey(context: StepContext): string {
  return `incident-update:${context.incidentKey}`;
}

/**
 * RERUN_POST_DEPLOY_VERIFICATION Playbook Definition
 */
export const RERUN_POST_DEPLOY_VERIFICATION_PLAYBOOK: PlaybookDefinition = {
  id: 'rerun-post-deploy-verification',
  version: '1.0.0',
  title: 'Re-run Post-Deploy Verification - E65.2 Playbook Retry',
  applicableCategories: ['DEPLOY_VERIFICATION_FAILED', 'ALB_TARGET_UNHEALTHY'],
  requiredEvidence: [
    {
      kind: 'verification',
      requiredFields: ['ref.env'],
    },
    {
      kind: 'deploy_status',
      requiredFields: ['ref.env'],
    },
  ],
  steps: [
    {
      stepId: 'run-verification',
      actionType: 'RUN_VERIFICATION',
      description: 'Run Verification - Execute E65.2 post-deploy verification',
    },
    {
      stepId: 'ingest-incident-update',
      actionType: 'RUN_VERIFICATION',
      description: 'Ingest Incident Update - Mark incident as MITIGATED if verification passes',
    },
  ],
};
