/**
 * Change Request Validator Library
 * Issue E74.2: CR Validator Library + Standard Error Format
 * 
 * Provides deterministic validation of CR JSON with standardized error format.
 * Usable by both UI and CI/CD pipelines.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic validation output with stable error ordering
 * - Standard error format across APIs
 * - No network calls (pure validation)
 * - Policy checks beyond schema (evidence, tests, size limits, path validation)
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import { ChangeRequestSchema, canonicalizeChangeRequestToJSON, type ChangeRequest } from '../schemas/changeRequest';

/**
 * Validator version - increment on breaking changes to validation logic
 */
export const VALIDATOR_VERSION = '0.7.0';

/**
 * Error severity levels
 */
export type ValidationSeverity = 'error' | 'warn';

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
  crVersion?: string;
  validatedAt: string;  // ISO 8601
  validatorVersion: string;
  lawbookVersion?: string | null;
  hash?: string;  // sha256 of canonical CR JSON
}

/**
 * Complete validation result
 */
export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  meta: ValidationMeta;
}

/**
 * Size limits for CR fields
 */
const SIZE_LIMITS = {
  title: 120,
  motivation: 5000,
  files: 100,
  evidence: 50,
} as const;

/**
 * Validation error codes
 */
export const ERROR_CODES = {
  CR_SCHEMA_INVALID: 'CR_SCHEMA_INVALID',
  CR_SEMANTIC_INVALID: 'CR_SEMANTIC_INVALID',
  CR_EVIDENCE_MISSING: 'CR_EVIDENCE_MISSING',
  CR_TESTS_MISSING: 'CR_TESTS_MISSING',
  CR_AC_MISSING: 'CR_AC_MISSING',
  CR_SIZE_LIMIT: 'CR_SIZE_LIMIT',
  CR_PATH_INVALID: 'CR_PATH_INVALID',
  CR_TARGET_NOT_ALLOWED: 'CR_TARGET_NOT_ALLOWED',
} as const;

/**
 * Check if path contains forbidden patterns
 * 
 * Allowed: Relative POSIX paths with forward slashes (e.g., "control-center/src/lib/x.ts")
 * 
 * Forbidden patterns:
 * - ".." as a path segment (directory traversal)
 * - "\\" (backslashes - use forward slashes only)
 * - Absolute paths (starting with /)
 * - Drive-letter absolute paths (e.g., "C:\\" or "C:/")
 */
function hasForbiddenPathPattern(path: string): boolean {
  // Reject paths starting with / (absolute POSIX paths)
  if (path.startsWith('/')) {
    return true;
  }
  
  // Reject paths containing backslashes
  if (path.includes('\\')) {
    return true;
  }
  
  // Reject drive-letter absolute paths (e.g., "C:/" or "C:\")
  if (/^[a-zA-Z]:/.test(path)) {
    return true;
  }
  
  // Reject ".." as a path segment (directory traversal)
  // Split by / and check each segment
  const segments = path.split('/');
  if (segments.some(segment => segment === '..')) {
    return true;
  }
  
  return false;
}

/**
 * Validate a Change Request JSON object
 * 
 * Performs multi-layer validation:
 * 1. Schema validation (Zod)
 * 2. Semantic validation (size limits, path patterns, counts)
 * 3. Policy checks (optional - repo/branch allowlist if config provided)
 * 
 * @param crJson - The CR JSON object to validate
 * @param options - Optional validation options
 * @returns ValidationResult with ok status, errors, warnings, and metadata
 */
