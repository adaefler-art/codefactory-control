/**
 * Remediation Playbook Executor (E77.1 / I771)
 * 
 * Executes remediation playbooks with:
 * - Deny-by-default lawbook gating
 * - Evidence gating (require specific evidence before running)
 * - Strict idempotency (same inputs → same run)
 * - Deterministic planning
 * - Full audit trail
 * 
 * NON-NEGOTIABLES:
 * - Safety first: deny-by-default, no action without explicit allow
 * - Determinism: same inputs → same planned actions
 * - Idempotency: re-running with same key returns existing run result
 * - Full audit trail: planned → executed → verified
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  StepDefinition,
  StepContext,
  StepResult,
  ExecutePlaybookRequest,
  ExecutePlaybookResponse,
  PlannedRun,
  computeRunKey,
  computeInputsHash,
  checkAllEvidencePredicates,
  RemediationRunStatus,
  RemediationStepStatus,
  stableStringify,
} from './contracts/remediation-playbook';
import { Incident, Evidence } from './contracts/incident';
import { getIncidentDAO } from './db/incidents';
import { getRemediationPlaybookDAO } from './db/remediation-playbooks';
import { loadGuardrails } from '../lawbook/load';

// ========================================
// Lawbook Gating
// ========================================

/**
 * Lawbook gate configuration (stub for E79 integration)
 * In production, this would load from active lawbook version
 */
interface LawbookGateConfig {
  version: string;
  allowedPlaybooks: string[];
  allowedActionTypes: string[];
  deniedActionTypes: string[];
}

/**
 * Load lawbook gate configuration
 * For now, stubbed with config-based approach
 * TODO: Integrate with E79 lawbook service when available
 */
async function loadLawbookGateConfig(): Promise<LawbookGateConfig> {
  // Stub: Load from guardrails for version tracking
  const guardrails = await loadGuardrails();
  
  // Default deny-by-default configuration
  // In production, this would be loaded from lawbook service
  return {
    version: guardrails.hash.substring(0, 8), // Use guardrails hash as version
    allowedPlaybooks: [
      'restart-service',
      'scale-up',
      'notify-slack',
      'run-verification',
      'safe-retry-runner', // I772: Allow safe retry of GitHub workflows
      'rerun-post-deploy-verification', // I772: Allow re-run of E65.2 verification
      'redeploy-lkg', // I773: Allow redeploy Last Known Good (E77.3)
    ],
    allowedActionTypes: [
      'RESTART_SERVICE',
      'SCALE_UP',
      'NOTIFY_SLACK',
      'RUN_VERIFICATION',
    ],
    deniedActionTypes: [
      'SCALE_DOWN', // Can cause capacity issues
      'DRAIN_TASKS', // Can cause service disruption
    ],
  };
}

/**
 * Check if playbook is allowed by lawbook
 */
function isPlaybookAllowed(
  playbookId: string,
  lawbookConfig: LawbookGateConfig
): { allowed: boolean; reason?: string } {
  if (!lawbookConfig.allowedPlaybooks.includes(playbookId)) {
    return {
      allowed: false,
      reason: `Playbook '${playbookId}' is not in allowed list`,
    };
  }
  
  return { allowed: true };
}

/**
 * Check if action type is allowed by lawbook
 * Special handling: ROLLBACK_DEPLOY is allowed only for redeploy-lkg playbook
 */
