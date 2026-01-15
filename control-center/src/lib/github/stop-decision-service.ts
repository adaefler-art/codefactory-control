/**
 * Stop Decision Service (E84.4)
 * 
 * Lawbook-gated stop conditions to prevent infinite loops in automated
 * workflow reruns. Evaluates context and lawbook rules to determine
 * whether to CONTINUE, HOLD, or KILL automation.
 * 
 * Reference: E84.4 - Stop Conditions + HOLD Rules
 */

import { Pool } from 'pg';
import { getPool } from '../db';
import { logger } from '../logger';
import { LawbookV1, LawbookStopRules } from '../../lawbook/schema';
import {
  StopDecisionContext,
  StopDecisionV1,
  StopDecisionType,
  StopReasonCode,
  RecommendedNextStep,
} from '../types/stop-decision';

// Import the lawbook version helper to get active lawbook data
import { getActiveLawbookData } from '../lawbook-version-helper';

/**
 * Get lawbook hash from environment or use default
 */
function getLawbookHash(): string {
  return process.env.LAWBOOK_HASH || 'v1.0.0-dev';
}

/**
 * Get deployment environment
 */
function getDeploymentEnv(): 'staging' | 'prod' {
  const env = process.env.DEPLOY_ENV;
  if (env === 'prod' || env === 'production') {
    return 'prod';
  }
  return 'staging';
}

/**
 * Get default stop rules if lawbook doesn't specify them
 */
function getDefaultStopRules(): LawbookStopRules {
  return {
    maxRerunsPerJob: 2,
    maxTotalRerunsPerPr: 5,
    maxWaitMinutesForGreen: 60,
    cooldownMinutes: 5,
    blockOnFailureClasses: ['build deterministic', 'lint error', 'syntax error'],
    noSignalChangeThreshold: 2,
  };
}

/**
 * Load stop rules from lawbook or use defaults
 */
async function loadStopRules(): Promise<LawbookStopRules> {
  try {
    const lawbookData = await getActiveLawbookData();
    if (lawbookData && lawbookData.stopRules) {
      return lawbookData.stopRules;
    }
  } catch (error) {
    logger.warn('Failed to load lawbook, using default stop rules', error as Error, {});
  }
  
  return getDefaultStopRules();
}

/**
 * Check if failure class should block reruns
 */
function isBlockedFailureClass(
  failureClass: string | undefined,
  blockList: string[]
): boolean {
  if (!failureClass) {
    return false;
  }
  
  const normalized = failureClass.toLowerCase().trim();
  return blockList.some(blocked => normalized.includes(blocked.toLowerCase()));
}

/**
 * Detect if there's no signal change (same failures repeated)
 */
function hasNoSignalChange(
  previousSignals: string[] | undefined,
  threshold: number
): boolean {
  if (!previousSignals || previousSignals.length < threshold) {
    return false;
  }
  
  // Check if the last N signals are identical
  const recentSignals = previousSignals.slice(-threshold);
  const firstSignal = recentSignals[0];
  
  return recentSignals.every(signal => signal === firstSignal);
}

/**
 * Calculate time elapsed since first failure (in minutes)
 */
function getMinutesSinceFirstFailure(
  firstFailureAt: string | undefined
): number | null {
  if (!firstFailureAt) {
    return null;
  }
  
  try {
    const firstFailure = new Date(firstFailureAt);
    const now = new Date();
    const diffMs = now.getTime() - firstFailure.getTime();
    return Math.floor(diffMs / (1000 * 60));
  } catch {
    return null;
  }
}

/**
 * Calculate time elapsed since last change (in minutes)
 */
function getMinutesSinceLastChange(
  lastChangedAt: string | undefined
): number | null {
  if (!lastChangedAt) {
    return null;
  }
  
  try {
    const lastChange = new Date(lastChangedAt);
    const now = new Date();
    const diffMs = now.getTime() - lastChange.getTime();
    return Math.floor(diffMs / (1000 * 60));
  } catch {
    return null;
  }
}

/**
 * Make stop decision based on context and lawbook rules
 */
