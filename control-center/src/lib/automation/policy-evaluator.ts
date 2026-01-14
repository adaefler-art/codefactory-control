/**
 * Automation Policy Evaluator (E87.2)
 * 
 * Deterministic policy evaluation with enforcement:
 * - Environment checks (allowedEnvs)
 * - Cooldown enforcement
 * - Rate limiting (maxRunsPerWindow)
 * - Idempotency key generation
 * - Approval requirements (E87.1 integration)
 * 
 * Implements fail-closed semantics: deny if policy not found or invalid.
 */

import { Pool } from 'pg';
import { getActiveLawbook } from '../db/lawbook';
import { 
  countExecutionsInWindow, 
  getLastExecution,
  recordPolicyExecution
} from '../db/automationPolicyAudit';
import {
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  findPolicyForAction,
  generateIdempotencyKey,
  hashIdempotencyKey,
  generateActionFingerprint,
  isActionAllowedInEnv,
  validateRateLimitConfig,
} from '../lawbook/automation-policy';
import { logger } from '../logger';

// ========================================
// Policy Evaluator
// ========================================

/**
 * Evaluate automation policy for a given action
 * 
 * Returns deterministic allow/deny decision with:
 * - Cooldown enforcement
 * - Rate limiting
 * - Idempotency key
 * - Approval requirements
 * 
 * Fail-closed: denies if no policy found or evaluation fails.
 */
