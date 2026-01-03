/**
 * Incident Classifier v1 (E76.3 / I763)
 * 
 * Rule-based deterministic classifier that assigns classification labels
 * and produces evidence packs for incidents.
 * 
 * DESIGN PRINCIPLES:
 * - Deterministic: same incident + evidence → same classification
 * - Rule-based only (no LLM)
 * - Transparent: rules are explicit and versioned
 * - No network calls: pure function on incident + evidence
 * 
 * CLASSIFICATION RULES (v0.7.0):
 * 
 * 1. DEPLOY_VERIFICATION_FAILED
 *    - Evidence kind="verification" with any http check failed (/api/ready non-200)
 *    - Confidence: high
 *    - Labels: ["needs-redeploy", "config", "infra"]
 * 
 * 2. ALB_TARGET_UNHEALTHY
 *    - Evidence kind="alb" with target health indicates unhealthy
 *    - Confidence: high
 *    - Labels: ["infra", "alb", "needs-investigation"]
 * 
 * 3. ECS_TASK_CRASHLOOP
 *    - Evidence kind="ecs" with stoppedReason contains "Essential container in task exited"
 *    - AND exitCode != 0
 *    - Confidence: high
 *    - Labels: ["code", "ecs", "crashloop", "needs-investigation"]
 * 
 * 4. ECS_IMAGE_PULL_FAILED
 *    - Evidence kind="ecs" with stoppedReason contains "CannotPullContainerError" or "pull image"
 *    - Confidence: high
 *    - Labels: ["infra", "ecs", "image", "needs-redeploy"]
 * 
 * 5. RUNNER_WORKFLOW_FAILED
 *    - Evidence kind="runner" or "github_run" with conclusion=failure
 *    - Confidence: medium
 *    - Labels: ["ci", "runner", "needs-investigation"]
 * 
 * 6. IAM_POLICY_VALIDATION_FAILED
 *    - Evidence kind="runner" with step contains "validate-iam"
 *    - OR message mentions "IAM policy validation failed"
 *    - Confidence: high
 *    - Labels: ["infra", "iam", "policy", "needs-fix"]
 * 
 * 7. UNKNOWN
 *    - Default fallback when no rules match
 *    - Confidence: low
 *    - Labels: ["needs-classification"]
 */

import {
  Incident,
  Evidence,
  Classification,
  ClassificationCategory,
  ClassificationConfidence,
  EvidencePack,
  PrimaryEvidence,
} from '../contracts/incident';

// Classifier version (must be updated when rules change)
export const CLASSIFIER_VERSION = '0.7.0';

/**
 * Classification rule result
 */
interface RuleMatch {
  category: ClassificationCategory;
  confidence: ClassificationConfidence;
  labels: string[];
  primaryEvidence: PrimaryEvidence;
  keyFacts: string[];
}

/**
 * Classify incident based on evidence
 * 
 * @param incident - Incident to classify
 * @param evidence - Evidence array for the incident
 * @returns Classification result
 */
export function classifyIncident(
  incident: Incident,
  evidence: Evidence[]
): Classification {
  // Run rules in priority order
  const ruleMatch = 
    matchDeployVerificationFailed(incident, evidence) ||
    matchAlbTargetUnhealthy(incident, evidence) ||
    matchEcsTaskCrashloop(incident, evidence) ||
    matchEcsImagePullFailed(incident, evidence) ||
    matchIamPolicyValidationFailed(incident, evidence) ||
    matchRunnerWorkflowFailed(incident, evidence) ||
    matchUnknown(incident, evidence);

  // Build evidence pack
  const evidencePack: EvidencePack = {
    summary: buildSummary(incident, ruleMatch),
    keyFacts: sortedKeyFacts(ruleMatch.keyFacts),
    pointers: evidence.map(e => ({
      kind: e.kind,
      ref: e.ref,
      sha256: e.sha256 || undefined,
    })),
  };

  // Build classification
  const classification: Classification = {
    classifierVersion: CLASSIFIER_VERSION,
    category: ruleMatch.category,
    confidence: ruleMatch.confidence,
    labels: sortedLabels(ruleMatch.labels),
    primaryEvidence: ruleMatch.primaryEvidence,
    evidencePack,
  };

  return classification;
}

