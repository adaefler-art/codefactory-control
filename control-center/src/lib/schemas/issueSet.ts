/**
 * Issue Set Schema v1
 * 
 * Defines the deterministic contract for INTENT-generated issue sets.
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 * 
 * NON-NEGOTIABLES:
 * - Deterministic, strict schema with versioning
 * - Bounded arrays (max 20 issues per set)
 * - Stable ordering by canonicalId
 * - Deterministic hashing of briefing input
 * - No secrets or unbounded inputs
 */

import { z } from 'zod';
import type { IssueDraft } from './issueDraft';

/**
 * Active Issue Set Schema Versions
 */
export const ACTIVE_ISSUE_SET_VERSIONS = ['1.0'] as const;

/**
 * Allowed version type for Zod validation
 */
type AllowedIssueSetVersion = typeof ACTIVE_ISSUE_SET_VERSIONS[number];

/**
 * Issue Set Version
 * Current version: 1.0
 */
export const ISSUE_SET_VERSION: AllowedIssueSetVersion = '1.0';

/**
 * Issue Set Item
 * Represents a single issue draft within a set with validation status
 */
export const IssueSetItemSchema = z.object({
  canonicalId: z.string().min(1).max(50),
  issueDraft: z.any(), // IssueDraft type - validated separately
  validationStatus: z.enum(['unknown', 'valid', 'invalid']),
  validationErrors: z.array(z.string()).optional(),
}).strict();

export type IssueSetItem = z.infer<typeof IssueSetItemSchema>;

/**
 * Complete Issue Set Schema v1
 * 
 * Enforces:
 * - Version pinning
 * - Bounded issue count (max 20)
 * - Stable ordering (canonicalId sort)
 * - Source hash for determinism
 */
export const IssueSetSchema = z.object({
  issueSetVersion: z.enum(ACTIVE_ISSUE_SET_VERSIONS as unknown as [string, ...string[]]),
  issueSetId: z.string().uuid(),
  generatedAt: z.string().datetime(), // ISO 8601
  sourceHash: z.string().min(1),
  items: z.array(IssueSetItemSchema).max(20, 'Issue set must not exceed 20 items'),
  briefingText: z.string().max(50000).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type IssueSet = z.infer<typeof IssueSetSchema>;

/**
 * Normalize an issue set for deterministic processing
 * 
 * Rules:
 * - Sort items by canonicalId (stable, lexicographic)
 * - Trim strings
 * - Preserve validation status
 * 
 * @param issueSet - Raw issue set
 * @returns Normalized issue set
 */
export function normalizeIssueSet(issueSet: IssueSet): IssueSet {
  // Sort items by canonicalId for stable ordering
  const sortedItems = [...issueSet.items].sort((a, b) => 
    a.canonicalId.localeCompare(b.canonicalId)
  );

  return {
    ...issueSet,
    items: sortedItems,
    briefingText: issueSet.briefingText?.trim(),
  };
}

/**
 * Validate an issue set
 * 
 * Performs:
 * 1. Schema validation (Zod strict mode)
 * 2. Normalization (sort, trim)
 * 3. Re-validation of normalized result
 * 
 * @param data - Raw issue set data
 * @returns Validation result with normalized set or errors
 */
export function validateIssueSet(data: unknown): {
  success: true;
  data: IssueSet;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  // First validation pass
  const parseResult = IssueSetSchema.safeParse(data);
  
  if (!parseResult.success) {
    // Convert Zod errors to deterministic format
    const zodIssues = parseResult.error?.issues || [];
    const errors = zodIssues
      .map(err => ({
        path: err.path.join('.') || 'root',
        message: err.message,
      }))
      // Sort by path for deterministic ordering
      .sort((a, b) => a.path.localeCompare(b.path))
      // Bound error count (DoS-safe)
      .slice(0, 100);
    
    return {
      success: false,
      errors,
    };
  }

  // Normalize the set
  const normalized = normalizeIssueSet(parseResult.data);

  // Re-validate normalized result (should always pass, but safety check)
  const revalidate = IssueSetSchema.safeParse(normalized);
  
  if (!revalidate.success) {
    // This should never happen, but handle gracefully
    const zodIssues = revalidate.error?.issues || [];
    const errors = zodIssues
      .map(err => ({
        path: err.path.join('.') || 'root',
        message: `Normalization error: ${err.message}`,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 100);
    
    return {
      success: false,
      errors,
    };
  }

  return {
    success: true,
    data: normalized,
  };
}

/**
 * Stable stringify with sorted keys (recursive)
 */
function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => stableStringify(item)).join(',') + ']';
  }
  
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => {
    const value = stableStringify(obj[key]);
    return JSON.stringify(key) + ':' + value;
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Generate deterministic hash of briefing input
 * 
 * Uses stableStringify + sha256 for byte-stable output
 * 
 * @param briefingText - The briefing text
 * @param constraints - Optional constraints object
 * @returns SHA-256 hash (hex string)
 */
export async function generateBriefingHash(
  briefingText: string,
  constraints?: Record<string, unknown>
): Promise<string> {
  const crypto = await import('crypto');
  
  // Create stable representation
  const input = {
    briefing: briefingText.trim(),
    constraints: constraints || {},
  };
  
  // Sort all keys recursively for stable stringify
  const stableInput = stableStringify(input);
  
  // Generate SHA-256 hash
  return crypto.createHash('sha256').update(stableInput, 'utf8').digest('hex');
}
