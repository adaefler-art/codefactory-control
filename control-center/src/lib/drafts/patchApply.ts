/**
 * Issue Draft Patch Application Module (E86.5)
 * 
 * Provides deterministic, whitelist-based partial updates for Issue Drafts.
 * 
 * Key Features:
 * - Whitelist-based field updates (only allowed fields can be patched)
 * - Deterministic array operations (append, remove, replaceByIndex, replaceAll)
 * - Stable sorting for labels and dependsOn
 * - Idempotent operations (same patch + same draft = same result)
 * - Type-safe patch validation
 * 
 * NON-NEGOTIABLES:
 * - No arbitrary field updates (strict whitelist)
 * - Deterministic array operations with stable ordering
 * - No partial failures (atomic patch application)
 * - Clear error codes for validation failures
 */

import type { IssueDraft } from '../schemas/issueDraft';
import { normalizeIssueDraft } from '../schemas/issueDraft';
import { createHash } from 'crypto';

/**
 * Allowed fields for patching
 */
const PATCHABLE_FIELDS = [
  'title',
  'body',
  'labels',
  'dependsOn',
  'priority',
  'acceptanceCriteria',
  'kpi',
  'guards',
  'verify',
] as const;

type PatchableField = typeof PATCHABLE_FIELDS[number];

/**
 * Array operation types
 */
export type ArrayOperation =
  | { op: 'append'; values: string[] }
  | { op: 'remove'; values: string[] }
  | { op: 'replaceByIndex'; index: number; value: string }
  | { op: 'replaceAll'; values: string[] };

/**
 * Field patch value types
 */
export type FieldPatchValue =
  | string
  | string[]
  | ArrayOperation
  | { dcu?: 0.5 | 1 | 2; intent?: string }
  | { env: 'staging' | 'development'; prodBlocked: true }
  | { commands: string[]; expected: string[] };

/**
 * Patch structure
 */
export interface IssueDraftPatch {
  [key: string]: FieldPatchValue;
}

/**
 * Patch validation result
 */
export interface PatchValidationResult {
  valid: boolean;
  errors?: Array<{ field: string; code: string; message: string }>;
}

/**
 * Patch application result
 */
export interface PatchApplicationResult {
  success: boolean;
  draft?: IssueDraft;
  beforeHash?: string;
  afterHash?: string;
  patchHash?: string;
  diffSummary?: {
    changedFields: string[];
    addedItems?: number;
    removedItems?: number;
  };
  error?: string;
  code?: string;
}

/**
 * Validate patch against whitelist
 */
