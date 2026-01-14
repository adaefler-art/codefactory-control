/**
 * INTENT Issue Authoring Evidence Module (E81.5)
 * 
 * Provides audit-ready evidence packs for INTENT issue authoring operations.
 * 
 * Key Features:
 * - Deterministic hashing (stableStringify with sorted keys)
 * - Secret redaction (no tokens, env vars, credentials in stored JSON)
 * - Bounded payloads (prevent excessive storage bloat)
 * - lawbookVersion tracking for determinism traceability
 * 
 * NON-NEGOTIABLES:
 * - No secrets in stored JSON (explicit denylist)
 * - Deterministic hashes (sorted keys, stable serialization)
 * - Append-only DB policy (enforced at DB level)
 * - Bounded payloads (max 100KB per event)
 */

import { createHash } from 'crypto';
import { getActiveLawbookVersion } from './lawbook-version-helper';
import { Pool } from 'pg';

/**
 * Maximum size for evidence JSON (100 KB per event)
 * Prevents excessive storage bloat
 */
export const MAX_EVIDENCE_PAYLOAD_BYTES = 100 * 1024; // 100 KB

/**
 * Evidence error codes (no secrets, deterministic)
 */
export const EVIDENCE_ERROR_CODES = {
  PAYLOAD_TOO_LARGE: 'EVIDENCE_PAYLOAD_TOO_LARGE',
  INSERT_FAILED: 'EVIDENCE_INSERT_FAILED',
  REDACTION_FAILED: 'EVIDENCE_REDACTION_FAILED',
  HASH_FAILED: 'EVIDENCE_HASH_FAILED',
} as const;

export type EvidenceErrorCode = typeof EVIDENCE_ERROR_CODES[keyof typeof EVIDENCE_ERROR_CODES];

/**
 * Secret key patterns to redact from params/results
 * These are matched as substrings within keys (case-insensitive)
 * with word boundary awareness
 */
const SECRET_KEY_PATTERNS = [
  'token',
  'secret',
  'password',
  'credential',
  'bearer',
  'jwt',
  'cookie',
  'authorization',
];

/**
 * Exact secret keys to match (case-insensitive)
 */
const EXACT_SECRET_KEYS = [
  'api_key',
  'apikey',
  'access_key',
  'accesskey',
  'private_key',
  'privatekey',
  'session',
  'x-api-key',
  'x-auth-token',
  'env',
  'process.env',
  'github_token',
  'anthropic_api_key',
  'openai_api_key',
  'aws_secret_access_key',
  'database_url',
  'db_password',
];

/**
 * Evidence action types
 */
export type EvidenceAction =
  | 'draft_save'
  | 'draft_update'
  | 'draft_validate'
  | 'draft_commit'
  | 'issue_set_generate'
  | 'issue_set_export';

/**
 * Evidence record structure
 */
export interface EvidenceRecord {
  requestId: string;
  sessionId: string;
  sub: string;
  action: EvidenceAction;
  paramsHash: string;
  resultHash: string;
  lawbookVersion: string | null;
  createdAt: string;
  paramsJson?: Record<string, any>;
  resultJson?: Record<string, any>;
}

/**
 * Stable JSON serialization with sorted keys
 * 
 * Ensures deterministic output regardless of key insertion order.
 * This is critical for reproducible hashing.
 */
