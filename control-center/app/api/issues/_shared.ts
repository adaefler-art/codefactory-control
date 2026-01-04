/**
 * Shared helpers for Issues API routes.
 *
 * **Issue #3: Identifier Consistency**
 * 
 * Implements unified identifier handling:
 * - `id` = UUID v4 (canonical, internal identifier)
 * - `publicId` = 8-hex display format (derived from UUID prefix)
 * 
 * API Contract:
 * - Accepts: UUID v4 OR 8-hex prefix (read-only lookup)
 * - Returns: 200 (found), 404 (not found), 400 (invalid format)
 * - Guarantees: No 400 for any valid UUID or 8-hex prefix
 * 
 * **Issue I2: State Model v1**
 * 
 * Computes and includes State Model v1 fields in API responses:
 * - localStatus, githubStatusRaw, githubMirrorStatus
 * - executionState, handoffState
 * - effectiveStatus (computed server-side using canonical helpers)
 * 
 * Features:
 * - Identifier parsing (UUID v4 OR 8-hex publicId)
 * - DB lookup by internal UUID or publicId
 * - Consistent API response shape w/ ISO timestamps
 * - Contract validation for output safety
 */

import { normalizeOutput } from '@/lib/api/normalize-output';
import { isAfu9IssueOutput } from '@/lib/contracts/outputContracts';
import type { Pool } from 'pg';
import {
  parseIssueId,
  toShortHex8FromUuid,
  type IssueIdentifierKind,
} from '../../../src/lib/contracts/ids';
import { toIsoStringOrNull } from '../../../src/lib/contracts/dates';
import {
  getAfu9IssueById,
  getAfu9IssueByPublicId,
} from '../../../src/lib/db/afu9Issues';
import { computeEffectiveStatus } from '../../../src/lib/issues/stateModel';
import type {
  LocalStatus,
  GithubMirrorStatus,
  ExecutionState,
  HandoffState,
} from '../../../src/lib/schemas/issueStateModel';

export { type IssueIdentifierKind };

/**
 * Classify an issue identifier string
 * 
 * Maps internal 'shortHex8' kind to 'publicId' for API compatibility.
 * 
 * @param value - Identifier to classify
 * @returns 'uuid' | 'publicId' | 'invalid'
 */
export function classifyIssueIdentifier(value: string): IssueIdentifierKind {
  const parsed = parseIssueId(value);
  // Map shortHex8 to publicId for API semantics
  return parsed.kind === 'shortHex8' ? 'publicId' : parsed.kind;
}

/**
 * Convert UUID to publicId (8-hex display format)
 * 
 * @param uuid - Canonical UUID identifier
 * @returns 8-hex publicId or null
 */
export function toPublicIdFromUuid(uuid: string): string | null {
  return toShortHex8FromUuid(uuid);
}

function toIsoOrNull(value: unknown): string | null {
  return toIsoStringOrNull(value);
}

/**
 * Fetch issue row by identifier (UUID or publicId)
 * 
 * **Issue #3: Identifier Consistency Contract**
 * 
 * This function implements the authoritative identifier handling for all
 * Issues API endpoints. It enforces the following contract:
 * 
 * - Accepts: Valid UUID v4 OR valid 8-hex publicId
 * - Returns: 200 (success), 404 (not found), 400 (invalid format)
 * - Guarantee: No 400 for any valid UUID or 8-hex prefix
 * 
 * @param pool - Database connection pool
 * @param idOrPublicId - Either full UUID or 8-hex publicId
 * @returns Resolved issue row or error with appropriate status code
 */
