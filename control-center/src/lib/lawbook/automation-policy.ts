/**
 * Automation Policy Module (E87.2)
 * 
 * Machine-readable policies for automation steps with enforcement rules:
 * - Allowed actions per environment
 * - Cooldowns and rate limits
 * - Idempotency key generation
 * - Approval requirements
 * 
 * Designed for deterministic evaluation and fail-closed semantics.
 */

import { AutomationPolicyAction, LawbookAutomationPolicy } from '@/lawbook/schema';
import { createHash } from 'crypto';

// ========================================
// Types
// ========================================

/**
 * Context for policy evaluation
 */
export interface PolicyEvaluationContext {
  // Request metadata
  requestId: string;
  sessionId?: string;
  
  // Action details
  actionType: string;
  
  // Target resource
  targetType: string; // 'pr', 'workflow', 'deployment'
  targetIdentifier: string; // e.g., 'owner/repo#123'
  
  // Environment
  deploymentEnv?: 'staging' | 'prod' | 'development';
  
  // Actor
  actor?: string;
  
  // Action-specific context (for idempotency key generation)
  actionContext: Record<string, unknown>;
  
  // Approval status (from E87.1)
  hasApproval?: boolean;
  approvalFingerprint?: string;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  // Decision
  allow: boolean;
  decision: 'allowed' | 'denied';
  
  // Reason (human-readable)
  reason: string;
  
  // When can the action be retried (null if allowed or permanently blocked)
  nextAllowedAt: Date | null;
  
  // Whether approval is required (but not yet granted)
  requiresApproval: boolean;
  
  // Idempotency key (stable across identical requests)
  idempotencyKey: string;
  idempotencyKeyHash: string;
  
  // Policy reference
  policyName: string | null;
  lawbookVersion?: string;
  lawbookHash?: string;
  
  // Enforcement details (for audit)
  enforcementData: {
    cooldownSeconds?: number;
    maxRunsPerWindow?: number;
    windowSeconds?: number;
    currentRunCount?: number;
    allowedEnvs?: string[];
  };
}

/**
 * Action execution record (from audit table)
 */
export interface ActionExecutionRecord {
  id: number;
  request_id: string;
  action_type: string;
  target_identifier: string;
  decision: 'allowed' | 'denied';
  created_at: string;
  idempotency_key_hash: string;
  enforcement_data: Record<string, unknown>;
}

// ========================================
// Idempotency Key Generation
// ========================================

/**
 * Generate stable idempotency key from template and context
 * 
 * Template specifies which fields from context to include.
 * Fields are sorted and concatenated for deterministic key generation.
 * 
 * @param template Array of field names to include (e.g., ['owner', 'repo', 'prNumber'])
 * @param context Action context with values
 * @returns Stable idempotency key string
 */
export function generateIdempotencyKey(
  template: string[],
  context: Record<string, unknown>
): string {
  // Sort template for deterministic ordering
  const sortedTemplate = template.slice().sort();
  
  // Extract values in sorted order
  const parts: string[] = [];
  for (const field of sortedTemplate) {
    const value = context[field];
    if (value !== undefined && value !== null) {
      // Serialize value deterministically
      const serialized = typeof value === 'object' 
        ? JSON.stringify(value, Object.keys(value as object).sort())
        : String(value);
      parts.push(`${field}=${serialized}`);
    }
  }
  
  // Join with separator
  return parts.join('::');
}

/**
 * Hash idempotency key for storage and lookups
 */
export function hashIdempotencyKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

// ========================================
// Action Fingerprint Generation
// ========================================

/**
 * Generate deterministic action fingerprint for cross-reference with approval gates
 * 
 * @param actionType Action type identifier
 * @param targetIdentifier Target resource identifier
 * @param params Additional parameters (sorted for determinism)
 * @returns SHA-256 hash of action+target+params
 */
export function generateActionFingerprint(
  actionType: string,
  targetIdentifier: string,
  params?: Record<string, unknown>
): string {
  const parts = [
    `action=${actionType}`,
    `target=${targetIdentifier}`,
  ];
  
  if (params && Object.keys(params).length > 0) {
    // Sort params for determinism
    const sortedKeys = Object.keys(params).sort();
    for (const key of sortedKeys) {
      const value = params[key];
      const serialized = typeof value === 'object'
        ? JSON.stringify(value, Object.keys(value as object).sort())
        : String(value);
      parts.push(`${key}=${serialized}`);
    }
  }
  
  const canonical = parts.join('||');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

// ========================================
// Policy Lookup
// ========================================

/**
 * Find policy for action type
 * 
 * @param actionType Action type to find policy for
 * @param automationPolicy Lawbook automation policy section
 * @returns Policy action or null if not found
 */
export function findPolicyForAction(
  actionType: string,
  automationPolicy?: LawbookAutomationPolicy
): AutomationPolicyAction | null {
  if (!automationPolicy || !automationPolicy.policies) {
    return null;
  }
  
  const policy = automationPolicy.policies.find(p => p.actionType === actionType);
  return policy || null;
}

// ========================================
// Environment Validation
// ========================================

/**
 * Check if action is allowed in current environment
 */
export function isActionAllowedInEnv(
  policy: AutomationPolicyAction,
  deploymentEnv?: string
): boolean {
  if (!deploymentEnv) {
    // If no env specified, only allow if 'development' or 'staging' is in allowedEnvs
    return policy.allowedEnvs.includes('staging') || policy.allowedEnvs.includes('development');
  }
  
  // Check if env is explicitly allowed
  return policy.allowedEnvs.includes(deploymentEnv as any);
}

// ========================================
// Validation Helpers
// ========================================

/**
 * Validate that maxRunsPerWindow and windowSeconds are both defined or both undefined
 */
export function validateRateLimitConfig(policy: AutomationPolicyAction): {
  valid: boolean;
  error?: string;
} {
  const hasMaxRuns = policy.maxRunsPerWindow !== undefined;
  const hasWindow = policy.windowSeconds !== undefined;
  
  if (hasMaxRuns !== hasWindow) {
    return {
      valid: false,
      error: 'maxRunsPerWindow and windowSeconds must both be defined or both be undefined',
    };
  }
  
  return { valid: true };
}
