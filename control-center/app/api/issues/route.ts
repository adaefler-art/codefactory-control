/**
 * API Route: /api/issues
 * 
 * Manages AFU9 issues - list and create operations
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../src/lib/db';
import { listAfu9Issues, createAfu9Issue } from '../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import {
  normalizeIssueForApi,
  extractServiceTokenFromHeaders,
  normalizeServiceToken,
  tokensEqual,
  getServiceTokenDebugInfo,
} from './_shared';
import {
  Afu9IssueStatus,
  Afu9HandoffState,
  Afu9IssuePriority,
  validateAfu9IssueInput,
  isValidStatus,
  isValidHandoffState,
  isValidPriority,
} from '../../../src/lib/contracts/afu9Issue';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads of sync metadata in production/CDN layers.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/issues
 * List issues with optional filtering and sorting
 * 
 * I201.1: This endpoint now delegates to the canonical /api/afu9/issues API
 * to ensure a single source of truth for issue listing.
 * 
 * Query parameters:
 * - canonicalId (or canonical_id): Filter by canonical ID (exact match)
 * - publicId (or public_id): Filter by 8-hex publicId
 * - status: Filter by status (CREATED, ACTIVE, BLOCKED, DONE)
 * - label: Filter by label (single label, exact match) - post-query filter
 * - q: Search query (searches in title and body) - post-query filter
 * - sort: Sort field (default: updatedAt)
 * - order: Sort order (asc, desc - default: desc)
 * - limit: Results per page (default: 100, max: 100)
 * - offset: Pagination offset (default: 0)
 * 
 * Note: canonicalId and publicId filters are applied at database level.
 * Label and search (q) filters are applied post-query for backward compatibility.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const verifiedUserSub = request.headers.get('x-afu9-sub')?.trim();
  const providedServiceToken = request.headers.get('x-afu9-service-token')?.trim();
  const expectedServiceToken = process.env.SERVICE_READ_TOKEN || '';
  const { token: providedServiceToken, reason: tokenReason } = extractServiceTokenFromHeaders(request.headers);
  const expectedServiceToken = normalizeServiceToken(process.env.SERVICE_READ_TOKEN || '');
  const isTestEnv = process.env.NODE_ENV === 'test';
  const shouldEnforceServiceToken = !isTestEnv || Boolean(expectedServiceToken);

  // Auth model: JWT (middleware sets x-afu9-sub) is primary, service token is fallback.
  if (!verifiedUserSub && shouldEnforceServiceToken) {
    if (!providedServiceToken) {
      if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
        console.warn('[Issues API] service token missing', {
          requestId,
          reason: tokenReason,
        });
      }
      return errorResponse('Authentication required', {
        status: 401,
        requestId,
        details: tokenReason === 'malformed' ? 'Malformed Authorization header' : 'Missing service token',
      });
    }
    if (!expectedServiceToken || !tokensEqual(providedServiceToken, expectedServiceToken)) {
      if (process.env.DEBUG_SERVICE_AUTH === 'true' && expectedServiceToken) {
        console.warn('[Issues API] service token rejected', {
          requestId,
          ...getServiceTokenDebugInfo(providedServiceToken, expectedServiceToken),
        });
      }
      return errorResponse('service token rejected', {
        status: 403,
        requestId,
        details: expectedServiceToken ? 'Service token mismatch' : 'Service token not configured',
      });
    }
  }
  
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

    // Get issues from database with deterministic filters
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

    let issues = result.data || [];
    const totalBeforeFilter = issues.length;

    // Apply label filter if provided (post-query filtering)
    const labelParam = searchParams.get('label');
    if (labelParam && issues.length > 0) {
      issues = issues.filter((issue) => issue.labels.includes(labelParam));
    }

    // Apply search query filter if provided (post-query filtering)
    const searchQuery = searchParams.get('q');
    if (searchQuery && issues.length > 0) {
      const query = searchQuery.toLowerCase();
      issues = issues.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          (issue.body && issue.body.toLowerCase().includes(query))
      );
    }

    // Apply sorting (default: updatedAt desc)
    const sortField = searchParams.get('sort') || 'updatedAt';
    const sortOrder = searchParams.get('order') || 'desc';

    if (sortField === 'updatedAt' || sortField === 'createdAt') {
      issues.sort((a, b) => {
        const aTime = new Date(
          sortField === 'updatedAt' ? a.updated_at : a.created_at
        ).getTime();
        const bTime = new Date(
          sortField === 'updatedAt' ? b.updated_at : b.created_at
        ).getTime();
        return sortOrder === 'asc' ? aTime - bTime : bTime - aTime;
      });
    }

    const responseBody: any = {
      issues: issues.map((issue) => normalizeIssueForApi(issue)),
      total: totalBeforeFilter, // Total from DB before client-side filtering
      filtered: issues.length, // Count after filtering
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
    console.error('[API /api/issues] Error listing issues:', error);
    return errorResponse('Failed to list issues', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * POST /api/issues
 * Create a new AFU9 issue
 * 
 * Body:
 * - title: string (required)
 * - body: string (optional)
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

    // Validate input
    const validation = validateAfu9IssueInput(body);
    if (!validation.valid) {
      // Format errors as user-friendly list
      const errorMessages = Array.isArray(validation.errors)
        ? validation.errors.join('; ')
        : typeof validation.errors === 'string'
        ? validation.errors
        : 'Validation failed';
        
      return errorResponse('Invalid input', {
        status: 400,
        requestId,
        details: errorMessages,
      });
    }

    // Create issue
    const result = await createAfu9Issue(pool, {
      title: body.title,
      body: body.body || null,
      labels: body.labels || [],
      priority: body.priority || null,
      assignee: body.assignee || null,
      status: body.status || Afu9IssueStatus.CREATED,
    });

    if (!result.success) {
      // Check for Single-Active constraint violation
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

    const responseBody: any = normalizeIssueForApi(result.data);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }
    return jsonResponse(responseBody, { status: 201, requestId });
  } catch (error) {
    console.error('[API /api/issues] Error creating issue:', error);
    return errorResponse('Failed to create issue', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