export async function makeStopDecision(
  context: StopDecisionContext,
  pool?: Pool
): Promise<StopDecisionV1> {
  const db = pool || getPool();
  const requestId = context.requestId || `stop-${Date.now()}`;
  const lawbookHash = getLawbookHash();
  const deploymentEnv = getDeploymentEnv();
  
  logger.info('Evaluating stop decision', {
    owner: context.owner,
    repo: context.repo,
    prNumber: context.prNumber,
    requestId,
  }, 'StopDecisionService');
  
  // Load stop rules from lawbook
  const stopRules = await loadStopRules();
  
  // Get lawbook version for evidence
  let lawbookVersion: string | undefined;
  try {
    const lawbookData = await getActiveLawbookData();
    lawbookVersion = lawbookData?.lawbookVersion;
  } catch {
    lawbookVersion = undefined;
  }
  
  const reasons: string[] = [];
  const appliedRules: string[] = [];
  let decision: StopDecisionType = 'CONTINUE';
  let reasonCode: StopReasonCode | undefined;
  let recommendedNextStep: RecommendedNextStep = 'PROMPT';
  
  // Rule 1: Check if failure class is blocked
  if (isBlockedFailureClass(context.failureClass, stopRules.blockOnFailureClasses)) {
    decision = 'HOLD';
    reasonCode = 'NON_RETRIABLE';
    recommendedNextStep = 'FIX_REQUIRED';
    reasons.push(`Failure class '${context.failureClass}' is non-retriable per lawbook`);
    appliedRules.push('blockOnFailureClasses');
    
    logger.info('Stop decision: HOLD (non-retriable failure class)', {
      failureClass: context.failureClass,
      requestId,
    }, 'StopDecisionService');
  }
  
  // Rule 2: Check max attempts per job
  if (decision === 'CONTINUE' && context.attemptCounts.currentJobAttempts >= stopRules.maxRerunsPerJob) {
    decision = 'HOLD';
    reasonCode = 'MAX_ATTEMPTS';
    recommendedNextStep = 'MANUAL_REVIEW';
    reasons.push(
      `Job has reached maximum rerun attempts (${context.attemptCounts.currentJobAttempts}/${stopRules.maxRerunsPerJob})`
    );
    appliedRules.push('maxRerunsPerJob');
    
    logger.info('Stop decision: HOLD (max attempts per job)', {
      currentAttempts: context.attemptCounts.currentJobAttempts,
      maxAttempts: stopRules.maxRerunsPerJob,
      requestId,
    }, 'StopDecisionService');
  }
  
  // Rule 3: Check max total reruns per PR
  if (decision === 'CONTINUE' && context.attemptCounts.totalPrAttempts >= stopRules.maxTotalRerunsPerPr) {
    decision = 'HOLD';
    reasonCode = 'MAX_TOTAL_RERUNS';
    recommendedNextStep = 'MANUAL_REVIEW';
    reasons.push(
      `PR has reached maximum total reruns (${context.attemptCounts.totalPrAttempts}/${stopRules.maxTotalRerunsPerPr})`
    );
    appliedRules.push('maxTotalRerunsPerPr');
    
    logger.info('Stop decision: HOLD (max total reruns per PR)', {
      totalAttempts: context.attemptCounts.totalPrAttempts,
      maxAttempts: stopRules.maxTotalRerunsPerPr,
      requestId,
    }, 'StopDecisionService');
  }
  
  // Rule 4: Check for no signal change
  if (decision === 'CONTINUE' && hasNoSignalChange(context.previousFailureSignals, stopRules.noSignalChangeThreshold)) {
    decision = 'HOLD';
    reasonCode = 'NO_SIGNAL_CHANGE';
    recommendedNextStep = 'MANUAL_REVIEW';
    reasons.push(
      `No signal change detected over ${stopRules.noSignalChangeThreshold} cycles - same failure repeating`
    );
    appliedRules.push('noSignalChangeThreshold');
    
    logger.info('Stop decision: HOLD (no signal change)', {
      threshold: stopRules.noSignalChangeThreshold,
      signalCount: context.previousFailureSignals?.length,
      requestId,
    }, 'StopDecisionService');
  }
  
  // Rule 5: Check cooldown period
  const minutesSinceLastChange = getMinutesSinceLastChange(context.lastChangedAt);
  if (decision === 'CONTINUE' && minutesSinceLastChange !== null && 
      minutesSinceLastChange < stopRules.cooldownMinutes) {
    decision = 'HOLD';
    reasonCode = 'COOLDOWN_ACTIVE';
    recommendedNextStep = 'WAIT';
    reasons.push(
      `Cooldown period active: ${minutesSinceLastChange}/${stopRules.cooldownMinutes} minutes elapsed`
    );
    appliedRules.push('cooldownMinutes');
    
    logger.info('Stop decision: HOLD (cooldown active)', {
      minutesSinceLastChange,
      cooldownMinutes: stopRules.cooldownMinutes,
      requestId,
    }, 'StopDecisionService');
  }
  
  // Rule 6: Check max wait time for green
  if (stopRules.maxWaitMinutesForGreen) {
    const minutesSinceFirstFailure = getMinutesSinceFirstFailure(context.firstFailureAt);
    if (decision === 'CONTINUE' && minutesSinceFirstFailure !== null && 
        minutesSinceFirstFailure >= stopRules.maxWaitMinutesForGreen) {
      decision = 'KILL';
      reasonCode = 'TIMEOUT';
      recommendedNextStep = 'MANUAL_REVIEW';
      reasons.push(
        `Maximum wait time exceeded: ${minutesSinceFirstFailure}/${stopRules.maxWaitMinutesForGreen} minutes`
      );
      appliedRules.push('maxWaitMinutesForGreen');
      
      logger.warn('Stop decision: KILL (timeout)', {
        minutesSinceFirstFailure,
        maxWaitMinutes: stopRules.maxWaitMinutesForGreen,
        requestId,
      }, 'StopDecisionService');
    }
  }
  
  // If still CONTINUE, provide positive feedback
  if (decision === 'CONTINUE') {
    reasons.push('All stop condition checks passed - safe to continue automation');
    recommendedNextStep = 'PROMPT';
    appliedRules.push('all_checks_passed');
    
    logger.info('Stop decision: CONTINUE', { requestId }, 'StopDecisionService');
  }
  
  // Record audit event
  await recordStopDecisionAudit(db, {
    owner: context.owner,
    repo: context.repo,
    prNumber: context.prNumber,
    runId: context.runId,
    requestId,
    decision,
    reasonCode,
    reasons,
    recommendedNextStep,
    failureClass: context.failureClass,
    currentJobAttempts: context.attemptCounts.currentJobAttempts,
    totalPrAttempts: context.attemptCounts.totalPrAttempts,
    lawbookHash,
    lawbookVersion,
    appliedRules,
    evidence: {
      thresholds: stopRules,
      context: {
        firstFailureAt: context.firstFailureAt,
        lastChangedAt: context.lastChangedAt,
        previousSignalsCount: context.previousFailureSignals?.length || 0,
      },
    },
  });
  
  const result: StopDecisionV1 = {
    schemaVersion: '1.0',
    requestId,
    lawbookHash,
    deploymentEnv,
    target: {
      prNumber: context.prNumber,
      runId: context.runId,
    },
    decision,
    reasonCode,
    reasons,
    recommendedNextStep,
    evidence: {
      attemptCounts: context.attemptCounts,
      thresholds: {
        maxRerunsPerJob: stopRules.maxRerunsPerJob,
        maxTotalRerunsPerPr: stopRules.maxTotalRerunsPerPr,
        maxWaitMinutesForGreen: stopRules.maxWaitMinutesForGreen,
        cooldownMinutes: stopRules.cooldownMinutes,
      },
      appliedRules,
    },
    metadata: {
      evaluatedAt: new Date().toISOString(),
      lawbookVersion,
    },
  };
  
  logger.info('Stop decision completed', {
    requestId,
    decision,
    reasonCode,
    appliedRulesCount: appliedRules.length,
  }, 'StopDecisionService');
  
  return result;
}

