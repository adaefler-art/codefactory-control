/**
 * API Route: /api/issues/[id]
 * 
 * Manages individual AFU9 issue - get and update operations
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 * Issue #3: Identifier Consistency (UUID + publicId)
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 * - Returns 200 (found), 404 (not found), or 400 (invalid format)
 * - Uses fetchIssueRowByIdentifier for consistent validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  updateAfu9Issue,
} from '../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
  Afu9IssuePriority,
  isValidStatus,
  isValidPriority,
} from '../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { fetchIssueRowByIdentifier, normalizeIssueForApi } from '../_shared';
import { withApi, apiError } from '../../../../src/lib/http/withApi';

/**
 * GET /api/issues/[id]
 * Get a specific issue by ID
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Both formats are accepted and return the same issue data.
 */
export const GET = withApi(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const pool = getPool();
  const { id } = params;

  // Temporary diagnostics for the "Failed to fetch issue" bug.
  // Only logs in DEV to avoid noisy production logs.
  if (process.env.NODE_ENV === 'development') {
    console.log('[API /api/issues/[id]] GET', {
      id,
      url: request.nextUrl.toString(),
    });
  }

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const responseBody: any = normalizeIssueForApi(resolved.row);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return NextResponse.json(responseBody);
});

/**
 * PATCH /api/issues/[id]
 * Update an existing issue
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Body (all fields optional):
 * - title: string
 * - body: string
 * - labels: string[]
 * - status: Afu9IssueStatus
 * - priority: Afu9IssuePriority | null
 * - assignee: string | null
 */
export const PATCH = withApi(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const pool = getPool();
  const { id } = params;

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const internalId = (resolved.row as any).id as string;

  const body = await request.json();

  // Validate provided fields
  const updates: any = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      return apiError('title must be a non-empty string', 400);
    }
    updates.title = body.title;
  }

  if (body.body !== undefined) {
    if (body.body !== null && typeof body.body !== 'string') {
      return apiError('body must be a string or null', 400);
    }
    updates.body = body.body;
  }

  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels)) {
      return apiError('labels must be an array', 400);
    }
    if (!body.labels.every((label: any) => typeof label === 'string')) {
      return apiError('all labels must be strings', 400);
    }
    updates.labels = body.labels;
  }

  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) {
      return apiError(
        'Invalid status',
        400,
        `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`
      );
    }
    updates.status = body.status;
  }

  if (body.priority !== undefined) {
    if (body.priority !== null && !isValidPriority(body.priority)) {
      return apiError(
        'Invalid priority',
        400,
        `Priority must be one of: ${Object.values(Afu9IssuePriority).join(', ')} or null`
      );
    }
    updates.priority = body.priority;
  }

  if (body.assignee !== undefined) {
    if (body.assignee !== null && typeof body.assignee !== 'string') {
      return apiError('assignee must be a string or null', 400);
    }
    updates.assignee = body.assignee;
  }

  // Check if there are any updates
  if (Object.keys(updates).length === 0) {
    return apiError('No fields to update', 400);
  }

  // Update issue
  const result = await updateAfu9Issue(pool, internalId, updates);

  if (!result.success) {
    if (result.error && result.error.includes('not found')) {
      return NextResponse.json(
        { error: 'Issue not found', id },
        { status: 404 }
      );
    }

    // Check for Single-Active constraint violation
    if (result.error && result.error.includes('Single-Active')) {
      return NextResponse.json(
        { error: result.error },
        { status: 409 } // Conflict
      );
    }

    return NextResponse.json(
      { error: 'Failed to update issue', details: result.error },
      { status: 500 }
    );
  }

  const responseBody: any = normalizeIssueForApi(result.data);
  if (isDebugApiEnabled()) {
    responseBody.contextTrace = await buildContextTrace(request);
  }
  return NextResponse.json(responseBody);
});