export async function fetchIssueRowByIdentifier(pool: Pool, idOrPublicId: string) {
  const rawValue = typeof idOrPublicId === 'string' ? idOrPublicId : '';
  const parsed = parseIssueId(rawValue);
  
  // Invalid format → 400 Bad Request
  if (!parsed.isValid) {
    return {
      ok: false as const,
      status: 400 as const,
      body: { error: 'Invalid issue ID format' },
    };
  }

  const normalized = parsed.value;
  // Map shortHex8 to publicId for database lookup
  const kind = parsed.kind === 'shortHex8' ? 'publicId' : parsed.kind;

  // Lookup by UUID (canonical) or publicId (8-hex prefix)
  const result =
    kind === 'uuid'
      ? await getAfu9IssueById(pool, normalized)
      : await getAfu9IssueByPublicId(pool, normalized);

  // Database error → 500 Internal Server Error
  if (!result.success) {
    const msg = typeof (result as any)?.error === 'string' ? String((result as any).error) : '';
    const isNotFound = msg.toLowerCase().includes('issue not found');

    return {
      ok: false as const,
      status: (isNotFound ? 404 : 500) as const,
      body: isNotFound
        ? { error: 'Issue not found', id: normalized }
        : { error: 'Failed to fetch issue', details: msg || 'Unknown error' },
    };
  }

  // No data returned → 404 Not Found
  if (!result.data) {
    return {
      ok: false as const,
      status: 404 as const,
      body: { error: 'Issue not found', id: normalized },
    };
  }

  // Success → 200 OK
  return {
    ok: true as const,
    status: 200 as const,
    row: result.data,
  };
}

/**
 * Normalize issue data for API response
 * 
 * Transforms database row into API-friendly format with:
 * - Both `id` (UUID canonical) and `publicId` (8-hex display)
 * - ISO 8601 timestamps
 * - Contract validation for safety
 * - Both camelCase and snake_case fields for backward compatibility
 * - State Model v1 fields with computed effectiveStatus (I2)
 * 
 * @param input - Raw database row
 * @returns Normalized API response object
 */
