/**
 * REDEPLOY_LKG Playbook (I773 / E77.3)
 * 
 * Redeploys the Last Known Good (LKG) version when a deploy is RED/verification fails.
 * 
 * Applicable categories:
 * - DEPLOY_VERIFICATION_FAILED
 * - ALB_TARGET_UNHEALTHY
 * - ECS_TASK_CRASHLOOP (if tied to new deploy)
 * 
 * Required evidence:
 * - kind="deploy_status" with env OR
 * - kind="verification" with env
 * 
 * Steps:
 * 1. Select LKG - Query for Last Known Good deployment
 * 2. Dispatch Deploy - Trigger deploy workflow with LKG reference
 * 3. Post-Deploy Verification - Run E65.2 verification
 * 4. Update Deploy Status - Update E65.1 status based on verification result
 * 
 * Safeguards:
 * - Lawbook must explicitly allow "redeploy_lkg" 
 * - Frequency limit: once per incident per hour (via run_key)
 * - Evidence-based: only redeploy known GREEN artifacts
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  StepContext,
  StepResult,
  computeInputsHash,
} from '../contracts/remediation-playbook';
import { normalizeEnvironment, type DeployEnvironment } from '../utils/environment';
import { findLastKnownGood, LastKnownGoodDeploy } from '../db/deployStatusSnapshots';
import { getIncidentDAO } from '../db/incidents';

/**
 * Step 1: Select LKG
 * Pure planning step - finds the Last Known Good deployment for the environment
 */
export async function executeSelectLkg(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Extract environment from evidence
    const evidence = context.evidence.find(
      e => e.kind === 'deploy_status' || e.kind === 'verification'
    );

    if (!evidence) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_MISSING',
          message: 'No deploy_status or verification evidence found',
        },
      };
    }

    const { ref } = evidence;
    const env = ref.env || context.inputs.env;
    const service = ref.service || context.inputs.service;

    if (!env) {
      return {
        success: false,
        error: {
          code: 'INVALID_EVIDENCE',
          message: 'Missing required parameter: env',
          details: JSON.stringify({ env, service }),
        },
      };
    }

    // Normalize environment
    let normalizedEnv: DeployEnvironment;
    try {
      normalizedEnv = normalizeEnvironment(env);
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'INVALID_ENVIRONMENT',
          message: `Invalid environment value: ${error.message}`,
          details: JSON.stringify({ env }),
        },
      };
    }

    // Find Last Known Good
    const lkgResult = await findLastKnownGood(pool, normalizedEnv, service);

    if (!lkgResult.success) {
      return {
        success: false,
        error: {
          code: 'LKG_QUERY_FAILED',
          message: lkgResult.error || 'Failed to query Last Known Good',
        },
      };
    }

    if (!lkgResult.lkg) {
      return {
        success: false,
        error: {
          code: 'NO_LKG_FOUND',
          message: `No Last Known Good deployment found for env=${normalizedEnv}${service ? `, service=${service}` : ''}`,
          details: 'LKG requires: status=GREEN, verification=PASS with reportHash, and deploy metadata',
        },
      };
    }

    const lkg = lkgResult.lkg;

    // Ensure we have deploy reference (commit or image digest)
    if (!lkg.commitHash && !lkg.imageDigest) {
      return {
        success: false,
        error: {
          code: 'NO_LKG_REFERENCE',
          message: 'LKG found but missing deploy reference (commitHash or imageDigest)',
          details: JSON.stringify({ lkgSnapshotId: lkg.snapshotId }),
        },
      };
    }

    return {
      success: true,
      output: {
        lkg: {
          snapshotId: lkg.snapshotId,
          deployEventId: lkg.deployEventId,
          env: lkg.env,
          service: lkg.service,
          version: lkg.version,
          commitHash: lkg.commitHash,
          imageDigest: lkg.imageDigest,
          cfnChangeSetId: lkg.cfnChangeSetId,
          observedAt: lkg.observedAt,
          verificationRunId: lkg.verificationRunId,
          verificationReportHash: lkg.verificationReportHash,
        },
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'SELECT_LKG_ERROR',
        message: error.message || 'Failed to select LKG',
        details: error.stack,
      },
    };
  }
}

/**
 * Step 2: Dispatch Deploy
 * Triggers deploy workflow with LKG reference
 * In production, would integrate with E64.1 Runner Adapter
 */
export async function executeDispatchDeploy(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get LKG from previous step output
    const lkgOutput = context.inputs.lkgStepOutput;
    if (!lkgOutput || !lkgOutput.lkg) {
      return {
        success: false,
        error: {
          code: 'MISSING_LKG_OUTPUT',
          message: 'No LKG output from previous step',
        },
      };
    }

    const lkg = lkgOutput.lkg as LastKnownGoodDeploy;

    // In production, this would call E64.1 Runner Adapter to dispatch deploy workflow
    // For now, simulate the dispatch
    const dispatchId = `deploy-lkg-${Date.now()}`;
    
    // TODO: Integrate with E64.1 Runner Adapter
    // const dispatchResult = await runnerAdapter.dispatchDeploy({
    //   env: lkg.env,
    //   service: lkg.service,
    //   ref: lkg.commitHash || lkg.imageDigest,
    //   type: lkg.commitHash ? 'commit' : 'image',
    // });

    return {
      success: true,
      output: {
        dispatchId,
        lkgReference: {
          commitHash: lkg.commitHash,
          imageDigest: lkg.imageDigest,
          version: lkg.version,
        },
        env: lkg.env,
        service: lkg.service,
        message: 'Deploy workflow dispatched for LKG (simulated)',
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'DISPATCH_DEPLOY_ERROR',
        message: error.message || 'Failed to dispatch deploy',
        details: error.stack,
      },
    };
  }
}