export function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => stableStringify(item)).join(',') + ']';
  }
  
  // Sort object keys alphabetically for determinism
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const value = stableStringify(obj[key]);
    return JSON.stringify(key) + ':' + value;
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Redact secrets from an object
 * 
 * Recursively walks the object and replaces secret values with "[REDACTED]"
 * Returns a deep copy with secrets removed.
 * 
 * Note: Most keys are only redacted if they're primitive values.
 * However, certain keys like 'env' are always redacted (even if they're objects)
 * to prevent leaking environment variables.
 */
export function redactSecrets(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSecrets(item));
  }
  
  // Keys that should always be redacted, even if they're objects
  const ALWAYS_REDACT_KEYS = ['env', 'process.env'];
  
  // Check each key for secret patterns
  const redacted: Record<string, any> = {};
  
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const lowerKey = key.toLowerCase();
    
    // Check if this key should always be redacted
    const alwaysRedact = ALWAYS_REDACT_KEYS.some(k => lowerKey === k.toLowerCase());
    
    if (alwaysRedact) {
      redacted[key] = '[REDACTED]';
      continue;
    }
    
    // Check exact matches
    const isExactMatch = EXACT_SECRET_KEYS.some(secretKey => 
      lowerKey === secretKey.toLowerCase().replace(/-/g, '_') ||
      lowerKey === secretKey.toLowerCase().replace(/_/g, '-') ||
      lowerKey === secretKey.toLowerCase()
    );
    
    // Check pattern matches (substring, but with word boundaries)
    // Single boolean expression for clarity and correctness
    const isPatternMatch = !isExactMatch && SECRET_KEY_PATTERNS.some(pattern => {
      const lowerPattern = pattern.toLowerCase();
      // Match if the pattern appears as a word within the key
      // Handle snake_case, kebab-case, and camelCase
      return (
        lowerKey === lowerPattern || 
        lowerKey.startsWith(`${lowerPattern}_`) || 
        lowerKey.startsWith(`${lowerPattern}-`) ||
        lowerKey.endsWith(`_${lowerPattern}`) || 
        lowerKey.endsWith(`-${lowerPattern}`) ||
        lowerKey.endsWith(lowerPattern) || // For camelCase like "apiToken"
        lowerKey.includes(`_${lowerPattern}_`) ||
        lowerKey.includes(`-${lowerPattern}-`) ||
        lowerKey.includes(`_${lowerPattern}-`) ||
        lowerKey.includes(`-${lowerPattern}_`)
      );
    });
    
    const isSecret = isExactMatch || isPatternMatch;
    
    // Only redact if it's a secret AND it's a primitive value
    // If it's an object/array, recurse into it even if the key looks like a secret
    if (isSecret && typeof value !== 'object') {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSecrets(value);
    }
  }
  
  return redacted;
}

/**
 * Compute deterministic hash from an object
 * 
 * Uses stableStringify for consistent key ordering.
 * Returns SHA256 hex digest.
 */
export function computeHash(data: any): string {
  const normalized = stableStringify(data);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Compute hash of params (after redaction)
 */
export function computeParamsHash(params: Record<string, any>): string {
  const redacted = redactSecrets(params);
  return computeHash(redacted);
}

/**
 * Compute hash of result (after redaction)
 */
export function computeResultHash(result: Record<string, any>): string {
  const redacted = redactSecrets(result);
  return computeHash(redacted);
}

/**
 * Validate single payload size
 * 
 * Checks that a single payload doesn't exceed MAX_EVIDENCE_PAYLOAD_BYTES
 * Used for individual validation with clear error messages
 */
function validatePayloadSizeSingle(payload: any, label: string): void {
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json, 'utf8');
  
  if (bytes > MAX_EVIDENCE_PAYLOAD_BYTES) {
    const error = new Error(
      `${label} exceeds maximum size: ${bytes} bytes > ${MAX_EVIDENCE_PAYLOAD_BYTES} bytes`
    );
    (error as any).code = EVIDENCE_ERROR_CODES.PAYLOAD_TOO_LARGE;
    throw error;
  }
}

/**
 * Validate combined payload size
 * 
 * Checks that params + result together don't exceed MAX_EVIDENCE_PAYLOAD_BYTES
 * This is the primary validation used in createEvidenceRecord
 */