function isActionTypeAllowed(
  actionType: string,
  lawbookConfig: LawbookGateConfig,
  playbookId?: string
): { allowed: boolean; reason?: string } {
  // Special case: ROLLBACK_DEPLOY is only allowed for redeploy-lkg playbook
  if (actionType === 'ROLLBACK_DEPLOY') {
    if (playbookId === 'redeploy-lkg') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Action type 'ROLLBACK_DEPLOY' is only allowed for redeploy-lkg playbook`,
    };
  }

  if (lawbookConfig.deniedActionTypes.includes(actionType)) {
    return {
      allowed: false,
      reason: `Action type '${actionType}' is explicitly denied`,
    };
  }
  
  if (!lawbookConfig.allowedActionTypes.includes(actionType)) {
    return {
      allowed: false,
      reason: `Action type '${actionType}' is not in allowed list`,
    };
  }
  
  return { allowed: true };
}

// ========================================
// Planning
// ========================================

/**
 * Plan remediation run deterministically
 * Same inputs → same plan
 */
function planRemediationRun(
  playbook: PlaybookDefinition,
  incident: Incident,
  inputs: Record<string, any>,
  lawbookVersion: string
): PlannedRun {
  const inputsHash = computeInputsHash(inputs);
  
  // Resolve step inputs deterministically
  const plannedSteps = playbook.steps.map(step => ({
    stepId: step.stepId,
    actionType: step.actionType,
    resolvedInputs: {
      ...inputs,
      incidentId: incident.id,
      incidentKey: incident.incident_key,
    },
  }));
  
  return {
    playbookId: playbook.id,
    playbookVersion: playbook.version,
    steps: plannedSteps,
    lawbookVersion,
    inputsHash,
  };
}

// ========================================
// Step Execution
// ========================================

/**
 * Step executor function type
 */
export type StepExecutorFunction = (
  pool: Pool,
  context: StepContext
) => Promise<StepResult>;

/**
 * Idempotency key function type
 */
export type IdempotencyKeyFunction = (context: StepContext) => string;

/**
 * Default step executor (stub)
 * In production, this would call actual remediation services
 */
async function executeStepActionDefault(
  pool: Pool,
  step: StepDefinition,
  context: StepContext
): Promise<StepResult> {
  // Stub implementation for playbooks without custom executors
  return {
    success: true,
    output: {
      stepId: step.stepId,
      actionType: step.actionType,
      executed: true,
      message: `Stub execution of ${step.actionType}`,
    },
  };
}

/**
 * Default step-level idempotency key computation
 */
function computeStepIdempotencyKeyDefault(
  step: StepDefinition,
  context: StepContext
): string {
  const paramsHash = computeInputsHash(context.inputs);
  return `${step.actionType}:${context.incidentKey}:${paramsHash}`;
}

// ========================================
// Main Executor
// ========================================

export class RemediationPlaybookExecutor {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Execute a remediation playbook
   * 
   * Features:
   * - Idempotent: same incident + playbook + inputs → same run
   * - Evidence gating: requires evidence predicates to be satisfied
   * - Lawbook gating: deny-by-default, explicit allow required
   * - Deterministic planning
   * - Full audit trail
   * 
   * @param request - The playbook execution request
   * @param playbook - The playbook definition
   * @param stepExecutors - Optional map of step executors (stepId -> executor function)
   * @param idempotencyKeyFns - Optional map of idempotency key functions (stepId -> key function)
   */
  async executePlaybook(
    request: ExecutePlaybookRequest,
    playbook: PlaybookDefinition,
    stepExecutors?: Map<string, StepExecutorFunction>,
    idempotencyKeyFns?: Map<string, IdempotencyKeyFunction>
  ): Promise<ExecutePlaybookResponse> {
    const incidentDAO = getIncidentDAO(this.pool);
    const remediationDAO = getRemediationPlaybookDAO(this.pool);
    
    // Step 1: Load incident + evidence
    const incident = await incidentDAO.getIncident(request.incidentId);
    if (!incident) {
      throw new Error(`Incident not found: ${request.incidentId}`);
    }
    
    const evidence = await incidentDAO.getEvidence(request.incidentId);
    
    // Step 2: Load lawbook configuration
    const lawbookConfig = await loadLawbookGateConfig();
    
    // Step 3: Lawbook gating - playbook allowed?
    const playbookCheck = isPlaybookAllowed(playbook.id, lawbookConfig);
    if (!playbookCheck.allowed) {
      // Create SKIPPED run with reason
      const inputsHash = computeInputsHash(request.inputs || {});
      const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
      
      const run = await remediationDAO.upsertRunByKey({
        run_key: runKey,
        incident_id: incident.id,
        playbook_id: playbook.id,
        playbook_version: playbook.version,
        status: 'SKIPPED',
        lawbook_version: lawbookConfig.version,
        inputs_hash: inputsHash,
        result_json: {
          skipReason: 'LAWBOOK_DENIED',
          message: playbookCheck.reason,
        },
      });
      
      return {
        runId: run.id,
        status: 'SKIPPED',
        skipReason: 'LAWBOOK_DENIED',
        message: playbookCheck.reason,
      };
    }
    
    // Step 4: Lawbook gating - action types allowed?
    for (const step of playbook.steps) {
      const actionCheck = isActionTypeAllowed(step.actionType, lawbookConfig, playbook.id);
      if (!actionCheck.allowed) {
        const inputsHash = computeInputsHash(request.inputs || {});
        const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
        
        const run = await remediationDAO.upsertRunByKey({
          run_key: runKey,
          incident_id: incident.id,
          playbook_id: playbook.id,
          playbook_version: playbook.version,
          status: 'SKIPPED',
          lawbook_version: lawbookConfig.version,
          inputs_hash: inputsHash,
          result_json: {
            skipReason: 'LAWBOOK_DENIED',
            message: actionCheck.reason,
          },
        });
        
        return {
          runId: run.id,
          status: 'SKIPPED',
          skipReason: 'LAWBOOK_DENIED',
          message: actionCheck.reason,
        };
      }
    }
    
    // Step 5: Evidence gating
    const evidenceCheck = checkAllEvidencePredicates(playbook.requiredEvidence, evidence);
    if (!evidenceCheck.satisfied) {
      const inputsHash = computeInputsHash(request.inputs || {});
      const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
      
      const run = await remediationDAO.upsertRunByKey({
        run_key: runKey,
        incident_id: incident.id,
        playbook_id: playbook.id,
        playbook_version: playbook.version,
        status: 'SKIPPED',
        lawbook_version: lawbookConfig.version,
        inputs_hash: inputsHash,
        result_json: {
          skipReason: 'EVIDENCE_MISSING',
          message: 'Required evidence not satisfied',
          missingEvidence: evidenceCheck.missing,
        },
      });
      
      return {
        runId: run.id,
        status: 'SKIPPED',
        skipReason: 'EVIDENCE_MISSING',
        message: 'Required evidence not satisfied',
      };
    }
    
    // Step 6: Plan execution deterministically
    const planned = planRemediationRun(
      playbook,
      incident,
      request.inputs || {},
      lawbookConfig.version
    );
    
    // Step 7: Compute run_key and check for existing run (idempotency)
    const runKey = computeRunKey(incident.incident_key, playbook.id, planned.inputsHash);
    
    const existingRun = await remediationDAO.getRunByKey(runKey);
    if (existingRun) {
      // Idempotent: return existing run
      const steps = await remediationDAO.getStepsForRun(existingRun.id);
      return {
        runId: existingRun.id,
        status: existingRun.status,
        message: 'Existing run returned (idempotent)',
        planned,
        steps,
      };
    }
    
    // Step 8: Create new run
    const run = await remediationDAO.upsertRunByKey({
      run_key: runKey,
      incident_id: incident.id,
      playbook_id: playbook.id,
      playbook_version: playbook.version,
      status: 'PLANNED',
      lawbook_version: lawbookConfig.version,
      inputs_hash: planned.inputsHash,
      planned_json: planned,
    });
    
    // Step 9: Execute steps sequentially
    const startTime = Date.now();
    let allSucceeded = true;
    const stepOutputs = new Map<string, any>(); // Track step outputs for chaining
    
    for (const plannedStep of planned.steps) {
      const stepDef = playbook.steps.find(s => s.stepId === plannedStep.stepId);
      if (!stepDef) {
        throw new Error(`Step definition not found: ${plannedStep.stepId}`);
      }
      
      // Build step context with previous step outputs
      const stepContext: StepContext = {
        incidentId: incident.id,
        incidentKey: incident.incident_key,
        runId: run.id,
        lawbookVersion: lawbookConfig.version,
        evidence,
        inputs: {
          ...plannedStep.resolvedInputs,
          ...Object.fromEntries(stepOutputs), // Include previous step outputs
        },
      };
      
      // Compute step idempotency key (use custom function if provided)
      const idempotencyKeyFn = idempotencyKeyFns?.get(stepDef.stepId) || 
        ((ctx: StepContext) => computeStepIdempotencyKeyDefault(stepDef, ctx));
      const stepIdempotencyKey = idempotencyKeyFn(stepContext);
      
      const step = await remediationDAO.createStep({
        remediation_run_id: run.id,
        step_id: stepDef.stepId,
        action_type: stepDef.actionType,
        status: 'PLANNED',
        idempotency_key: stepIdempotencyKey,
        input_json: stepContext.inputs,
      });
      
      // Execute step
      await remediationDAO.updateStepStatus(step.id, 'RUNNING', {
        started_at: new Date(),
      });
      
      try {
        // Get step executor (use custom if provided, otherwise use default)
        const executor = stepExecutors?.get(stepDef.stepId) || 
          ((pool: Pool, ctx: StepContext) => executeStepActionDefault(pool, stepDef, ctx));
        
        const result = await executor(this.pool, stepContext);
        
        if (result.success) {
          await remediationDAO.updateStepStatus(step.id, 'SUCCEEDED', {
            finished_at: new Date(),
            output_json: result.output,
          });
          
          // Store step output for next steps
          if (result.output) {
            stepOutputs.set(`${stepDef.stepId}StepOutput`, result.output);
          }
        } else {
          await remediationDAO.updateStepStatus(step.id, 'FAILED', {
            finished_at: new Date(),
            error_json: result.error,
          });
          allSucceeded = false;
          break; // Fail-fast
        }
      } catch (error: any) {
        await remediationDAO.updateStepStatus(step.id, 'FAILED', {
          finished_at: new Date(),
          error_json: {
            code: 'EXECUTION_ERROR',
            message: error.message,
            details: error.stack,
          },
        });
        allSucceeded = false;
        break; // Fail-fast
      }
    }
    
    // Step 10: Update run status
    const endTime = Date.now();
    const steps = await remediationDAO.getStepsForRun(run.id);
    
    const finalStatus: RemediationRunStatus = allSucceeded ? 'SUCCEEDED' : 'FAILED';
    await remediationDAO.updateRunStatus(run.id, finalStatus, {
      totalSteps: steps.length,
      successCount: steps.filter(s => s.status === 'SUCCEEDED').length,
      failedCount: steps.filter(s => s.status === 'FAILED').length,
      durationMs: endTime - startTime,
    });
    
    // Step 11: Return result
    return {
      runId: run.id,
      status: finalStatus,
      planned,
      steps,
    };
  }
}

/**
 * Get RemediationPlaybookExecutor instance
 */
export function getRemediationPlaybookExecutor(pool: Pool): RemediationPlaybookExecutor {
  return new RemediationPlaybookExecutor(pool);
}