export async function evaluateAutomationPolicy(
  context: PolicyEvaluationContext,
  pool?: Pool
): Promise<PolicyEvaluationResult> {
  const requestId = context.requestId;

  try {
    // Get active lawbook
    const lawbookResult = await getActiveLawbook('AFU9-LAWBOOK', pool);
    
    if (!lawbookResult.success || !lawbookResult.data) {
      // Fail-closed: no lawbook configured
      logger.warn('No active lawbook found - deny by default', { requestId }, 'PolicyEvaluator');
      
      return createDenyResult(
        context,
        'No active lawbook configured (fail-closed)',
        null,
        null,
        null
      );
    }

    const lawbook = lawbookResult.data.lawbook_json;
    const lawbookVersion = lawbook.lawbookVersion;
    const lawbookHash = lawbookResult.data.lawbook_hash;

    // Find policy for action type
    const policy = findPolicyForAction(context.actionType, lawbook.automationPolicy);

    if (!policy) {
      // Fail-closed: no policy defined for this action
      logger.warn('No policy found for action type - deny by default', {
        requestId,
        actionType: context.actionType,
      }, 'PolicyEvaluator');

      return createDenyResult(
        context,
        `No policy defined for action type '${context.actionType}' (fail-closed)`,
        null,
        lawbookVersion,
        lawbookHash
      );
    }

    // Validate policy configuration
    const configValidation = validateRateLimitConfig(policy);
    if (!configValidation.valid) {
      logger.error('Invalid policy configuration', {
        requestId,
        actionType: context.actionType,
        error: configValidation.error,
      }, 'PolicyEvaluator');

      return createDenyResult(
        context,
        `Invalid policy configuration: ${configValidation.error}`,
        policy.actionType,
        lawbookVersion,
        lawbookHash
      );
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(
      policy.idempotencyKeyTemplate,
      context.actionContext
    );
    const idempotencyKeyHash = hashIdempotencyKey(idempotencyKey);

    // Check environment
    if (!isActionAllowedInEnv(policy, context.deploymentEnv)) {
      const envReason = context.deploymentEnv
        ? `Action not allowed in environment '${context.deploymentEnv}'`
        : 'Action not allowed in unspecified environment';
      
      logger.info('Action denied by environment policy', {
        requestId,
        actionType: context.actionType,
        deploymentEnv: context.deploymentEnv,
        allowedEnvs: policy.allowedEnvs,
      }, 'PolicyEvaluator');

      return createDenyResult(
        context,
        `${envReason} (allowed: ${policy.allowedEnvs.join(', ')})`,
        policy.actionType,
        lawbookVersion,
        lawbookHash,
        idempotencyKey,
        idempotencyKeyHash,
        {
          allowedEnvs: policy.allowedEnvs,
        }
      );
    }

    // Check approval requirement
    if (policy.requiresApproval && !context.hasApproval) {
      logger.info('Action requires approval', {
        requestId,
        actionType: context.actionType,
        hasApproval: context.hasApproval,
      }, 'PolicyEvaluator');

      return {
        allow: false,
        decision: 'denied',
        reason: 'Action requires explicit approval (E87.1) - not granted',
        nextAllowedAt: null, // Can retry immediately after approval
        requiresApproval: true,
        idempotencyKey,
        idempotencyKeyHash,
        policyName: policy.actionType,
        lawbookVersion,
        lawbookHash,
        enforcementData: {
          allowedEnvs: policy.allowedEnvs,
        },
      };
    }

    // Check cooldown
    if (policy.cooldownSeconds && policy.cooldownSeconds > 0) {
      const lastExecution = await getLastExecution(
        context.actionType,
        context.targetIdentifier,
        pool
      );

      if (lastExecution && lastExecution.decision === 'allowed') {
        const lastExecutionTime = new Date(lastExecution.created_at);
        const cooldownEndTime = new Date(
          lastExecutionTime.getTime() + policy.cooldownSeconds * 1000
        );
        const now = new Date();

        if (now < cooldownEndTime) {
          logger.info('Action denied by cooldown', {
            requestId,
            actionType: context.actionType,
            targetIdentifier: context.targetIdentifier,
            lastExecutionAt: lastExecutionTime.toISOString(),
            cooldownEndAt: cooldownEndTime.toISOString(),
            cooldownSeconds: policy.cooldownSeconds,
          }, 'PolicyEvaluator');

          return createDenyResult(
            context,
            `Cooldown active: ${policy.cooldownSeconds}s since last execution`,
            policy.actionType,
            lawbookVersion,
            lawbookHash,
            idempotencyKey,
            idempotencyKeyHash,
            {
              cooldownSeconds: policy.cooldownSeconds,
              allowedEnvs: policy.allowedEnvs,
            },
            cooldownEndTime
          );
        }
      }
    }

    // Check rate limit
    if (policy.maxRunsPerWindow && policy.windowSeconds) {
      const executionCount = await countExecutionsInWindow(
        context.actionType,
        context.targetIdentifier,
        policy.windowSeconds,
        pool
      );

      if (executionCount >= policy.maxRunsPerWindow) {
        logger.info('Action denied by rate limit', {
          requestId,
          actionType: context.actionType,
          targetIdentifier: context.targetIdentifier,
          executionCount,
          maxRunsPerWindow: policy.maxRunsPerWindow,
          windowSeconds: policy.windowSeconds,
        }, 'PolicyEvaluator');

        // Calculate when the oldest execution in window will expire
        const nextAllowedAt = new Date(Date.now() + policy.windowSeconds * 1000);

        return createDenyResult(
          context,
          `Rate limit exceeded: ${executionCount}/${policy.maxRunsPerWindow} executions in ${policy.windowSeconds}s window`,
          policy.actionType,
          lawbookVersion,
          lawbookHash,
          idempotencyKey,
          idempotencyKeyHash,
          {
            maxRunsPerWindow: policy.maxRunsPerWindow,
            windowSeconds: policy.windowSeconds,
            currentRunCount: executionCount,
            allowedEnvs: policy.allowedEnvs,
          },
          nextAllowedAt
        );
      }
    }

    // All checks passed - allow
    logger.info('Action allowed by policy', {
      requestId,
      actionType: context.actionType,
      targetIdentifier: context.targetIdentifier,
      policyName: policy.actionType,
    }, 'PolicyEvaluator');

    return {
      allow: true,
      decision: 'allowed',
      reason: 'All policy checks passed',
      nextAllowedAt: null,
      requiresApproval: false,
      idempotencyKey,
      idempotencyKeyHash,
      policyName: policy.actionType,
      lawbookVersion,
      lawbookHash,
      enforcementData: {
        cooldownSeconds: policy.cooldownSeconds,
        maxRunsPerWindow: policy.maxRunsPerWindow,
        windowSeconds: policy.windowSeconds,
        allowedEnvs: policy.allowedEnvs,
      },
    };
  } catch (error) {
    // Fail-closed on errors
    logger.error(
      'Policy evaluation failed - deny by default',
      error instanceof Error ? error : new Error(String(error)),
      { requestId, actionType: context.actionType },
      'PolicyEvaluator'
    );

    return createDenyResult(
      context,
      `Policy evaluation failed: ${error instanceof Error ? error.message : String(error)} (fail-closed)`,
      null,
      null,
      null
    );
  }
}

// ========================================
// Helper: Create Deny Result
// ========================================

function createDenyResult(
  context: PolicyEvaluationContext,
  reason: string,
  policyName: string | null,
  lawbookVersion: string | null,
  lawbookHash: string | null,
  idempotencyKey?: string,
  idempotencyKeyHash?: string,
  enforcementData?: Record<string, unknown>,
  nextAllowedAt?: Date
): PolicyEvaluationResult {
  // Generate idempotency key if not provided
  const finalIdempotencyKey = idempotencyKey || generateIdempotencyKey([], context.actionContext);
  const finalIdempotencyKeyHash = idempotencyKeyHash || hashIdempotencyKey(finalIdempotencyKey);

  return {
    allow: false,
    decision: 'denied',
    reason,
    nextAllowedAt: nextAllowedAt || null,
    requiresApproval: false,
    idempotencyKey: finalIdempotencyKey,
    idempotencyKeyHash: finalIdempotencyKeyHash,
    policyName,
    lawbookVersion: lawbookVersion || undefined,
    lawbookHash: lawbookHash || undefined,
    enforcementData: enforcementData || {},
  };
}

// ========================================
// Evaluate and Record (Convenience)
// ========================================

/**
 * Evaluate policy and record the decision in audit trail
 * 
 * Combines evaluation + audit recording in a single operation.
 */
export async function evaluateAndRecordPolicy(
  context: PolicyEvaluationContext,
  pool?: Pool
): Promise<PolicyEvaluationResult> {
  const result = await evaluateAutomationPolicy(context, pool);

  // Generate action fingerprint
  const actionFingerprint = generateActionFingerprint(
    context.actionType,
    context.targetIdentifier,
    context.actionContext
  );

  // Record in audit trail
  await recordPolicyExecution(
    {
      requestId: context.requestId,
      sessionId: context.sessionId,
      actionType: context.actionType,
      actionFingerprint,
      targetType: context.targetType,
      targetIdentifier: context.targetIdentifier,
      evaluationResult: result,
      contextData: context.actionContext,
      deploymentEnv: context.deploymentEnv,
      actor: context.actor,
    },
    pool
  );

  return result;
}
