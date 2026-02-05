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
import { createHash } from 'crypto';
import {
  parseIssueId,
  toShortHex8FromUuid,
  type IssueIdentifierKind,
} from '../../../src/lib/contracts/ids';
import { toIsoStringOrNull } from '../../../src/lib/contracts/dates';
import { getPool } from '../../../src/lib/db';
import {
  Afu9IssueInput,
  Afu9IssueStatus,
  isValidPriority,
  isValidStatus,
} from '../../../src/lib/contracts/afu9Issue';
import {
  getAfu9IssueById,
  getAfu9IssueByPublicId,
  upsertAfu9IssueFromEngine,
} from '../../../src/lib/db/afu9Issues';
import { computeEffectiveStatus } from '../../../src/lib/issues/stateModel';
import type {
  LocalStatus,
  GithubMirrorStatus,
  ExecutionState,
  HandoffState,
} from '../../../src/lib/schemas/issueStateModel';

export { type IssueIdentifierKind };

export type ResolvedIssueIdentifier = {
  ok: true;
  type: 'uuid' | 'shortid';
  uuid: string;
  shortId?: string;
  issue?: Record<string, unknown>;
  source: 'control' | 'engine';
};

export type ResolveIssueIdentifierError = {
  ok: false;
  status: number;
  body: {
    errorCode: string;
    issueId: string;
    lookupStore?: string;
    requestId: string;
  };
};

type ServiceTokenSource = 'authorization' | 'x-afu9-service-token' | 'x-service-token';
type ServiceTokenReason = 'missing' | 'malformed';

export function normalizeServiceToken(value: unknown): string {
  let token = String(value ?? '').trim();

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }

  token = token.replace(/\r?\n/g, '').trim();

  return token;
}

export function extractServiceTokenFromHeaders(headers: Headers): {
  token?: string;
  source?: ServiceTokenSource;
  reason?: ServiceTokenReason;
} {
  const authHeader = headers.get('authorization');
  if (authHeader) {
    const trimmed = authHeader.trim();
    const match = /^Bearer\s+(.+)$/i.exec(trimmed);
    if (!match) {
      return { reason: 'malformed' };
    }
    const token = normalizeServiceToken(match[1]);
    if (!token) {
      return { reason: 'missing' };
    }
    return { token, source: 'authorization' };
  }

  const headerToken = headers.get('x-afu9-service-token');
  if (headerToken) {
    const token = normalizeServiceToken(headerToken);
    if (!token) {
      return { reason: 'missing' };
    }
    return { token, source: 'x-afu9-service-token' };
  }

  const fallbackToken = headers.get('x-service-token');
  if (fallbackToken) {
    const token = normalizeServiceToken(fallbackToken);
    if (!token) {
      return { reason: 'missing' };
    }
    return { token, source: 'x-service-token' };
  }

  return { reason: 'missing' };
}

export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function getServiceTokenDebugInfo(received: string, expected: string) {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8);
  return {
    receivedTokenLen: received.length,
    expectedTokenLen: expected.length,
    receivedHashPrefix: hash(received),
    expectedHashPrefix: hash(expected),
  };
}

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

export function getControlResponseHeaders(requestId: string): Record<string, string> {
  return {
    'x-afu9-auth-path': 'control',
    'x-afu9-request-id': requestId,
  };
}

