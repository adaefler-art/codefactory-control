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
  validateAfu9IssueInput,
  isValidStatus,
  isValidHandoffState,
} from '../../../../src/lib/contracts/afu9Issue';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads of sync metadata in production/CDN layers.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildIssueBody(input: Record<string, unknown>): string | null {
  const directBody = typeof input.body === 'string' ? input.body.trim() : '';
  if (directBody) {
    return directBody;
  }

  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description) {
    return description;
  }

  const sections: string[] = [];
  const problem = typeof input.problem === 'string' ? input.problem.trim() : '';
  const scope = typeof input.scope === 'string' ? input.scope.trim() : '';
  const notes = typeof input.notes === 'string' ? input.notes.trim() : '';

  if (problem) {
    sections.push(`## Problem\n${problem}`);
  }
  if (scope) {
    sections.push(`## Scope\n${scope}`);
  }
  if (notes) {
    sections.push(`## Notes\n${notes}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : null;
}

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
 * Create a new AFU9 issue
 *
 * Body:
 * - title: string (required)
 * - problem: string (optional)
 * - scope: string (optional)
 * - notes: string (optional)
 * - labels: string[] (optional, default: [])
 * - priority: 'P0' | 'P1' | 'P2' (optional)
 * - assignee: string (optional)
 * - status: Afu9IssueStatus (optional, default: CREATED)
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();
    const body = await request.json();
    const issueBody = buildIssueBody(body as Record<string, unknown>);

    const issueInput = {
      title: (body as any)?.title,
      body: issueBody,
      labels: (body as any)?.labels,
      priority: (body as any)?.priority,
      assignee: (body as any)?.assignee,
      status: (body as any)?.status === undefined ? Afu9IssueStatus.CREATED : (body as any)?.status,
    };

    const validation = validateAfu9IssueInput(issueInput);
    if (!validation.valid) {
      const errorMessages = Array.isArray(validation.errors)
        ? validation.errors.map((error) => `${error.field}: ${error.message}`).join('; ')
        : 'Validation failed';

      return errorResponse('Invalid input', {
        status: 400,
        requestId,
        details: errorMessages,
      });
    }

    const result = await createAfu9Issue(pool, issueInput);

    if (!result.success) {
      if (result.error && result.error.includes('Single-Active')) {
        return errorResponse(result.error, {
          status: 409,
          requestId,
        });
      }

      return errorResponse('Failed to create issue', {
        status: 500,
        requestId,
        details: result.error,
      });
    }

    const normalized = normalizeIssueForApi(result.data);
    const canonicalIdValue =
      typeof (result.data as any)?.canonical_id === 'string' && (result.data as any)?.canonical_id.trim()
        ? (result.data as any)?.canonical_id.trim()
        : (normalized?.publicId ?? normalized?.id ?? '');
    const responseBody: Record<string, unknown> = {
      issueId: normalized?.id ?? (result.data as any)?.id,
      canonicalId: canonicalIdValue,
      createdAt: normalized?.createdAt ?? (result.data as any)?.created_at ?? new Date().toISOString(),
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return jsonResponse(responseBody, { status: 201, requestId });
  } catch (error) {
    console.error('[API /api/afu9/issues] Error creating issue:', error);
    return errorResponse('Failed to create issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