export function normalizeIssueForApi(input: unknown): any {
  // Step 1: Normalize output (Date -> ISO string, etc.)
  const normalized = normalizeOutput(input) as any;

  const internalId =
    typeof normalized?.id === 'string'
      ? normalized.id
      : typeof normalized?.issue_id === 'string'
        ? normalized.issue_id
        : '';

  const publicId =
    typeof normalized?.publicId === 'string'
      ? normalized.publicId
      : typeof normalized?.public_id === 'string'
        ? normalized.public_id
        : toPublicIdFromUuid(internalId);

  const createdAt = toIsoOrNull(normalized?.createdAt ?? normalized?.created_at);
  const updatedAt = toIsoOrNull(normalized?.updatedAt ?? normalized?.updated_at);
  const activatedAt = toIsoOrNull(normalized?.activatedAt ?? normalized?.activated_at);
  const activatedBy = normalized?.activatedBy ?? normalized?.activated_by ?? null;
  const executionStartedAt = toIsoOrNull(normalized?.executionStartedAt ?? normalized?.execution_started_at);
  const executionCompletedAt = toIsoOrNull(normalized?.executionCompletedAt ?? normalized?.execution_completed_at);
  const deletedAt = toIsoOrNull(normalized?.deletedAt ?? normalized?.deleted_at);

  // I2: Extract State Model v1 fields
  const localStatus = (normalized?.status ?? 'CREATED') as LocalStatus;
  const githubStatusRaw = normalized?.githubStatusRaw ?? normalized?.github_status_raw ?? null;
  const githubMirrorStatus = (normalized?.githubMirrorStatus ?? normalized?.github_mirror_status ?? 'UNKNOWN') as GithubMirrorStatus;
  const executionState = (normalized?.executionState ?? normalized?.execution_state ?? 'IDLE') as ExecutionState;
  const handoffState = (normalized?.handoffState ?? normalized?.handoff_state ?? 'UNSYNCED') as HandoffState;
  const githubLastSyncedAt = toIsoOrNull(normalized?.githubIssueLastSyncAt ?? normalized?.github_issue_last_sync_at);

  // I2: Compute effectiveStatus server-side using canonical helpers
  const effectiveStatus = computeEffectiveStatus({
    localStatus,
    githubMirrorStatus,
    executionState,
    handoffState,
  });

  // Build the core contract fields (snake_case for contract validation)
  const contractData: any = {
    id: internalId,
    title: typeof normalized?.title === 'string' ? normalized.title : '',
    body: normalized?.body ?? null,
    status: localStatus,
    labels: Array.isArray(normalized?.labels) ? normalized.labels : [],
    priority: normalized?.priority ?? null,
    assignee: normalized?.assignee ?? null,
    source: normalized?.source ?? null,
    handoff_state: handoffState,
    github_issue_number: normalized?.githubIssueNumber ?? normalized?.github_issue_number ?? null,
    github_url: normalized?.githubUrl ?? normalized?.github_url ?? null,
    last_error: normalized?.lastError ?? normalized?.last_error ?? null,
    created_at: createdAt,
    updated_at: updatedAt,
    activated_at: activatedAt,
    execution_state: executionState,
    execution_started_at: executionStartedAt,
    execution_completed_at: executionCompletedAt,
    execution_output: normalized?.executionOutput ?? normalized?.execution_output ?? null,
    deleted_at: deletedAt,
  };

  // Step 2: Validate against output contract
  if (!isAfu9IssueOutput(contractData)) {
    // Log validation failure with field evidence for debugging
    const evidence: Record<string, string> = {};
    const checkField = (field: string) => {
      const value = contractData[field];
      evidence[field] = `type=${typeof value}, isNull=${value === null}, isArray=${Array.isArray(value)}`;
    };
    
    checkField('id');
    checkField('title');
    checkField('status');
    checkField('created_at');
    checkField('updated_at');
    
    console.error('[normalizeIssueForApi] Output contract validation failed', {
      id: internalId,
      publicId,
      evidence,
    });
    throw new Error('Afu9IssueOutput contract validation failed');
  }

  // Step 3: Return API-friendly format with both camelCase and snake_case
  const api: any = {
    // Required/primary fields
    id: internalId,
    publicId: publicId ?? null,
    title: contractData.title,
    status: contractData.status,
    labels: contractData.labels,
    createdAt,
    updatedAt,

    // Common optional fields (camelCase)
    body: contractData.body,
    description: contractData.body, // Alias for backward compatibility
    priority: contractData.priority,
    assignee: contractData.assignee,
    source: contractData.source,
    handoffState: contractData.handoff_state,
    githubIssueNumber: contractData.github_issue_number,
    githubUrl: contractData.github_url,
    lastError: contractData.last_error,
    activatedAt,
    activatedBy,
    executionState: contractData.execution_state,
    executionStartedAt,
    executionCompletedAt,
    executionOutput: contractData.execution_output,
    deletedAt,

    // I2: State Model v1 fields (camelCase)
    localStatus,
    githubStatusRaw,
    githubMirrorStatus,
    effectiveStatus,
    githubLastSyncedAt,
  };

  // Backwards-compatible snake_case aliases used by existing UI/components.
  api.handoff_state = api.handoffState;
  api.github_issue_number = api.githubIssueNumber;
  api.github_url = api.githubUrl;
  api.last_error = api.lastError;
  api.created_at = createdAt;
  api.updated_at = updatedAt;
  api.activated_at = activatedAt;
  api.activated_by = activatedBy;
  api.execution_state = api.executionState;
  api.execution_started_at = executionStartedAt;
  api.execution_completed_at = executionCompletedAt;
  api.execution_output = api.executionOutput;
  api.deleted_at = deletedAt;

  // I2: State Model v1 snake_case aliases
  api.local_status = localStatus;
  api.github_status_raw = githubStatusRaw;
  api.github_mirror_status = githubMirrorStatus;
  api.effective_status = effectiveStatus;
  api.github_last_synced_at = githubLastSyncedAt;

  return api;
}
