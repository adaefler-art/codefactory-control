/**
 * Guardrail Gates Library (E79.4 / I794)
 * 
 * Provides reusable policy checks for:
 * - Determinism gate requirements
 * - Evidence requirements
 * - Idempotency key rules
 * - Playbook/action allowlists (via lawbook)
 * 
 * Returns standardized decision objects used across the system.
 * 
 * NON-NEGOTIABLES:
 * - Deny-by-default: any unknown action/category must be denied unless allowed
 * - Deterministic decisions: same inputs → same verdict output
 * - Transparent: verdict includes reasons, rule ids, and lawbookVersion used
 * - No LLM usage; pure rule evaluation
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import { LawbookV1 } from '../lawbook/types';

// ========================================
// GateVerdict Schema
// ========================================

/**
 * Reason for a gate decision
 */
export const GateReasonSchema = z.object({
  code: z.string(),
  message: z.string(),
  ruleId: z.string().optional(),
  severity: z.enum(['ERROR', 'WARNING', 'INFO']),
}).strict();

export type GateReason = z.infer<typeof GateReasonSchema>;

/**
 * Gate verdict decision
 */
export const GateVerdictSchema = z.object({
  verdict: z.enum(['ALLOW', 'DENY', 'HOLD']),
  reasons: z.array(GateReasonSchema),
  lawbookVersion: z.string().nullable(),
  inputsHash: z.string(), // SHA-256 of canonical inputs
  generatedAt: z.string().datetime(), // ISO 8601 datetime
}).strict();

export type GateVerdict = z.infer<typeof GateVerdictSchema>;

// ========================================
// Helper Functions
// ========================================

/**
 * Compute SHA-256 hash of canonical inputs
 * Ensures deterministic hashing regardless of input order
 */