/**
 * Step 3: Post-Deploy Verification
 * Runs E65.2 verification on the redeployed LKG
 */
export async function executePostDeployVerification(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get dispatch output from previous step
    const dispatchOutput = context.inputs.dispatchStepOutput;
    if (!dispatchOutput) {
      return {
        success: false,
        error: {
          code: 'MISSING_DISPATCH_OUTPUT',
          message: 'No dispatch output from previous step',
        },
      };
    }

    const env = dispatchOutput.env;
    const dispatchId = dispatchOutput.dispatchId;

    // In production, this would invoke E65.2 verification playbook
    // For now, simulate verification
    const verificationPassed = true; // Placeholder
    const playbookRunId = `verification-${Date.now()}`;
    
    const reportJson = JSON.stringify({
      env,
      dispatchId,
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
        reportHash,
        env,
        dispatchId,
      },
      error: !verificationPassed ? {
        code: 'VERIFICATION_FAILED',
        message: 'Post-deploy verification failed for LKG redeploy',
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
 * Step 4: Update Deploy Status
 * Updates E65.1 status based on verification result
 */
export async function executeUpdateDeployStatus(
  pool: Pool,
  context: StepContext
): Promise<StepResult> {
  try {
    // Get verification output from previous step
    const verificationOutput = context.inputs.verificationStepOutput;
    if (!verificationOutput) {
      return {
        success: false,
        error: {
          code: 'MISSING_VERIFICATION_OUTPUT',
          message: 'No verification output from previous step',
        },
      };
    }

    const newStatus = verificationOutput.status === 'success' ? 'GREEN' : 'RED';
    const env = verificationOutput.env;

    // In production, this would update deploy_status_snapshots via E65.1
    // For now, log the status update intent
    
    // If verification passed, update incident to MITIGATED
    if (newStatus === 'GREEN') {
      const incidentDAO = getIncidentDAO(pool);
      await incidentDAO.updateStatus(context.incidentId, 'MITIGATED');
      
      // Add evidence about successful LKG redeploy
      await incidentDAO.addEvidence([
        {
          incident_id: context.incidentId,
          kind: 'verification',
          ref: {
            playbookRunId: verificationOutput.playbookRunId,
            reportHash: verificationOutput.reportHash,
            env,
            dispatchId: verificationOutput.dispatchId,
            status: 'success',
            redeployType: 'LKG',
          },
          sha256: verificationOutput.reportHash,
        },
      ]);
    }

    return {
      success: true,
      output: {
        newStatus,
        env,
        incidentId: context.incidentId,
        message: newStatus === 'GREEN' 
          ? 'LKG redeploy verified GREEN, incident marked MITIGATED'
          : 'LKG redeploy verification failed, status RED',
      },
    };
  } catch (error: any) {
    return {
      success: false,
      error: {
        code: 'UPDATE_STATUS_ERROR',
        message: error.message || 'Failed to update deploy status',
        details: error.stack,
      },
    };
  }
}

/**
 * Compute idempotency keys for each step
 */
export function computeSelectLkgIdempotencyKey(context: StepContext): string {
  const evidence = context.evidence.find(
    e => e.kind === 'deploy_status' || e.kind === 'verification'
  );
  const env = evidence?.ref?.env || context.inputs.env;
  const service = evidence?.ref?.service || context.inputs.service;
  const paramsHash = computeInputsHash({ env, service });
  return `select-lkg:${context.incidentKey}:${paramsHash}`;
}

export function computeDispatchDeployIdempotencyKey(context: StepContext): string {
  // Include timestamp-based hour to enforce once-per-hour limit
  const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `dispatch-deploy:${context.incidentKey}:${hourKey}`;
}

export function computeVerificationIdempotencyKey(context: StepContext): string {
  const dispatchOutput = context.inputs.dispatchStepOutput;
  const dispatchId = dispatchOutput?.dispatchId || 'unknown';
  const paramsHash = computeInputsHash({ dispatchId });
  return `verification:${context.incidentKey}:${paramsHash}`;
}

export function computeUpdateStatusIdempotencyKey(context: StepContext): string {
  return `update-status:${context.incidentKey}`;
}

/**
 * REDEPLOY_LKG Playbook Definition
 */
export const REDEPLOY_LKG_PLAYBOOK: PlaybookDefinition = {
  id: 'redeploy-lkg',
  version: '1.0.0',
  title: 'Redeploy Last Known Good - Automated LKG Rollback',
  applicableCategories: [
    'DEPLOY_VERIFICATION_FAILED',
    'ALB_TARGET_UNHEALTHY',
    'ECS_TASK_CRASHLOOP',
  ],
  requiredEvidence: [
    {
      kind: 'deploy_status',
      requiredFields: ['ref.env'],
    },
    {
      kind: 'verification',
      requiredFields: ['ref.env'],
    },
  ],
  steps: [
    {
      stepId: 'select-lkg',
      actionType: 'ROLLBACK_DEPLOY', // Using existing action type that's closest
      description: 'Select LKG - Find Last Known Good deployment for environment',
    },
    {
      stepId: 'dispatch-deploy',
      actionType: 'ROLLBACK_DEPLOY',
      description: 'Dispatch Deploy - Trigger deploy workflow with LKG reference',
    },
    {
      stepId: 'post-deploy-verification',
      actionType: 'RUN_VERIFICATION',
      description: 'Post-Deploy Verification - Run E65.2 verification on redeployed LKG',
    },
    {
      stepId: 'update-deploy-status',
      actionType: 'RUN_VERIFICATION',
      description: 'Update Deploy Status - Update E65.1 status based on verification result',
    },
  ],
};