export function validatePatch(patch: IssueDraftPatch): PatchValidationResult {
  const errors: Array<{ field: string; code: string; message: string }> = [];

  for (const field of Object.keys(patch)) {
    if (!PATCHABLE_FIELDS.includes(field as PatchableField)) {
      errors.push({
        field,
        code: 'PATCH_FIELD_NOT_ALLOWED',
        message: `Field '${field}' is not allowed for patching. Allowed fields: ${PATCHABLE_FIELDS.join(', ')}`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

/**
 * Apply array operation to a string array
 */
function applyArrayOperation(
  currentArray: string[],
  operation: ArrayOperation
): string[] {
  switch (operation.op) {
    case 'append':
      return [...currentArray, ...operation.values];

    case 'remove': {
      const removeSet = new Set(operation.values);
      return currentArray.filter(item => !removeSet.has(item));
    }

    case 'replaceByIndex':
      if (operation.index < 0 || operation.index >= currentArray.length) {
        throw new Error(`Index ${operation.index} out of bounds for array of length ${currentArray.length}`);
      }
      const newArray = [...currentArray];
      newArray[operation.index] = operation.value;
      return newArray;

    case 'replaceAll':
      return operation.values;

    default:
      throw new Error(`Unknown array operation: ${(operation as any).op}`);
  }
}

/**
 * Compute hash of a draft (for determinism tracking)
 */
function computeDraftHash(draft: IssueDraft): string {
  const canonical = JSON.stringify(draft, Object.keys(draft).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Compute hash of a patch (for audit trail)
 */
function computePatchHash(patch: IssueDraftPatch): string {
  const canonical = JSON.stringify(patch, Object.keys(patch).sort());
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Apply patch to an issue draft
 * 
 * This function:
 * 1. Validates the patch (whitelist check)
 * 2. Applies each field update
 * 3. Handles array operations for labels, dependsOn, acceptanceCriteria
 * 4. Normalizes the result (dedup, sort)
 * 5. Computes hashes for audit trail
 * 
 * @param draft - Current issue draft
 * @param patch - Patch to apply
 * @returns Patch application result with updated draft or error
 */
export function applyPatchToDraft(
  draft: IssueDraft,
  patch: IssueDraftPatch
): PatchApplicationResult {
  // Validate patch
  const validation = validatePatch(patch);
  if (!validation.valid) {
    return {
      success: false,
      error: 'Patch validation failed',
      code: 'PATCH_VALIDATION_FAILED',
    };
  }

  try {
    // Compute beforeHash
    const beforeHash = computeDraftHash(draft);
    const patchHash = computePatchHash(patch);

    // Clone draft for mutation
    const updated: IssueDraft = { ...draft };
    const changedFields: string[] = [];
    let addedItems = 0;
    let removedItems = 0;

    // Apply each field in patch
    for (const [field, value] of Object.entries(patch)) {
      changedFields.push(field);

      switch (field as PatchableField) {
        case 'title':
          if (typeof value === 'string') {
            updated.title = value;
          }
          break;

        case 'body':
          if (typeof value === 'string') {
            updated.body = value;
          }
          break;

        case 'priority':
          if (value === 'P0' || value === 'P1' || value === 'P2') {
            updated.priority = value;
          }
          break;

        case 'labels':
          if (Array.isArray(value)) {
            // Direct replacement
            updated.labels = value as string[];
          } else if (typeof value === 'object' && value !== null && 'op' in value) {
            // Array operation
            const before = updated.labels.length;
            updated.labels = applyArrayOperation(updated.labels, value as ArrayOperation);
            const after = updated.labels.length;
            addedItems += Math.max(0, after - before);
            removedItems += Math.max(0, before - after);
          }
          break;

        case 'dependsOn':
          if (Array.isArray(value)) {
            updated.dependsOn = value as string[];
          } else if (typeof value === 'object' && value !== null && 'op' in value) {
            const before = updated.dependsOn.length;
            updated.dependsOn = applyArrayOperation(updated.dependsOn, value as ArrayOperation);
            const after = updated.dependsOn.length;
            addedItems += Math.max(0, after - before);
            removedItems += Math.max(0, before - after);
          }
          break;

        case 'acceptanceCriteria':
          if (Array.isArray(value)) {
            updated.acceptanceCriteria = value as string[];
          } else if (typeof value === 'object' && value !== null && 'op' in value) {
            const before = updated.acceptanceCriteria.length;
            updated.acceptanceCriteria = applyArrayOperation(
              updated.acceptanceCriteria,
              value as ArrayOperation
            );
            const after = updated.acceptanceCriteria.length;
            addedItems += Math.max(0, after - before);
            removedItems += Math.max(0, before - after);
          }
          break;

        case 'kpi':
          if (typeof value === 'object' && value !== null) {
            updated.kpi = value as { dcu?: 0.5 | 1 | 2; intent?: string };
          }
          break;

        case 'guards':
          if (typeof value === 'object' && value !== null) {
            updated.guards = value as { env: 'staging' | 'development'; prodBlocked: true };
          }
          break;

        case 'verify':
          if (typeof value === 'object' && value !== null) {
            updated.verify = value as { commands: string[]; expected: string[] };
          }
          break;
      }
    }

    // Normalize the result (dedup, sort)
    const normalized = normalizeIssueDraft(updated);

    // Compute afterHash
    const afterHash = computeDraftHash(normalized);

    return {
      success: true,
      draft: normalized,
      beforeHash,
      afterHash,
      patchHash,
      diffSummary: {
        changedFields,
        addedItems: addedItems > 0 ? addedItems : undefined,
        removedItems: removedItems > 0 ? removedItems : undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'PATCH_APPLICATION_FAILED',
    };
  }
}
