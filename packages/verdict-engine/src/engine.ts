/**
 * AFU-9 Verdict Engine v1.1
 * 
 * Implements EPIC 2: Governance & Auditability
 * - Issue 2.1: Policy Snapshotting pro Run
 * - Issue 2.2: Confidence Score Normalisierung
 * 
 * Wraps the Deploy Memory classifier with:
 * - Normalized confidence scores (0-100 scale)
 * - Deterministic verdict generation
 * - Immutable policy snapshots
 */

import { classifyFailure, extractTokens } from '@codefactory/deploy-memory/src/classifier';
import { getPlaybook } from '@codefactory/deploy-memory/src/playbook';
import { 
  CfnFailureSignal, 
  FailureClassification,
  ErrorClass,
  FactoryAction 
} from '@codefactory/deploy-memory/src/types';
import { 
  Verdict, 
  CreateVerdictInput, 
  PolicySnapshot 
} from './types';

/**
 * Normalize confidence score from 0-1 range to 0-100 integer scale
 * 
 * Issue 2.2: Confidence Score Normalisierung
 * - Deterministic: identical inputs always produce identical outputs
 * - Comparable: 0-100 scale allows easy comparison across verdicts
 * - Documented: simple formula (raw * 100, rounded)
 * 
 * @param rawConfidence Raw confidence from classifier (0-1)
 * @returns Normalized confidence score (0-100)
 */
export function normalizeConfidenceScore(rawConfidence: number): number {
  // Validate input range
  if (rawConfidence < 0 || rawConfidence > 1) {
    throw new Error(`Invalid confidence: ${rawConfidence}. Must be between 0 and 1.`);
  }
  
  // Scale to 0-100 and round to integer for determinism
  return Math.round(rawConfidence * 100);
}

/**
 * Generate a verdict from failure signals
 * 
 * This is the core verdict generation function that:
 * 1. Classifies the failure using deploy-memory classifier
 * 2. Normalizes confidence score to 0-100 scale
 * 3. Determines proposed action from playbook
 * 4. Returns a complete verdict (without persistence)
 * 
 * @param input Verdict creation input with signals and policy reference
 * @returns Complete verdict ready for persistence
 */
export function generateVerdict(input: CreateVerdictInput): Omit<Verdict, 'id' | 'created_at'> {
  const { execution_id, policy_snapshot_id, signals } = input;

  // Classify the failure using deploy-memory classifier
  const classification: FailureClassification = classifyFailure(signals);
  
  // Normalize confidence score to 0-100 scale (Issue 2.2)
  const confidence_score = normalizeConfidenceScore(classification.confidence);
  
  // Get playbook and proposed action
  const playbook = getPlaybook(classification.errorClass);
  
  // Extract tokens for searchability
  const tokens = extractTokens(signals);
  
  return {
    execution_id,
    policy_snapshot_id, // Issue 2.1: Immutable policy reference
    fingerprint_id: classification.fingerprintId,
    error_class: classification.errorClass,
    service: classification.service,
    confidence_score, // Normalized 0-100 scale
    proposed_action: playbook.proposedFactoryAction,
    tokens,
    signals,
    playbook_id: playbook.fingerprintId,
  };
}

/**
 * Validate verdict determinism
 * 
 * Ensures that identical signals always produce identical verdicts.
 * This is critical for Issue 2.2 (Verdict Consistency).
 * 
 * @param signals1 First set of signals
 * @param signals2 Second set of signals
 * @returns True if verdicts would be identical
 */
export function validateDeterminism(
  signals1: CfnFailureSignal[],
  signals2: CfnFailureSignal[]
): boolean {
  // Generate verdicts for both signal sets
  const verdict1 = generateVerdict({
    execution_id: 'test-1',
    policy_snapshot_id: 'test-policy',
    signals: signals1,
  });
  
  const verdict2 = generateVerdict({
    execution_id: 'test-2',
    policy_snapshot_id: 'test-policy',
    signals: signals2,
  });
  
  // Compare critical verdict fields
  return (
    verdict1.fingerprint_id === verdict2.fingerprint_id &&
    verdict1.error_class === verdict2.error_class &&
    verdict1.confidence_score === verdict2.confidence_score &&
    verdict1.proposed_action === verdict2.proposed_action
  );
}

