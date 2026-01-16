/**
 * Issue Draft Summary Schema v1
 * 
 * V09-I03: Draft Awareness Snapshot v1 (Get Draft Summary)
 * 
 * Compact snapshot for INTENT to reliably "see" the draft without full object.
 * Contains hash/status with stable Empty-State semantics.
 * 
 * NON-NEGOTIABLES:
 * - Deterministic bodyHash (same body → same hash)
 * - Empty state: exists: false + reason:"NO_DRAFT" (not an error)
 * - No PHI/Secrets in summary
 * - Validation status from last check
 */

import { z } from 'zod';

/**
 * Validation status enum
 */
export const ValidationStatusSchema = z.enum(['VALID', 'INVALID', 'UNKNOWN']);
export type ValidationStatus = z.infer<typeof ValidationStatusSchema>;

/**
 * Issue Draft Summary Schema v1
 * 
 * Compact representation of draft state for INTENT awareness.
 * When exists: false, only reason is populated.
 */
export const IssueDraftSummaryV1Schema = z.object({
  exists: z.boolean(),
  reason: z.string().optional(), // e.g., "NO_DRAFT" when exists: false
  canonicalId: z.string().optional(),
  title: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
  validationStatus: ValidationStatusSchema,
  bodyHash: z.string().optional(), // SHA-256 hash of normalized body (first 12 chars)
}).strict();

export type IssueDraftSummaryV1 = z.infer<typeof IssueDraftSummaryV1Schema>;

/**
 * Create an empty draft summary (no draft exists)
 */
export function createEmptyDraftSummary(): IssueDraftSummaryV1 {
  return {
    exists: false,
    reason: 'NO_DRAFT',
    validationStatus: 'UNKNOWN',
  };
}

/**
 * Create a draft summary from draft data
 * 
 * @param draft - The draft data from DB
 * @returns IssueDraftSummaryV1
 */
export function createDraftSummary(draft: {
  issue_json: unknown;
  issue_hash: string;
  updated_at: string;
  last_validation_status: 'unknown' | 'valid' | 'invalid';
}): IssueDraftSummaryV1 {
  // Parse issue_json to extract canonicalId and title
  let canonicalId: string | undefined;
  let title: string | undefined;
  
  try {
    // Use unknown and proper type guards instead of any
    const issueData: unknown = draft.issue_json;
    
    if (typeof issueData === 'object' && issueData !== null) {
      const data = issueData as Record<string, unknown>;
      canonicalId = typeof data.canonicalId === 'string' ? data.canonicalId : undefined;
      title = typeof data.title === 'string' ? data.title : undefined;
    }
  } catch {
    // If parsing fails, leave as undefined
  }
  
  // Map DB validation status to schema enum using object mapping
  const statusMap: Record<'valid' | 'invalid' | 'unknown', ValidationStatus> = {
    valid: 'VALID',
    invalid: 'INVALID',
    unknown: 'UNKNOWN',
  };
  
  const validationStatus: ValidationStatus = statusMap[draft.last_validation_status];
  
  return {
    exists: true,
    canonicalId,
    title,
    updatedAt: draft.updated_at,
    validationStatus,
    bodyHash: draft.issue_hash.substring(0, 12), // First 12 chars for compact display
  };
}