function buildIssueIdentifierError(
  params: {
    status: number;
    errorCode: string;
    issueId: string;
    requestId: string;
    lookupStore?: string;
  }
): ResolveIssueIdentifierError {
  return {
    ok: false,
    status: params.status,
    body: {
      errorCode: params.errorCode,
      issueId: params.issueId,
      requestId: params.requestId,
      lookupStore: params.lookupStore,
    },
  };
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
  const githubSyncError = normalized?.githubSyncError ?? normalized?.github_sync_error ?? null;

  // E61.3: Extract GitHub handoff mirror metadata
  const handoffAt = toIsoOrNull(normalized?.handoffAt ?? normalized?.handoff_at);
  const handoffError = normalized?.handoffError ?? normalized?.handoff_error ?? null;
  const githubRepo = normalized?.githubRepo ?? normalized?.github_repo ?? null;

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
    githubSyncError,

    // E61.3: GitHub handoff mirror metadata (camelCase)
    handoffAt,
    handoffError,
    githubRepo,
    // UI compatibility: mirror -> S1 stored refs
    repository: githubRepo ?? null,
    repoFullName: githubRepo ?? null,
    issueNumber: contractData.github_issue_number ?? null,
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
  api.github_sync_error = githubSyncError;

  // E61.3: GitHub handoff mirror metadata snake_case aliases
  api.handoff_at = handoffAt;
  api.handoff_error = handoffError;
  api.github_repo = githubRepo;

  return api;
}

function getStringField(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry) => typeof entry === 'string') as string[];
  return items.length > 0 ? items : undefined;
}

function normalizeEngineBaseUrl(raw?: string | null): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/$/, '');
}

async function fetchIssueFromEngine(
  issueId: string,
  requestId: string
): Promise<
  | { ok: true; issue: Record<string, unknown> | null }
  | { ok: false; status: number; message: string }
