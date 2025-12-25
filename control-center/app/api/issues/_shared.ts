/**
 * Shared helpers for Issues API routes.
 *
 * Implements:
 * - Identifier parsing (UUID v4 OR 8-hex publicId)
 * - DB lookup by internal UUID or publicId
 * - Consistent API response shape w/ ISO timestamps
 */

import { normalizeOutput } from '@/lib/api/normalize-output';
import type { Pool } from 'pg';
import { isValidUUID } from '../../../src/lib/utils/uuid-validator';
import {
  getAfu9IssueById,
  getAfu9IssueByPublicId,
} from '../../../src/lib/db/afu9Issues';

export type IssueIdentifierKind = 'uuid' | 'publicId' | 'invalid';

const PUBLIC_ID_REGEX = /^[0-9a-f]{8}$/i;

export function classifyIssueIdentifier(value: string): IssueIdentifierKind {
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'invalid';
  if (isValidUUID(trimmed)) return 'uuid';
  if (PUBLIC_ID_REGEX.test(trimmed)) return 'publicId';
  return 'invalid';
}

export function toPublicIdFromUuid(uuid: string): string | null {
  if (typeof uuid !== 'string') return null;
  const match = uuid.match(/^([0-9a-f]{8})-/i);
  if (match) return match[1].toLowerCase();
  const fallback = uuid.match(/^([0-9a-f]{8})/i);
  return fallback ? fallback[1].toLowerCase() : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  if (typeof value === 'object') {
    const asAny = value as any;
    if (typeof asAny.toISOString === 'function') {
      try {
        const s = asAny.toISOString();
        return typeof s === 'string' ? s : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function fetchIssueRowByIdentifier(pool: Pool, idOrPublicId: string) {
  const normalized = typeof idOrPublicId === 'string' ? idOrPublicId.trim() : '';
  const kind = classifyIssueIdentifier(normalized);
  if (kind === 'invalid') {
    return {
      ok: false as const,
      status: 400 as const,
      body: { error: 'Invalid issue ID format' },
    };
  }

  const result =
    kind === 'uuid'
      ? await getAfu9IssueById(pool, normalized)
      : await getAfu9IssueByPublicId(pool, normalized);

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

  if (!result.data) {
    return {
      ok: false as const,
      status: 404 as const,
      body: { error: 'Issue not found', id: normalized },
    };
  }

  return {
    ok: true as const,
    status: 200 as const,
    row: result.data,
  };
}

export function normalizeIssueForApi(input: unknown): any {
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

  const api: any = {
    // Required/primary fields
    id: internalId,
    publicId: publicId ?? null,
    title: typeof normalized?.title === 'string' ? normalized.title : '',
    status: normalized?.status ?? null,
    labels: Array.isArray(normalized?.labels) ? normalized.labels : [],
    createdAt,
    updatedAt,

    // Common optional fields (camelCase)
    body: normalized?.body ?? null,
    description: normalized?.description ?? normalized?.body ?? null,
    priority: normalized?.priority ?? null,
    assignee: normalized?.assignee ?? null,
    source: normalized?.source ?? null,
    handoffState: normalized?.handoffState ?? normalized?.handoff_state ?? null,
    githubIssueNumber: normalized?.githubIssueNumber ?? normalized?.github_issue_number ?? null,
    githubUrl: normalized?.githubUrl ?? normalized?.github_url ?? null,
    lastError: normalized?.lastError ?? normalized?.last_error ?? null,
  };

  // Backwards-compatible snake_case aliases used by existing UI/components.
  api.handoff_state = api.handoffState;
  api.github_issue_number = api.githubIssueNumber;
  api.github_url = api.githubUrl;
  api.last_error = api.lastError;
  api.created_at = createdAt;
  api.updated_at = updatedAt;

  return api;
}