export function validateChangeRequest(
  crJson: unknown,
  options?: {
    allowedRepos?: Array<{ owner: string; repo: string }>;
    allowedBranches?: string[];
  }
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const validatedAt = new Date().toISOString();

  let parsedCR: ChangeRequest | null = null;
  let crVersion: string | undefined;
  let lawbookVersion: string | null | undefined;
  let hash: string | undefined;

  // Layer 1: Zod schema validation
  try {
    parsedCR = ChangeRequestSchema.parse(crJson);
    crVersion = parsedCR.crVersion;
    lawbookVersion = parsedCR.constraints.lawbookVersion;

    // Generate hash of canonical JSON
    try {
      const canonicalJSON = canonicalizeChangeRequestToJSON(parsedCR);
      hash = createHash('sha256').update(canonicalJSON, 'utf8').digest('hex');
    } catch (hashError) {
      // Hash generation is best-effort; don't fail validation if it errors
      warnings.push({
        code: 'CR_HASH_FAILED',
        message: 'Failed to generate CR hash',
        path: '/',
        severity: 'warn',
        details: { error: String(hashError) },
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Convert Zod errors to standard format
      error.issues.forEach((issue) => {
        const path = '/' + issue.path.join('/');
        errors.push({
          code: ERROR_CODES.CR_SCHEMA_INVALID,
          message: issue.message,
          path,
          severity: 'error',
          details: { zodCode: issue.code },
        });
      });
    } else {
      // Unexpected error
      errors.push({
        code: ERROR_CODES.CR_SCHEMA_INVALID,
        message: 'Schema validation failed with unexpected error',
        path: '/',
        severity: 'error',
        details: { error: String(error) },
      });
    }

    // Can't proceed with semantic validation if schema is invalid
    return {
      ok: false,
      errors: sortErrors(errors),
      warnings: sortErrors(warnings),
      meta: {
        crVersion,
        validatedAt,
        validatorVersion: VALIDATOR_VERSION,
        lawbookVersion,
        hash,
      },
    };
  }

  // Layer 2: Semantic validation (now that we have a valid CR)
  if (parsedCR) {
    // Check acceptance criteria count (redundant with schema, but explicit)
    if (parsedCR.acceptanceCriteria.length === 0) {
      errors.push({
        code: ERROR_CODES.CR_AC_MISSING,
        message: 'At least one acceptance criterion is required',
        path: '/acceptanceCriteria',
        severity: 'error',
      });
    }

    // Check tests.required count (redundant with schema, but explicit)
    if (parsedCR.tests.required.length === 0) {
      errors.push({
        code: ERROR_CODES.CR_TESTS_MISSING,
        message: 'At least one required test is required',
        path: '/tests/required',
        severity: 'error',
      });
    }

    // Check evidence count (redundant with schema, but explicit)
    if (parsedCR.evidence.length === 0) {
      errors.push({
        code: ERROR_CODES.CR_EVIDENCE_MISSING,
        message: 'At least one evidence entry is required',
        path: '/evidence',
        severity: 'error',
      });
    }

    // Check size limits
    if (parsedCR.title.length > SIZE_LIMITS.title) {
      errors.push({
        code: ERROR_CODES.CR_SIZE_LIMIT,
        message: `Title exceeds maximum length of ${SIZE_LIMITS.title} characters`,
        path: '/title',
        severity: 'error',
        details: { limit: SIZE_LIMITS.title, actual: parsedCR.title.length },
      });
    }

    if (parsedCR.motivation.length > SIZE_LIMITS.motivation) {
      errors.push({
        code: ERROR_CODES.CR_SIZE_LIMIT,
        message: `Motivation exceeds maximum length of ${SIZE_LIMITS.motivation} characters`,
        path: '/motivation',
        severity: 'error',
        details: { limit: SIZE_LIMITS.motivation, actual: parsedCR.motivation.length },
      });
    }

    if (parsedCR.changes.files.length > SIZE_LIMITS.files) {
      errors.push({
        code: ERROR_CODES.CR_SIZE_LIMIT,
        message: `Number of files exceeds maximum of ${SIZE_LIMITS.files}`,
        path: '/changes/files',
        severity: 'error',
        details: { limit: SIZE_LIMITS.files, actual: parsedCR.changes.files.length },
      });
    }

    if (parsedCR.evidence.length > SIZE_LIMITS.evidence) {
      errors.push({
        code: ERROR_CODES.CR_SIZE_LIMIT,
        message: `Number of evidence entries exceeds maximum of ${SIZE_LIMITS.evidence}`,
        path: '/evidence',
        severity: 'error',
        details: { limit: SIZE_LIMITS.evidence, actual: parsedCR.evidence.length },
      });
    }

    // Check file paths for forbidden patterns
    parsedCR.changes.files.forEach((file, index) => {
      if (hasForbiddenPathPattern(file.path)) {
        errors.push({
          code: ERROR_CODES.CR_PATH_INVALID,
          message: `File path contains forbidden pattern (no "..", backslashes, or absolute paths): ${file.path}`,
          path: `/changes/files/${index}/path`,
          severity: 'error',
          details: { invalidPath: file.path },
        });
      }
    });

    // Layer 3: Policy checks (optional)
    if (options?.allowedRepos && options.allowedRepos.length > 0) {
      const targetRepo = parsedCR.targets.repo;
      const isRepoAllowed = options.allowedRepos.some(
        (allowed) => allowed.owner === targetRepo.owner && allowed.repo === targetRepo.repo
      );

      if (!isRepoAllowed) {
        errors.push({
          code: ERROR_CODES.CR_TARGET_NOT_ALLOWED,
          message: `Target repository ${targetRepo.owner}/${targetRepo.repo} is not in the allowed list`,
          path: '/targets/repo',
          severity: 'error',
          details: { targetRepo },
        });
      }
    }

    if (options?.allowedBranches && options.allowedBranches.length > 0) {
      const targetBranch = parsedCR.targets.branch;
      const isBranchAllowed = options.allowedBranches.includes(targetBranch);

      if (!isBranchAllowed) {
        warnings.push({
          code: ERROR_CODES.CR_TARGET_NOT_ALLOWED,
          message: `Target branch "${targetBranch}" is not in the allowed list`,
          path: '/targets/branch',
          severity: 'warn',
          details: { targetBranch, allowedBranches: options.allowedBranches },
        });
      }
    }

    // Check for lawbookVersion presence
    if (!parsedCR.constraints.lawbookVersion) {
      warnings.push({
        code: 'CR_LAWBOOK_VERSION_MISSING',
        message: 'lawbookVersion is not specified in constraints',
        path: '/constraints/lawbookVersion',
        severity: 'warn',
      });
    }
  }

  // Determine overall ok status
  const ok = errors.length === 0;

  return {
    ok,
    errors: sortErrors(errors),
    warnings: sortErrors(warnings),
    meta: {
      crVersion,
      validatedAt,
      validatorVersion: VALIDATOR_VERSION,
      lawbookVersion,
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
 * 3. severity (error before warn)
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
    
    // Then by severity (error before warn)
    const severityCompare = a.severity.localeCompare(b.severity);
    if (severityCompare !== 0) return severityCompare;
    
    // Finally by message (for total ordering)
    return a.message.localeCompare(b.message);
  });
}