// ========================================
// Classification Rules
// ========================================

/**
 * Rule 1: DEPLOY_VERIFICATION_FAILED
 * Evidence kind="verification" with any http check failed (/api/ready non-200)
 */
function matchDeployVerificationFailed(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const verificationEvidence = evidence.filter(e => e.kind === 'verification');
  
  if (verificationEvidence.length === 0) {
    return null;
  }

  // Check for http check failures
  for (const ev of verificationEvidence) {
    const ref = ev.ref;
    
    // Check if status indicates failure
    if (ref.status === 'FAILED' || ref.status === 'TIMEOUT') {
      const keyFacts = [
        `Verification run ${ref.runId || 'unknown'} failed`,
        `Playbook: ${ref.playbookId || 'unknown'}`,
        `Environment: ${ref.env || 'unknown'}`,
      ];

      if (ref.completedAt) {
        keyFacts.push(`Failed at: ${ref.completedAt}`);
      }

      return {
        category: 'DEPLOY_VERIFICATION_FAILED',
        confidence: 'high',
        labels: ['needs-redeploy', 'config', 'infra'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 2: ALB_TARGET_UNHEALTHY
 * Evidence kind="alb" with target health indicates unhealthy
 */
function matchAlbTargetUnhealthy(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const albEvidence = evidence.filter(e => e.kind === 'alb');
  
  if (albEvidence.length === 0) {
    return null;
  }

  // Check for unhealthy targets
  for (const ev of albEvidence) {
    const ref = ev.ref;
    
    if (ref.targetHealth === 'unhealthy' || ref.state === 'unhealthy') {
      const keyFacts = [
        `ALB target unhealthy`,
        `Target: ${ref.targetId || 'unknown'}`,
      ];

      if (ref.reason) {
        keyFacts.push(`Reason: ${ref.reason}`);
      }

      return {
        category: 'ALB_TARGET_UNHEALTHY',
        confidence: 'high',
        labels: ['infra', 'alb', 'needs-investigation'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 3: ECS_TASK_CRASHLOOP
 * Evidence kind="ecs" with stoppedReason contains "Essential container in task exited"
 * AND exitCode != 0
 */
function matchEcsTaskCrashloop(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const ecsEvidence = evidence.filter(e => e.kind === 'ecs');
  
  if (ecsEvidence.length === 0) {
    return null;
  }

  // Check for crashloop pattern
  for (const ev of ecsEvidence) {
    const ref = ev.ref;
    const stoppedReason = (ref.stoppedReason || '').toLowerCase();
    const exitCode = ref.exitCode;
    
    if (
      stoppedReason.includes('essential container in task exited') &&
      exitCode !== undefined &&
      exitCode !== 0
    ) {
      const keyFacts = [
        `ECS task crashed with exit code ${exitCode}`,
        `Cluster: ${ref.cluster || 'unknown'}`,
        `Task: ${ref.taskArn || 'unknown'}`,
        `Reason: ${ref.stoppedReason}`,
      ];

      if (ref.stoppedAt) {
        keyFacts.push(`Stopped at: ${ref.stoppedAt}`);
      }

      return {
        category: 'ECS_TASK_CRASHLOOP',
        confidence: 'high',
        labels: ['code', 'ecs', 'crashloop', 'needs-investigation'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 4: ECS_IMAGE_PULL_FAILED
 * Evidence kind="ecs" with stoppedReason contains "CannotPullContainerError" or "pull image"
 */
function matchEcsImagePullFailed(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const ecsEvidence = evidence.filter(e => e.kind === 'ecs');
  
  if (ecsEvidence.length === 0) {
    return null;
  }

  // Check for image pull errors
  for (const ev of ecsEvidence) {
    const ref = ev.ref;
    const stoppedReason = (ref.stoppedReason || '').toLowerCase();
    
    if (
      stoppedReason.includes('cannotpullcontainererror') ||
      stoppedReason.includes('pull image')
    ) {
      const keyFacts = [
        `ECS task failed to pull container image`,
        `Cluster: ${ref.cluster || 'unknown'}`,
        `Task: ${ref.taskArn || 'unknown'}`,
        `Reason: ${ref.stoppedReason}`,
      ];

      if (ref.stoppedAt) {
        keyFacts.push(`Stopped at: ${ref.stoppedAt}`);
      }

      return {
        category: 'ECS_IMAGE_PULL_FAILED',
        confidence: 'high',
        labels: ['infra', 'ecs', 'image', 'needs-redeploy'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 5: IAM_POLICY_VALIDATION_FAILED
 * Evidence kind="runner" with step contains "validate-iam"
 * OR message mentions "IAM policy validation failed"
 */
function matchIamPolicyValidationFailed(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const runnerEvidence = evidence.filter(e => e.kind === 'runner' || e.kind === 'github_run');
  
  if (runnerEvidence.length === 0) {
    return null;
  }

  // Check for IAM validation failures
  for (const ev of runnerEvidence) {
    const ref = ev.ref;
    const stepName = (ref.stepName || '').toLowerCase();
    const message = (ref.message || '').toLowerCase();
    
    if (
      stepName.includes('validate-iam') ||
      message.includes('iam policy validation failed')
    ) {
      const keyFacts = [
        `IAM policy validation failed`,
        `Run: ${ref.runId || 'unknown'}`,
      ];

      if (ref.stepName) {
        keyFacts.push(`Step: ${ref.stepName}`);
      }

      if (ref.completedAt) {
        keyFacts.push(`Failed at: ${ref.completedAt}`);
      }

      return {
        category: 'IAM_POLICY_VALIDATION_FAILED',
        confidence: 'high',
        labels: ['infra', 'iam', 'policy', 'needs-fix'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 6: RUNNER_WORKFLOW_FAILED
 * Evidence kind="runner" or "github_run" with conclusion=failure
 */
function matchRunnerWorkflowFailed(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch | null {
  const runnerEvidence = evidence.filter(e => e.kind === 'runner' || e.kind === 'github_run');
  
  if (runnerEvidence.length === 0) {
    return null;
  }

  // Check for workflow failures
  for (const ev of runnerEvidence) {
    const ref = ev.ref;
    
    if (ref.conclusion === 'failure') {
      const keyFacts = [
        `GitHub Actions workflow failed`,
        `Run: ${ref.runId || 'unknown'}`,
      ];

      if (ref.stepName) {
        keyFacts.push(`Step: ${ref.stepName}`);
      }

      if (ref.runUrl) {
        keyFacts.push(`URL: ${ref.runUrl}`);
      }

      if (ref.completedAt) {
        keyFacts.push(`Failed at: ${ref.completedAt}`);
      }

      return {
        category: 'RUNNER_WORKFLOW_FAILED',
        confidence: 'medium',
        labels: ['ci', 'runner', 'needs-investigation'],
        primaryEvidence: {
          kind: ev.kind,
          ref: ev.ref,
          sha256: ev.sha256 || undefined,
        },
        keyFacts,
      };
    }
  }

  return null;
}

/**
 * Rule 7: UNKNOWN (fallback)
 * Default when no other rules match
 */
function matchUnknown(
  incident: Incident,
  evidence: Evidence[]
): RuleMatch {
  // Use source_primary as primary evidence
  const primaryEvidence: PrimaryEvidence = {
    kind: incident.source_primary.kind as any,
    ref: incident.source_primary.ref,
  };

  const keyFacts = [
    `No specific classification pattern matched`,
    `Severity: ${incident.severity}`,
    `Source: ${incident.source_primary.kind}`,
  ];

  return {
    category: 'UNKNOWN',
    confidence: 'low',
    labels: ['needs-classification'],
    primaryEvidence,
    keyFacts,
  };
}

// ========================================
// Helper Functions
// ========================================

/**
 * Build summary string from incident and rule match
 */
function buildSummary(incident: Incident, match: RuleMatch): string {
  return `${match.category}: ${incident.title}`;
}

/**
 * Sort labels deterministically (alphabetically)
 */
function sortedLabels(labels: string[]): string[] {
  return [...labels].sort();
}

/**
 * Sort key facts deterministically (alphabetically)
 */
function sortedKeyFacts(facts: string[]): string[] {
  return [...facts].sort();
}
