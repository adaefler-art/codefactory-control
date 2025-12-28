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
  softDeleteAfu9Issue,
} from '../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
  Afu9IssuePriority,
  Afu9HandoffState,
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
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;

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
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;

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

  // Get current issue state for invariant checking
  const currentIssue = resolved.row as any;

  // Invariant: SYNCED handoff_state cannot occur with CREATED status
  const finalStatus = updates.status ?? currentIssue.status;
  const finalHandoffState = updates.handoff_state ?? currentIssue.handoff_state;
  
  if (finalStatus === Afu9IssueStatus.CREATED && finalHandoffState === Afu9HandoffState.SYNCED) {
    return apiError(
      'Invalid state combination',
      400,
      'Issue with status CREATED cannot have handoff_state SYNCED. This violates lifecycle invariants.'
    );
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

/**
 * DELETE /api/issues/[id]
 * Soft delete an issue (only allowed for status=CREATED and handoff_state=NOT_SENT)
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Guardrails:
 * - Only issues with status=CREATED and handoff_state=NOT_SENT can be deleted
 * - Performs soft delete (sets deleted_at timestamp)
 */
export const DELETE = withApi(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const pool = getPool();
  const { id } = await params;

  const resolved = await fetchIssueRowByIdentifier(pool, id);
  if (!resolved.ok) {
    return NextResponse.json(resolved.body, { status: resolved.status });
  }

  const internalId = (resolved.row as any).id as string;

  // Perform soft delete
  const result = await softDeleteAfu9Issue(pool, internalId);

  if (!result.success) {
    // Check if it's a guardrail violation
    if (result.error && result.error.includes('deletion only allowed')) {
      return NextResponse.json(
        { error: result.error },
        { status: 403 } // Forbidden
      );
    }

    if (result.error && result.error.includes('not found')) {
      return NextResponse.json(
        { error: 'Issue not found', id },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete issue', details: result.error },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, id: internalId }, { status: 200 });
});
