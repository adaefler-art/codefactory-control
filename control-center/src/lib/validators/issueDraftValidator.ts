/**
 * Issue Draft Validator Library
 * Issue E81.2: INTENT Tools create/update Issue Draft (session-bound)
 * 
 * Provides deterministic validation of Issue Draft JSON with standardized error format.
 * Based on CR validator pattern with issue-specific rules.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic validation output with stable error ordering
 * - Standard error format across APIs
 * - No network calls (pure validation)
 * - No secrets or env dumps in errors
 */

import { createHash } from 'crypto';
import { 
  IssueDraftSchema, 
  validateIssueDraft as schemaValidateIssueDraft,
  normalizeIssueDraft,
  type IssueDraft 
} from '../schemas/issueDraft';

/**
 * Validator version - increment on breaking changes to validation logic
 */
export const VALIDATOR_VERSION = '1.0.0';

/**
 * Error severity levels
 */
export type ValidationSeverity = 'error' | 'warning';

/**
 * Standard validation error format
 */
export interface ValidationError {
  code: string;
  message: string;
  path: string;  // JSON pointer-ish (e.g., "/acceptanceCriteria/0" or "/title")
  severity: ValidationSeverity;
  details?: Record<string, unknown>;
}

/**
 * Validation result metadata
 */
export interface ValidationMeta {
  issueDraftVersion?: string;
  validatedAt: string;  // ISO 8601
  validatorVersion: string;
  hash?: string;  // sha256 of canonical Issue Draft JSON
}

/**
 * Complete validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  meta: ValidationMeta;
}

/**
 * Validation error codes
 */
export const ERROR_CODES = {
  ISSUE_SCHEMA_INVALID: 'ISSUE_SCHEMA_INVALID',
  ISSUE_SEMANTIC_INVALID: 'ISSUE_SEMANTIC_INVALID',
  ISSUE_AC_MISSING: 'ISSUE_AC_MISSING',
  ISSUE_CANONICAL_ID_INVALID: 'ISSUE_CANONICAL_ID_INVALID',
} as const;

/**
 * Canonicalize an issue draft to deterministic JSON string
 * 
 * Rules:
 * - Normalize the draft (dedup, sort, trim)
 * - Sort object keys alphabetically
 * - No whitespace in output
 * - UTF-8 encoding
 * 
 * @param draft - Normalized issue draft
 * @returns Canonical JSON string
 */
export function canonicalizeIssueDraftToJSON(draft: IssueDraft): string {
  // Use normalized draft as input
  const normalized = normalizeIssueDraft(draft);
  
  // Sort keys alphabetically for deterministic output
  const sortedDraft: any = {};
  const keys = Object.keys(normalized).sort();
  
  for (const key of keys) {
    const value = (normalized as any)[key];
    
    // Handle nested objects
    if (key === 'kpi' && value) {
      sortedDraft[key] = {
        ...(value.dcu !== undefined ? { dcu: value.dcu } : {}),
        ...(value.intent !== undefined ? { intent: value.intent } : {}),
      };
    } else if (key === 'verify') {
      sortedDraft[key] = {
        commands: value.commands,
        expected: value.expected,
      };
    } else if (key === 'guards') {
      sortedDraft[key] = {
        env: value.env,
        prodBlocked: value.prodBlocked,
      };
    } else {
      sortedDraft[key] = value;
    }
  }
  
  // Serialize without whitespace
  return JSON.stringify(sortedDraft);
}

/**
 * Validate an Issue Draft JSON object
 * 
 * Performs multi-layer validation:
 * 1. Schema validation (Zod via issueDraft schema)
 * 2. Semantic validation (counts, format checks)
 * 3. Hash generation for idempotency
 * 
 * @param issueDraftJson - The issue draft JSON object to validate
 * @returns ValidationResult with isValid status, errors, warnings, and metadata
 */
export function validateIssueDraft(issueDraftJson: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const validatedAt = new Date().toISOString();

  let parsedDraft: IssueDraft | null = null;
  let issueDraftVersion: string | undefined;
  let hash: string | undefined;

  // Layer 1: Schema validation via Zod
  const schemaResult = schemaValidateIssueDraft(issueDraftJson);
  
  if (!schemaResult.success) {
    // Convert schema errors to standard format
    const schemaErrors = schemaResult.errors || [];
    schemaErrors.forEach((err) => {
      errors.push({
        code: ERROR_CODES.ISSUE_SCHEMA_INVALID,
        message: err.message,
        path: '/' + err.path,
        severity: 'error',
      });
    });

    // Can't proceed with semantic validation if schema is invalid
    return {
      isValid: false,
      errors: sortErrors(errors),
      warnings: sortErrors(warnings),
      meta: {
        issueDraftVersion,
        validatedAt,
        validatorVersion: VALIDATOR_VERSION,
        hash,
      },
    };
  }

  // Schema is valid, extract normalized draft
  parsedDraft = schemaResult.data;
  issueDraftVersion = parsedDraft.issueDraftVersion;

  // Generate hash of canonical JSON
  try {
    const canonicalJSON = canonicalizeIssueDraftToJSON(parsedDraft);
    hash = createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
  } catch (hashError) {
    // Hash generation is best-effort; don't fail validation if it errors
    warnings.push({
      code: 'ISSUE_HASH_FAILED',
      message: 'Failed to generate issue draft hash',
      path: '/',
      severity: 'warning',
      details: { error: String(hashError) },
    });
  }

  // Layer 2: Additional semantic validation
  if (parsedDraft) {
    // Verify acceptance criteria count (should be caught by schema, but double-check)
    if (parsedDraft.acceptanceCriteria.length === 0) {
      errors.push({
        code: ERROR_CODES.ISSUE_AC_MISSING,
        message: 'At least one acceptance criterion is required',
        path: '/acceptanceCriteria',
        severity: 'error',
      });
    }

    // Warn if dependsOn references itself
    if (parsedDraft.dependsOn.includes(parsedDraft.canonicalId)) {
      warnings.push({
        code: 'ISSUE_SELF_DEPENDENCY',
        message: 'Issue depends on itself (circular dependency)',
        path: '/dependsOn',
        severity: 'warning',
        details: { canonicalId: parsedDraft.canonicalId },
      });
    }
  }

  // Determine overall isValid status
  const isValid = errors.length === 0;

  return {
    isValid,
    errors: sortErrors(errors),
    warnings: sortErrors(warnings),
    meta: {
      issueDraftVersion,
      validatedAt,
      validatorVersion: VALIDATOR_VERSION,
      hash,
    },
  };
}

/**
 * Sort errors deterministically for stable, predictable output
 * 
 * Sorting order (total ordering):
 * 1. path (alphabetically)
 * 2. code (alphabetically)
 * 3. severity (error before warning)
 * 4. message (alphabetically)
 * 
 * This ensures repeated runs produce identical error arrays.
 */
function sortErrors(errors: ValidationError[]): ValidationError[] {
  return [...errors].sort((a, b) => {
    // First sort by path
    const pathCompare = a.path.localeCompare(b.path);
    if (pathCompare !== 0) return pathCompare;

    // Then by code
    const codeCompare = a.code.localeCompare(b.code);
    if (codeCompare !== 0) return codeCompare;
    
    // Then by severity (error before warning)
    const severityCompare = a.severity.localeCompare(b.severity);
    if (severityCompare !== 0) return severityCompare;
    
    // Finally by message (for total ordering)
    return a.message.localeCompare(b.message);
  });
}