/**
 * Calculate verdict consistency metrics
 * 
 * Supports Issue 2.2 KPI: Verdict Consistency
 * 
 * @param verdicts Array of verdicts to analyze
 * @returns Consistency metrics
 */
export function calculateConsistencyMetrics(verdicts: Verdict[]) {
  if (verdicts.length === 0) {
    return {
      total: 0,
      by_error_class: {},
      avg_confidence: 0,
      consistency_score: 0,
    };
  }

  // Group verdicts by error class and fingerprint
  const groupedByFingerprint = new Map<string, Verdict[]>();
  
  for (const verdict of verdicts) {
    const key = verdict.fingerprint_id;
    if (!groupedByFingerprint.has(key)) {
      groupedByFingerprint.set(key, []);
    }
    groupedByFingerprint.get(key)!.push(verdict);
  }

  // Calculate consistency: verdicts with same fingerprint should have same error class and score
  let consistentGroups = 0;
  let totalGroups = groupedByFingerprint.size;

  for (const [fingerprint, group] of groupedByFingerprint.entries()) {
    if (group.length === 1) {
      consistentGroups++;
      continue;
    }

    // Check if all verdicts in group have same error_class and confidence_score
    const firstVerdict = group[0];
    const allConsistent = group.every(
      v => v.error_class === firstVerdict.error_class &&
           v.confidence_score === firstVerdict.confidence_score
    );

    if (allConsistent) {
      consistentGroups++;
    }
  }

  const consistency_score = totalGroups > 0 
    ? Math.round((consistentGroups / totalGroups) * 100) 
    : 100;

  // Calculate average confidence by error class
  const by_error_class: Record<string, { count: number; avg_confidence: number }> = {};
  
  for (const verdict of verdicts) {
    if (!by_error_class[verdict.error_class]) {
      by_error_class[verdict.error_class] = { count: 0, avg_confidence: 0 };
    }
    
    const existing = by_error_class[verdict.error_class];
    const newCount = existing.count + 1;
    const newAvg = (existing.avg_confidence * existing.count + verdict.confidence_score) / newCount;
    
    by_error_class[verdict.error_class] = {
      count: newCount,
      avg_confidence: Math.round(newAvg),
    };
  }

  const avg_confidence = Math.round(
    verdicts.reduce((sum, v) => sum + v.confidence_score, 0) / verdicts.length
  );

  return {
    total: verdicts.length,
    by_error_class,
    avg_confidence,
    consistency_score, // 0-100: percentage of fingerprint groups with consistent verdicts
  };
}

/**
 * Audit verdict for compliance
 * 
 * Supports Issue 2.1: Auditability
 * 
 * @param verdict Verdict to audit
 * @param policySnapshot Policy snapshot used for verdict
 * @returns Audit result with compliance status
 */
export function auditVerdict(
  verdict: Verdict,
  policySnapshot: PolicySnapshot
): {
  compliant: boolean;
  issues: string[];
  policy_version: string;
} {
  const issues: string[] = [];

  // Check policy reference exists
  if (verdict.policy_snapshot_id !== policySnapshot.id) {
    issues.push('Verdict policy_snapshot_id does not match provided policy');
  }

  // Check confidence score is in valid range
  if (verdict.confidence_score < 0 || verdict.confidence_score > 100) {
    issues.push(`Invalid confidence_score: ${verdict.confidence_score}. Must be 0-100.`);
  }

  // Check error class is valid
  const validErrorClasses = Object.keys(policySnapshot.policies.playbooks);
  if (!validErrorClasses.includes(verdict.error_class)) {
    issues.push(`Unknown error_class: ${verdict.error_class}`);
  }

  // Check proposed action is valid
  const validActions: FactoryAction[] = ['WAIT_AND_RETRY', 'OPEN_ISSUE', 'HUMAN_REQUIRED'];
  if (!validActions.includes(verdict.proposed_action)) {
    issues.push(`Invalid proposed_action: ${verdict.proposed_action}`);
  }

  // Check signals exist
  if (!verdict.signals || verdict.signals.length === 0) {
    issues.push('Verdict has no signals');
  }

  return {
    compliant: issues.length === 0,
    issues,
    policy_version: policySnapshot.version,
  };
}
