/**
 * API Route: /api/afu9/issues
 * 
 * I201.1: Canonical Issues API as Single Source of Truth
 * 
 * This is the canonical API for listing AFU9 issues.
 * All other issue listing endpoints should delegate to this.
 * 
 * Query parameters:
 * - canonicalId (or canonical_id): Filter by canonical ID (e.g., I867, E81.1)
 * - publicId (or public_id): Filter by 8-hex publicId
 * - status: Filter by status (CREATED, SPEC_READY, etc.)
 * - handoff_state: Filter by handoff state (NOT_SENT, SENT, etc.)
 * - limit: Results per page (default: 100, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Response format:
 * {
 *   issues: [...],
 *   total: number,      // Total count from DB query
 *   filtered: number,   // Count after filtering
 *   limit: number,
 *   offset: number
 * }
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { createAfu9Issue, listAfu9Issues } from '../../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { normalizeIssueForApi } from '../../issues/_shared';
import {
  Afu9IssueStatus,
  Afu9HandoffState,
  isValidStatus,
  isValidHandoffState,
  validateAfu9IssueInput,
  type Afu9IssueInput,
} from '../../../../src/lib/contracts/afu9Issue';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads of sync metadata in production/CDN layers.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/afu9/issues
 * Canonical issue listing API with deterministic filtering
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse canonicalId filter (support both canonicalId and canonical_id)
    const canonicalId = searchParams.get('canonicalId') || searchParams.get('canonical_id') || undefined;

    // Parse publicId filter (support both publicId and public_id)
    const publicId = searchParams.get('publicId') || searchParams.get('public_id') || undefined;

    // Parse and validate status filter
    const statusParam = searchParams.get('status');
    let status: Afu9IssueStatus | undefined;
    if (statusParam) {
      if (!isValidStatus(statusParam)) {
        return errorResponse('Invalid status parameter', {
          status: 400,
          requestId,
          details: `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`,
        });
      }
      status = statusParam as Afu9IssueStatus;
    }

    // Parse handoff_state filter (optional)
    const handoffStateParam = searchParams.get('handoff_state');
    let handoff_state: Afu9HandoffState | undefined;
    if (handoffStateParam) {
      if (!isValidHandoffState(handoffStateParam)) {
        return errorResponse('Invalid handoff_state parameter', {
          status: 400,
          requestId,
          details: `handoff_state must be one of: ${Object.values(Afu9HandoffState).join(', ')}`,
        });
      }
      handoff_state = handoffStateParam as Afu9HandoffState;
    }

    // Parse pagination
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get issues from database with filters applied at DB level
    const result = await listAfu9Issues(pool, {
      canonicalId,
      publicId,
      status,
      handoff_state,
      limit,
      offset,
    });

    if (!result.success) {
      return errorResponse('Failed to list issues', {
        status: 500,
        requestId,
        details: result.error,
      });
    }

    const issues = result.data || [];

    // Build response with deterministic counts
    interface ResponseBody {
      issues: unknown[];
      total: number;
      filtered: number;
      limit: number;
      offset: number;
      contextTrace?: unknown;
    }

    const responseBody: ResponseBody = {
      issues: issues.map((issue) => normalizeIssueForApi(issue)),
      total: issues.length,     // Total from DB (already filtered)
      filtered: issues.length,  // Same as total (no post-query filtering)
      limit,
      offset,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return jsonResponse(responseBody, {
      requestId,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    console.error('[API /api/afu9/issues] Error listing issues:', error);
    return errorResponse('Failed to list issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /api/afu9/issues
 * Create AFU9 issue (AFU9-only, no GitHub side effects)
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return errorResponse('Invalid JSON body', {
      status: 400,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  if (!payload || typeof payload !== 'object') {
    return errorResponse('Invalid request payload', {
      status: 400,
      requestId,
      details: 'Expected JSON object body',
    });
  }

  const data = payload as Record<string, unknown>;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const problem = typeof data.problem === 'string' ? data.problem.trim() : '';
  const scope = typeof data.scope === 'string' ? data.scope.trim() : '';
  const notes = typeof data.notes === 'string' ? data.notes.trim() : '';
  const bodyFromRequest = typeof data.body === 'string' ? data.body.trim() : '';
  const labelsInput = data.labels;

  const labels = Array.isArray(labelsInput)
    ? labelsInput.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
    : typeof labelsInput === 'string'
      ? labelsInput.split(',').map((label) => label.trim()).filter(Boolean)
      : undefined;

  const bodySections: string[] = [];
  if (problem) bodySections.push(`## Problem\n${problem}`);
  if (scope) bodySections.push(`## Scope\n${scope}`);
  if (notes) bodySections.push(`## Notes\n${notes}`);

  const body = bodyFromRequest || (bodySections.length ? bodySections.join('\n\n') : '');

  const issueInput: Afu9IssueInput = {
    title,
    body: body || null,
    labels,
  };

  const validation = validateAfu9IssueInput(issueInput);
  if (!validation.valid) {
    const errors = validation.errors.reduce<Record<string, string[]>>((acc, error) => {
      if (!acc[error.field]) {
        acc[error.field] = [];
      }
      acc[error.field].push(error.message);
      return acc;
    }, {});

    return jsonResponse(
      {
        message: 'Validation failed',
        errors,
        requestId,
      },
      {
        status: 400,
        requestId,
      }
    );
  }

  try {
    const pool = getPool();
    const created = await createAfu9Issue(pool, issueInput);

    if (!created.success || !created.data) {
      return errorResponse('Failed to create issue', {
        status: 500,
        requestId,
        details: created.error || 'Unknown database error',
      });
    }

    const normalized = normalizeIssueForApi(created.data);
    const canonicalId = typeof normalized?.canonicalId === 'string'
      ? normalized.canonicalId
      : typeof normalized?.publicId === 'string'
        ? normalized.publicId
        : null;

    return jsonResponse(
      {
        issueId: normalized.id,
        canonicalId,
        createdAt: normalized.createdAt,
      },
      {
        status: 201,
        requestId,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          Pragma: 'no-cache',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/issues] Error creating issue:', error);
    return errorResponse('Failed to create issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