/**
 * Record stop decision audit event
 */
async function recordStopDecisionAudit(
  pool: Pool,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    runId?: number;
    requestId: string;
    decision: StopDecisionType;
    reasonCode?: StopReasonCode;
    reasons: string[];
    recommendedNextStep: RecommendedNextStep;
    failureClass?: string;
    currentJobAttempts: number;
    totalPrAttempts: number;
    lawbookHash: string;
    lawbookVersion?: string;
    appliedRules: string[];
    evidence: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO stop_decision_audit (
        resource_owner, resource_repo, pr_number, workflow_run_id,
        request_id, decision, reason_code, reasons, recommended_next_step,
        failure_class, current_job_attempts, total_pr_attempts,
        lawbook_hash, lawbook_version, applied_rules, evidence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        input.owner,
        input.repo,
        input.prNumber,
        input.runId || null,
        input.requestId,
        input.decision,
        input.reasonCode || null,
        JSON.stringify(input.reasons),
        input.recommendedNextStep,
        input.failureClass || null,
        input.currentJobAttempts,
        input.totalPrAttempts,
        input.lawbookHash,
        input.lawbookVersion || null,
        JSON.stringify(input.appliedRules),
        JSON.stringify(input.evidence),
      ]
    );
  } catch (error) {
    logger.error('Failed to record stop decision audit', error as Error, {
      requestId: input.requestId,
    }, 'StopDecisionService');
    // Don't throw - audit failure shouldn't block the decision
  }
}