> {
  const engineBaseUrl = normalizeEngineBaseUrl(
    process.env.ENGINE_BASE_URL || process.env.ENGINE_URL
  );
  const engineToken = process.env.AFU9_SERVICE_TOKEN || process.env.ENGINE_SERVICE_TOKEN || '';

  const url = `${engineBaseUrl}/api/issues/${encodeURIComponent(issueId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-afu9-service-token': engineToken,
      'x-request-id': requestId,
    },
  });

  if (response.status === 404) {
    return { ok: true, issue: null };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: 'Engine issue lookup failed',
    };
  }

  try {
    const issue = (await response.json()) as Record<string, unknown>;
    return { ok: true, issue };
  } catch {
    return {
      ok: false,
      status: 502,
      message: 'Engine issue lookup invalid JSON',
    };
  }
}

function mapEngineIssueToInput(issue: Record<string, unknown>): Afu9IssueInput | null {
  const title = getStringField(issue, 'title') || getStringField(issue, 'summary');
  if (!title) return null;

  const statusValue = getStringField(issue, 'status');
  const priorityValue = getStringField(issue, 'priority');

  return {
    title,
    body: getStringField(issue, 'body') ?? null,
    labels: toStringArray(issue.labels),
    priority: priorityValue && isValidPriority(priorityValue) ? priorityValue : null,
    assignee: getStringField(issue, 'assignee') ?? null,
    status: statusValue && isValidStatus(statusValue) ? statusValue : Afu9IssueStatus.CREATED,
    canonical_id: getStringField(issue, 'canonicalId') || getStringField(issue, 'canonical_id') || null,
    github_issue_number:
      typeof issue.githubIssueNumber === 'number'
        ? issue.githubIssueNumber
        : typeof issue.github_issue_number === 'number'
          ? issue.github_issue_number
          : null,
    github_url: getStringField(issue, 'githubUrl') || getStringField(issue, 'github_url') || null,
    source: 'engine',
  };
}

function extractEngineIssueUuid(issue: Record<string, unknown>): string | null {
  const candidate =
    getStringField(issue, 'id') ||
    getStringField(issue, 'issue_id') ||
    getStringField(issue, 'issueId');

  if (!candidate) return null;
  const parsed = parseIssueId(candidate);
  if (!parsed.isValid || parsed.kind !== 'uuid') {
    return null;
  }
  return parsed.value;
}

export async function resolveIssueIdentifier(
  issueId: string,
  requestId: string
): Promise<ResolvedIssueIdentifier | ResolveIssueIdentifierError> {
  const rawValue = typeof issueId === 'string' ? issueId.trim() : '';
  const parsed = parseIssueId(rawValue);

  if (!parsed.isValid) {
    return buildIssueIdentifierError({
      status: 400,
      errorCode: 'invalid_issue_identifier',
      issueId: rawValue || issueId,
      requestId,
    });
  }

  const pool = getPool();
  const resolved = await fetchIssueRowByIdentifier(pool, rawValue);

  if (resolved.ok) {
    const shortId = parsed.kind === 'shortHex8' ? parsed.value : undefined;
    return {
      ok: true,
      type: parsed.kind === 'uuid' ? 'uuid' : 'shortid',
      uuid: (resolved.row as Record<string, unknown>).id as string,
      shortId,
      issue: resolved.row as Record<string, unknown>,
      source: 'control',
    };
  }

  if (resolved.status !== 404) {
    return buildIssueIdentifierError({
      status: resolved.status,
      errorCode: resolved.status === 400 ? 'invalid_issue_identifier' : 'issue_lookup_failed',
      issueId: rawValue,
      requestId,
      lookupStore: 'control',
    });
  }

  const missingEnvs: string[] = [];
  const engineBaseUrl = normalizeEngineBaseUrl(
    process.env.ENGINE_BASE_URL || process.env.ENGINE_URL
  );
  const engineToken = (process.env.AFU9_SERVICE_TOKEN || process.env.ENGINE_SERVICE_TOKEN || '').trim();

  if (!engineBaseUrl) {
    missingEnvs.push('ENGINE_BASE_URL', 'ENGINE_URL');
  }
  if (!engineToken) {
    missingEnvs.push('AFU9_SERVICE_TOKEN', 'ENGINE_SERVICE_TOKEN');
  }

  if (missingEnvs.length > 0) {
    return buildIssueIdentifierError({
      status: 500,
      errorCode: 'engine_misconfigured',
      issueId: rawValue,
      requestId,
      lookupStore: 'engine',
    });
  }

  const engineLookup = await fetchIssueFromEngine(rawValue, requestId);
  if (engineLookup.ok && engineLookup.issue) {
    const engineIssueId = extractEngineIssueUuid(engineLookup.issue);
    if (!engineIssueId) {
      return buildIssueIdentifierError({
        status: 502,
        errorCode: 'engine_lookup_failed',
        issueId: rawValue,
        requestId,
        lookupStore: 'engine',
      });
    }

    const mappedInput = mapEngineIssueToInput(engineLookup.issue);
    if (mappedInput) {
      const upsertResult = await upsertAfu9IssueFromEngine(pool, engineIssueId, mappedInput);
      if (upsertResult.success && upsertResult.data) {
        return {
          ok: true,
          type: parsed.kind === 'uuid' ? 'uuid' : 'shortid',
          uuid: engineIssueId,
          shortId: parsed.kind === 'shortHex8' ? parsed.value : undefined,
          issue: upsertResult.data as Record<string, unknown>,
          source: 'engine',
        };
      }
    }
  }

  if (!engineLookup.ok) {
    return buildIssueIdentifierError({
      status: engineLookup.status,
      errorCode: 'engine_lookup_failed',
      issueId: rawValue,
      requestId,
      lookupStore: 'engine',
    });
  }

  return buildIssueIdentifierError({
    status: 404,
    errorCode: 'issue_not_found',
    issueId: rawValue,
    requestId,
    lookupStore: 'control',
  });
}

export type EnsureIssueResult =
  | { ok: true; issue: Record<string, unknown>; source: 'control' | 'engine' }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function ensureIssueInControl(
  issueId: string,
  requestId: string
): Promise<EnsureIssueResult> {
  const resolution = await resolveIssueIdentifier(issueId, requestId);
  if (!resolution.ok) {
    return { ok: false, status: resolution.status, body: resolution.body };
  }

  if (resolution.issue) {
    return { ok: true, issue: resolution.issue, source: resolution.source };
  }

  return {
    ok: false,
    status: 404,
    body: {
      errorCode: 'issue_not_found',
      issueId,
      lookupStore: 'control',
      requestId,
    },
  };
}