function computeInputsHash(inputs: Record<string, any>): string {
  // Sort keys for deterministic ordering
  const sortedKeys = Object.keys(inputs).sort();
  const canonical: Record<string, any> = {};
  for (const key of sortedKeys) {
    canonical[key] = inputs[key];
  }
  
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Create a GateVerdict object
 */
function createVerdict(
  verdict: 'ALLOW' | 'DENY' | 'HOLD',
  reasons: GateReason[],
  lawbookVersion: string | null,
  inputsHash: string
): GateVerdict {
  // Sort reasons by code for deterministic output
  const sortedReasons = [...reasons].sort((a, b) => a.code.localeCompare(b.code));
  
  return {
    verdict,
    reasons: sortedReasons,
    lawbookVersion,
    inputsHash,
    generatedAt: new Date().toISOString(),
  };
}

// ========================================
// Gate Functions
// ========================================

/**
 * Gate A: Check if playbook is allowed by lawbook
 * 
 * Checks:
 * - remediation.enabled must be true
 * - playbookId must be in allowedPlaybooks
 * - requiredKindsByCategory must be satisfied (if provided)
 * - maxRunsPerIncident policy (if supplied via args)
 * - cooldown policy (if supplied via args)
 * 
 * @param params - Gate parameters
 * @param lawbook - Active lawbook configuration
 * @returns GateVerdict with ALLOW/DENY decision
 */
export function gatePlaybookAllowed(
  params: {
    playbookId: string;
    incidentCategory?: string;
    evidenceKinds?: string[];
    currentRunCount?: number;
    lastRunTimestamp?: string;
  },
  lawbook: LawbookV1 | null
): GateVerdict {
  const reasons: GateReason[] = [];
  const inputsHash = computeInputsHash(params);
  
  // Deny-by-default: no lawbook = deny
  if (!lawbook) {
    reasons.push({
      code: 'LAWBOOK_MISSING',
      message: 'No active lawbook configuration found',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  const lawbookVersion = lawbook.lawbookVersion;
  
  // Check 1: Remediation enabled?
  if (!lawbook.remediation.enabled) {
    reasons.push({
      code: 'REMEDIATION_DISABLED',
      message: 'Remediation is disabled in lawbook',
      ruleId: 'remediation.enabled',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
  }
  
  // Check 2: Playbook in allowed list?
  if (!lawbook.remediation.allowedPlaybooks.includes(params.playbookId)) {
    reasons.push({
      code: 'PLAYBOOK_NOT_ALLOWED',
      message: `Playbook '${params.playbookId}' is not in allowed list`,
      ruleId: 'remediation.allowedPlaybooks',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
  }
  
  // Check 3: Required evidence kinds by category (if applicable)
  if (params.incidentCategory && params.evidenceKinds && lawbook.evidence.requiredKindsByCategory) {
    const requiredKinds = lawbook.evidence.requiredKindsByCategory[params.incidentCategory];
    if (requiredKinds && requiredKinds.length > 0) {
      const missingKinds = requiredKinds.filter(k => !params.evidenceKinds!.includes(k));
      if (missingKinds.length > 0) {
        reasons.push({
          code: 'EVIDENCE_MISSING',
          message: `Missing required evidence kinds: ${missingKinds.join(', ')}`,
          ruleId: `evidence.requiredKindsByCategory.${params.incidentCategory}`,
          severity: 'ERROR',
        });
        return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
      }
    }
  }
  
  // Check 4: Max runs per incident policy
  if (
    params.currentRunCount !== undefined &&
    lawbook.remediation.maxRunsPerIncident !== undefined &&
    params.currentRunCount >= lawbook.remediation.maxRunsPerIncident
  ) {
    reasons.push({
      code: 'MAX_RUNS_EXCEEDED',
      message: `Maximum runs per incident (${lawbook.remediation.maxRunsPerIncident}) exceeded`,
      ruleId: 'remediation.maxRunsPerIncident',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
  }
  
  // Check 5: Cooldown policy
  if (
    params.lastRunTimestamp &&
    lawbook.remediation.cooldownMinutes !== undefined
  ) {
    const lastRunTime = new Date(params.lastRunTimestamp).getTime();
    const nowTime = Date.now();
    const elapsedMinutes = (nowTime - lastRunTime) / (1000 * 60);
    
    if (elapsedMinutes < lawbook.remediation.cooldownMinutes) {
      const remainingMinutes = Math.ceil(lawbook.remediation.cooldownMinutes - elapsedMinutes);
      reasons.push({
        code: 'COOLDOWN_ACTIVE',
        message: `Cooldown active. Wait ${remainingMinutes} more minutes`,
        ruleId: 'remediation.cooldownMinutes',
        severity: 'ERROR',
      });
      return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
    }
  }
  
  // All checks passed
  reasons.push({
    code: 'PLAYBOOK_ALLOWED',
    message: `Playbook '${params.playbookId}' is allowed`,
    severity: 'INFO',
  });
  
  return createVerdict('ALLOW', reasons, lawbookVersion, inputsHash);
}

/**
 * Gate B: Check if action type is allowed by lawbook
 * 
 * Checks:
 * - actionType must be in allowedActions list
 * 
 * @param params - Gate parameters
 * @param lawbook - Active lawbook configuration
 * @returns GateVerdict with ALLOW/DENY decision
 */
export function gateActionAllowed(
  params: {
    actionType: string;
  },
  lawbook: LawbookV1 | null
): GateVerdict {
  const reasons: GateReason[] = [];
  const inputsHash = computeInputsHash(params);
  
  // Deny-by-default: no lawbook = deny
  if (!lawbook) {
    reasons.push({
      code: 'LAWBOOK_MISSING',
      message: 'No active lawbook configuration found',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  const lawbookVersion = lawbook.lawbookVersion;
  
  // Check: Action type in allowed list?
  if (!lawbook.remediation.allowedActions.includes(params.actionType)) {
    reasons.push({
      code: 'ACTION_NOT_ALLOWED',
      message: `Action type '${params.actionType}' is not in allowed list`,
      ruleId: 'remediation.allowedActions',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
  }
  
  // Action allowed
  reasons.push({
    code: 'ACTION_ALLOWED',
    message: `Action type '${params.actionType}' is allowed`,
    severity: 'INFO',
  });
  
  return createVerdict('ALLOW', reasons, lawbookVersion, inputsHash);
}

/**
 * Gate C: Check evidence requirements
 * 
 * Checks:
 * - All required evidence kinds must be present
 * 
 * @param params - Gate parameters
 * @returns GateVerdict with ALLOW/DENY decision
 */
export function gateEvidence(
  params: {
    requiredKinds: string[];
    presentKinds: string[];
  }
): GateVerdict {
  const reasons: GateReason[] = [];
  const inputsHash = computeInputsHash(params);
  
  // Find missing kinds
  const missingKinds = params.requiredKinds.filter(k => !params.presentKinds.includes(k));
  
  if (missingKinds.length > 0) {
    // Sort missing kinds for deterministic output
    const sortedMissing = [...missingKinds].sort();
    
    reasons.push({
      code: 'EVIDENCE_MISSING',
      message: `Missing required evidence kinds: ${sortedMissing.join(', ')}`,
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  // All evidence present
  reasons.push({
    code: 'EVIDENCE_SATISFIED',
    message: 'All required evidence kinds are present',
    severity: 'INFO',
  });
  
  return createVerdict('ALLOW', reasons, null, inputsHash);
}

/**
 * Gate D: Check determinism gate requirements
 * 
 * Checks:
 * - If requireDeterminismGate is true, ensure determinism report PASS exists
 * 
 * @param params - Gate parameters
 * @param lawbook - Active lawbook configuration
 * @returns GateVerdict with ALLOW/DENY/HOLD decision
 */
export function gateDeterminismRequired(
  params: {
    hasDeterminismReport: boolean;
    determinismReportStatus?: 'PASS' | 'FAIL' | 'PENDING';
  },
  lawbook: LawbookV1 | null
): GateVerdict {
  const reasons: GateReason[] = [];
  const inputsHash = computeInputsHash(params);
  
  // Deny-by-default: no lawbook = deny
  if (!lawbook) {
    reasons.push({
      code: 'LAWBOOK_MISSING',
      message: 'No active lawbook configuration found',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  const lawbookVersion = lawbook.lawbookVersion;
  
  // Check: Determinism gate required?
  if (!lawbook.determinism.requireDeterminismGate) {
    reasons.push({
      code: 'DETERMINISM_NOT_REQUIRED',
      message: 'Determinism gate is not required by lawbook',
      severity: 'INFO',
    });
    return createVerdict('ALLOW', reasons, lawbookVersion, inputsHash);
  }
  
  // Determinism gate required - check report
  if (!params.hasDeterminismReport) {
    reasons.push({
      code: 'DETERMINISM_REPORT_MISSING',
      message: 'Determinism gate required but no report found',
      ruleId: 'determinism.requireDeterminismGate',
      severity: 'ERROR',
    });
    return createVerdict('HOLD', reasons, lawbookVersion, inputsHash);
  }
  
  // Check report status
  if (params.determinismReportStatus === 'PENDING') {
    reasons.push({
      code: 'DETERMINISM_REPORT_PENDING',
      message: 'Determinism report is pending',
      ruleId: 'determinism.requireDeterminismGate',
      severity: 'WARNING',
    });
    return createVerdict('HOLD', reasons, lawbookVersion, inputsHash);
  }
  
  if (params.determinismReportStatus === 'FAIL') {
    reasons.push({
      code: 'DETERMINISM_REPORT_FAILED',
      message: 'Determinism report failed',
      ruleId: 'determinism.requireDeterminismGate',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
  }
  
  if (params.determinismReportStatus === 'PASS') {
    reasons.push({
      code: 'DETERMINISM_REPORT_PASSED',
      message: 'Determinism report passed',
      severity: 'INFO',
    });
    return createVerdict('ALLOW', reasons, lawbookVersion, inputsHash);
  }
  
  // Unknown status
  reasons.push({
    code: 'DETERMINISM_REPORT_UNKNOWN',
    message: 'Determinism report status is unknown',
    ruleId: 'determinism.requireDeterminismGate',
    severity: 'ERROR',
  });
  return createVerdict('DENY', reasons, lawbookVersion, inputsHash);
}

/**
 * Gate E: Check idempotency key format
 * 
 * Checks:
 * - Key must not exceed max length (default: 256 chars)
 * - Key must contain only allowed characters (alphanumeric, hyphen, underscore, colon)
 * 
 * @param params - Gate parameters
 * @returns GateVerdict with ALLOW/DENY decision
 */
export function gateIdempotencyKeyFormat(
  params: {
    key: string;
    maxLength?: number;
  }
): GateVerdict {
  const reasons: GateReason[] = [];
  const inputsHash = computeInputsHash(params);
  const maxLength = params.maxLength || 256;
  
  // Check 1: Length
  if (params.key.length > maxLength) {
    reasons.push({
      code: 'KEY_TOO_LONG',
      message: `Idempotency key exceeds max length of ${maxLength} characters (actual: ${params.key.length})`,
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  // Check 2: Allowed characters (alphanumeric, hyphen, underscore, colon)
  const allowedPattern = /^[a-zA-Z0-9_:-]+$/;
  if (!allowedPattern.test(params.key)) {
    reasons.push({
      code: 'KEY_INVALID_CHARS',
      message: 'Idempotency key contains invalid characters (only alphanumeric, hyphen, underscore, colon allowed)',
      severity: 'ERROR',
    });
    return createVerdict('DENY', reasons, null, inputsHash);
  }
  
  // Key format valid
  reasons.push({
    code: 'KEY_FORMAT_VALID',
    message: 'Idempotency key format is valid',
    severity: 'INFO',
  });
  
  return createVerdict('ALLOW', reasons, null, inputsHash);
}

// ========================================
// Exports
// ========================================

export {
  computeInputsHash,
};
