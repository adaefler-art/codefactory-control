/**
 * Remediation Playbook Executor (E77.1 / I771)
 * 
 * Executes remediation playbooks with:
 * - Deny-by-default lawbook gating (via E79.4 Guardrail Gates)
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
import { requireActiveLawbookVersion } from './lawbook-version-helper';
import { getActiveLawbook } from './db/lawbook';
import { parseLawbook } from '../lawbook/schema';
import {
  gatePlaybookAllowed,
  gateActionAllowed,
  gateIdempotencyKeyFormat,
  GateVerdict,
} from './guardrail-gates';

// ========================================
// Lawbook Gating (E79.4 / I794)
// ========================================

/**
 * Load active lawbook for gating operations
 * E79.3 / I793: Uses requireActiveLawbookVersion() for fail-closed behavior.
 * E79.4 / I794: Returns parsed LawbookV1 for use with guardrail gates.
 * 
 * @returns LawbookV1 | null (null triggers deny-by-default in gates)
 */
async function loadActiveLawbookForGating(pool?: Pool) {
  try {
    // E79.3: Require active lawbook exists (fail-closed)
    const lawbookVersion = await requireActiveLawbookVersion(pool);
    
    // Load the full lawbook document
    const lawbookResult = await getActiveLawbook('AFU9-LAWBOOK', pool);
    
    if (!lawbookResult.success || !lawbookResult.data) {
      // No active lawbook - gates will deny by default
      return null;
    }
    
    // Parse and validate lawbook
    const lawbook = parseLawbook(lawbookResult.data.lawbook_json);
    return lawbook;
  } catch (error) {
    console.error('[Remediation] Failed to load active lawbook for gating:', error);
    // On error, return null to trigger deny-by-default in gates
    return null;
  }
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
// Audit Event Emission (E77.5 / I775)
// ========================================

/**
 * Emit audit event safely
 * 
 * Failures in audit emission should NOT break the main remediation flow.
 * Log warnings but continue execution.
 * 
 * @param dao - The remediation DAO
 * @param input - The audit event input
 */
async function emitAuditEventSafe(
  dao: any,
  input: {
    remediation_run_id: string;
    incident_id: string;
    event_type: string;
    lawbook_version: string;
    payload_json: Record<string, any>;
  }
): Promise<void> {
  try {
    await dao.createAuditEvent({
      ...input,
      payload_hash: '', // Will be computed by DAO
    });
  } catch (error: any) {
    // Log warning but don't throw - audit failures should not break execution
    console.warn('[audit] Failed to emit audit event:', {
      event_type: input.event_type,
      remediation_run_id: input.remediation_run_id,
      error: error.message,
    });
  }
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
    
    // Step 2: Load lawbook for gating (E79.3 / I793: fail-closed, E79.4 / I794: guardrail gates)
    const lawbook = await loadActiveLawbookForGating(this.pool);
    const lawbookVersion = lawbook?.lawbookVersion || 'NONE';
    
    // Extract evidence kinds for gating
    const evidenceKinds = evidence.map(e => e.kind);
    
    // Step 3: Lawbook gating - playbook allowed? (E79.4 / I794: use guardrail gates)
    const playbookVerdict = gatePlaybookAllowed(
      {
        playbookId: playbook.id,
        incidentCategory: incident.category,
        evidenceKinds,
      },
      lawbook
    );
    
    if (playbookVerdict.verdict !== 'ALLOW') {
      // Create SKIPPED run with verdict details
      const inputsHash = computeInputsHash(request.inputs || {});
      const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
      
      // Extract primary denial reason
      const primaryReason = playbookVerdict.reasons.find(r => r.severity === 'ERROR') || playbookVerdict.reasons[0];
      
      const run = await remediationDAO.upsertRunByKey({
        run_key: runKey,
        incident_id: incident.id,
        playbook_id: playbook.id,
        playbook_version: playbook.version,
        status: 'SKIPPED',
        lawbook_version: lawbookVersion,
        inputs_hash: inputsHash,
        result_json: {
          skipReason: 'LAWBOOK_DENIED',
          message: primaryReason?.message || 'Playbook not allowed',
          gateVerdict: playbookVerdict, // Store full verdict for audit
        },
      });
      
      return {
        runId: run.id,
        status: 'SKIPPED',
        skipReason: 'LAWBOOK_DENIED',
        message: primaryReason?.message || 'Playbook not allowed',
      };
    }
    
    // Step 4: Lawbook gating - action types allowed? (E79.4 / I794: use guardrail gates)
    for (const step of playbook.steps) {
      // Special case: ROLLBACK_DEPLOY is only allowed for redeploy-lkg playbook
      // This is a playbook-specific constraint, not a general lawbook policy
      if (step.actionType === 'ROLLBACK_DEPLOY' && playbook.id !== 'redeploy-lkg') {
        const inputsHash = computeInputsHash(request.inputs || {});
        const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
        
        const run = await remediationDAO.upsertRunByKey({
          run_key: runKey,
          incident_id: incident.id,
          playbook_id: playbook.id,
          playbook_version: playbook.version,
          status: 'SKIPPED',
          lawbook_version: lawbookVersion,
          inputs_hash: inputsHash,
          result_json: {
            skipReason: 'LAWBOOK_DENIED',
            message: `Action type 'ROLLBACK_DEPLOY' is only allowed for redeploy-lkg playbook`,
          },
        });
        
        return {
          runId: run.id,
          status: 'SKIPPED',
          skipReason: 'LAWBOOK_DENIED',
          message: `Action type 'ROLLBACK_DEPLOY' is only allowed for redeploy-lkg playbook`,
        };
      }
      
      const actionVerdict = gateActionAllowed({ actionType: step.actionType }, lawbook);
      
      if (actionVerdict.verdict !== 'ALLOW') {
        const inputsHash = computeInputsHash(request.inputs || {});
        const runKey = computeRunKey(incident.incident_key, playbook.id, inputsHash);
        
        // Extract primary denial reason
        const primaryReason = actionVerdict.reasons.find(r => r.severity === 'ERROR') || actionVerdict.reasons[0];
        
        const run = await remediationDAO.upsertRunByKey({
          run_key: runKey,
          incident_id: incident.id,
          playbook_id: playbook.id,
          playbook_version: playbook.version,
          status: 'SKIPPED',
          lawbook_version: lawbookVersion,
          inputs_hash: inputsHash,
          result_json: {
            skipReason: 'LAWBOOK_DENIED',
            message: primaryReason?.message || `Action ${step.actionType} not allowed`,
            gateVerdict: actionVerdict, // Store full verdict for audit
          },
        });
        
        return {
          runId: run.id,
          status: 'SKIPPED',
          skipReason: 'LAWBOOK_DENIED',
          message: primaryReason?.message || `Action ${step.actionType} not allowed`,
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
        lawbook_version: lawbookVersion,
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
      lawbookVersion
    );
    
    // Step 7: Compute run_key and check for existing run (idempotency)
    const runKey = computeRunKey(incident.incident_key, playbook.id, planned.inputsHash);
    
    // E79.4 / I794: Validate run_key format
    const runKeyVerdict = gateIdempotencyKeyFormat({ key: runKey });
    if (runKeyVerdict.verdict !== 'ALLOW') {
      const primaryReason = runKeyVerdict.reasons.find(r => r.severity === 'ERROR') || runKeyVerdict.reasons[0];
      throw new Error(`Invalid run_key format: ${primaryReason?.message}`);
    }
    
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
      lawbook_version: lawbookVersion,
      inputs_hash: planned.inputsHash,
      planned_json: planned,
    });
    
    // Emit PLANNED audit event
    await emitAuditEventSafe(remediationDAO, {
      remediation_run_id: run.id,
      incident_id: incident.id,
      event_type: 'PLANNED',
      lawbook_version: lawbookVersion,
      payload_json: {
        playbookId: playbook.id,
        playbookVersion: playbook.version,
        inputsHash: planned.inputsHash,
        stepsCount: planned.steps.length,
        steps: planned.steps.map(s => ({
          stepId: s.stepId,
          actionType: s.actionType,
        })),
      },
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
        lawbookVersion: lawbookVersion,
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
      
      // E79.4 / I794: Validate idempotency key format
      const keyFormatVerdict = gateIdempotencyKeyFormat({ key: stepIdempotencyKey });
      if (keyFormatVerdict.verdict !== 'ALLOW') {
        const primaryReason = keyFormatVerdict.reasons.find(r => r.severity === 'ERROR') || keyFormatVerdict.reasons[0];
        throw new Error(`Invalid idempotency key format for step ${stepDef.stepId}: ${primaryReason?.message}`);
      }
      
      const step = await remediationDAO.createStep({
        remediation_run_id: run.id,
        step_id: stepDef.stepId,
        action_type: stepDef.actionType,
        status: 'PLANNED',
        idempotency_key: stepIdempotencyKey,
        input_json: stepContext.inputs,
      });
      
      // Emit STEP_STARTED audit event
      await emitAuditEventSafe(remediationDAO, {
        remediation_run_id: run.id,
        incident_id: incident.id,
        event_type: 'STEP_STARTED',
        lawbook_version: lawbookVersion,
        payload_json: {
          stepId: stepDef.stepId,
          actionType: stepDef.actionType,
          idempotencyKey: stepIdempotencyKey,
          inputsHash: computeInputsHash(stepContext.inputs),
        },
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
          
          // Emit STEP_FINISHED audit event (success)
          await emitAuditEventSafe(remediationDAO, {
            remediation_run_id: run.id,
            incident_id: incident.id,
            event_type: 'STEP_FINISHED',
            lawbook_version: lawbookVersion,
            payload_json: {
              stepId: stepDef.stepId,
              actionType: stepDef.actionType,
              status: 'SUCCEEDED',
              outputSummary: result.output ? {
                hasOutput: true,
                outputHash: computeInputsHash(result.output),
              } : { hasOutput: false },
            },
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
          
          // Emit STEP_FINISHED audit event (failure)
          await emitAuditEventSafe(remediationDAO, {
            remediation_run_id: run.id,
            incident_id: incident.id,
            event_type: 'STEP_FINISHED',
            lawbook_version: lawbookVersion,
            payload_json: {
              stepId: stepDef.stepId,
              actionType: stepDef.actionType,
              status: 'FAILED',
              errorCode: result.error?.code,
              errorMessage: result.error?.message,
            },
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
        
        // Emit STEP_FINISHED audit event (exception)
        await emitAuditEventSafe(remediationDAO, {
          remediation_run_id: run.id,
          incident_id: incident.id,
          event_type: 'STEP_FINISHED',
          lawbook_version: lawbookVersion,
          payload_json: {
            stepId: stepDef.stepId,
            actionType: stepDef.actionType,
            status: 'FAILED',
            errorCode: 'EXECUTION_ERROR',
            errorMessage: error.message,
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
    
    // Emit STATUS_UPDATED audit event
    await emitAuditEventSafe(remediationDAO, {
      remediation_run_id: run.id,
      incident_id: incident.id,
      event_type: 'STATUS_UPDATED',
      lawbook_version: lawbookVersion,
      payload_json: {
        status: finalStatus,
        totalSteps: steps.length,
        successCount: steps.filter(s => s.status === 'SUCCEEDED').length,
        failedCount: steps.filter(s => s.status === 'FAILED').length,
        durationMs: endTime - startTime,
      },
    });
    
    // Emit final COMPLETED or FAILED audit event
    await emitAuditEventSafe(remediationDAO, {
      remediation_run_id: run.id,
      incident_id: incident.id,
      event_type: finalStatus === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED',
      lawbook_version: lawbookVersion,
      payload_json: {
        status: finalStatus,
        totalSteps: steps.length,
        successCount: steps.filter(s => s.status === 'SUCCEEDED').length,
        failedCount: steps.filter(s => s.status === 'FAILED').length,
        durationMs: endTime - startTime,
      },
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