function validatePayloadSizeCombined(params: any, result: any): void {
  const paramsJson = JSON.stringify(params);
  const resultJson = JSON.stringify(result);
  const totalBytes = Buffer.byteLength(paramsJson, 'utf8') + Buffer.byteLength(resultJson, 'utf8');
  
  if (totalBytes > MAX_EVIDENCE_PAYLOAD_BYTES) {
    const error = new Error(
      `Combined payload exceeds maximum size: ${totalBytes} bytes > ${MAX_EVIDENCE_PAYLOAD_BYTES} bytes`
    );
    (error as any).code = EVIDENCE_ERROR_CODES.PAYLOAD_TOO_LARGE;
    throw error;
  }
}

/**
 * Create evidence record for INTENT issue authoring operation
 * 
 * @param options Evidence record options
 * @param pool Optional database pool for fetching lawbookVersion
 * @returns Evidence record with deterministic hashes and redacted secrets
 * @throws Error if payloads exceed size limits
 */
export async function createEvidenceRecord(
  options: {
    requestId: string;
    sessionId: string;
    sub: string;
    action: EvidenceAction;
    params: Record<string, any>;
    result: Record<string, any>;
  },
  pool?: Pool
): Promise<EvidenceRecord> {
  // Redact secrets from params and result
  const redactedParams = redactSecrets(options.params);
  const redactedResult = redactSecrets(options.result);
  
  // Validate combined payload size (after redaction)
  validatePayloadSizeCombined(redactedParams, redactedResult);
  
  // Compute deterministic hashes
  const paramsHash = computeHash(redactedParams);
  const resultHash = computeHash(redactedResult);
  
  // Get active lawbook version (non-blocking, null if not configured)
  const lawbookVersion = await getActiveLawbookVersion(pool);
  
  return {
    requestId: options.requestId,
    sessionId: options.sessionId,
    sub: options.sub,
    action: options.action,
    paramsHash,
    resultHash,
    lawbookVersion,
    createdAt: new Date().toISOString(),
    paramsJson: redactedParams,
    resultJson: redactedResult,
  };
}

/**
 * Verify deterministic hashing
 * 
 * Utility function to verify that same inputs produce same hash.
 * Useful for testing and validation.
 */
export function verifyDeterministicHash(obj1: any, obj2: any): boolean {
  const hash1 = computeHash(obj1);
  const hash2 = computeHash(obj2);
  return hash1 === hash2;
}

/**
 * Extract evidence summary (for logging/monitoring)
 * 
 * Returns minimal info about evidence record without full payloads
 */
export function extractEvidenceSummary(record: EvidenceRecord): {
  requestId: string;
  sessionId: string;
  action: EvidenceAction;
  paramsHash: string;
  resultHash: string;
  lawbookVersion: string | null;
  createdAt: string;
} {
  return {
    requestId: record.requestId,
    sessionId: record.sessionId,
    action: record.action,
    paramsHash: record.paramsHash,
    resultHash: record.resultHash,
    lawbookVersion: record.lawbookVersion,
    createdAt: record.createdAt,
  };
}

/**
 * Create secret-free error information for evidence failures
 * 
 * Returns structured error info without exposing secrets
 */
export function createEvidenceErrorInfo(
  error: Error,
  context: {
    requestId: string;
    sessionId: string;
    action: EvidenceAction;
  }
): {
  code: EvidenceErrorCode;
  message: string;
  requestId: string;
  sessionId: string;
  action: EvidenceAction;
  timestamp: string;
} {
  // Determine error code
  const code = (error as any).code || EVIDENCE_ERROR_CODES.INSERT_FAILED;
  
  // Sanitize error message (remove any potential secrets)
  let message = error.message;
  
  // Redact common secret patterns from error messages
  message = message.replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
  message = message.replace(/sk-[a-zA-Z0-9]+/g, '[REDACTED_KEY]');
  message = message.replace(/gho_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
  message = message.replace(/ghs_[a-zA-Z0-9]+/g, '[REDACTED_TOKEN]');
  message = message.replace(/(password|token|secret|key|credential)[:=]\s*\S+/gi, '$1=[REDACTED]');
  
  return {
    code,
    message,
    requestId: context.requestId,
    sessionId: context.sessionId,
    action: context.action,
    timestamp: new Date().toISOString(),
  };
}
