/**
 * API Route: /api/issues/[id]
 * 
 * Manages individual AFU9 issue - get and update operations
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  updateAfu9Issue,
} from '../../../../src/lib/db/afu9Issues';
import {
  Afu9IssueStatus,
  Afu9HandoffState,
  Afu9IssuePriority,
  isValidStatus,
  isValidHandoffState,
  isValidPriority,
} from '../../../../src/lib/contracts/afu9Issue';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { fetchIssueRowByIdentifier, normalizeIssueForApi } from '../_shared';

/**
 * GET /api/issues/[id]
 * Get a specific issue by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
  } catch (error) {
    console.error('[API /api/issues/[id]] Error getting issue:', error);
    return NextResponse.json(
      {
        error: 'Failed to get issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/issues/[id]
 * Update an existing issue
 * 
 * Body (all fields optional):
 * - title: string
 * - body: string
 * - labels: string[]
 * - status: Afu9IssueStatus
 * - priority: Afu9IssuePriority | null
 * - assignee: string | null
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
        return NextResponse.json(
          { error: 'title must be a non-empty string' },
          { status: 400 }
        );
      }
      updates.title = body.title;
    }

    if (body.body !== undefined) {
      if (body.body !== null && typeof body.body !== 'string') {
        return NextResponse.json(
          { error: 'body must be a string or null' },
          { status: 400 }
        );
      }
      updates.body = body.body;
    }

    if (body.labels !== undefined) {
      if (!Array.isArray(body.labels)) {
        return NextResponse.json(
          { error: 'labels must be an array' },
          { status: 400 }
        );
      }
      if (!body.labels.every((label: any) => typeof label === 'string')) {
        return NextResponse.json(
          { error: 'all labels must be strings' },
          { status: 400 }
        );
      }
      updates.labels = body.labels;
    }

    if (body.status !== undefined) {
      if (!isValidStatus(body.status)) {
        return NextResponse.json(
          {
            error: 'Invalid status',
            details: `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`,
          },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }

    if (body.priority !== undefined) {
      if (body.priority !== null && !isValidPriority(body.priority)) {
        return NextResponse.json(
          {
            error: 'Invalid priority',
            details: `Priority must be one of: ${Object.values(Afu9IssuePriority).join(', ')} or null`,
          },
          { status: 400 }
        );
      }
      updates.priority = body.priority;
    }

    if (body.assignee !== undefined) {
      if (body.assignee !== null && typeof body.assignee !== 'string') {
        return NextResponse.json(
          { error: 'assignee must be a string or null' },
          { status: 400 }
        );
      }
      updates.assignee = body.assignee;
    }

    // Check if there are any updates
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
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
  } catch (error) {
    console.error('[API /api/issues/[id]] Error updating issue:', error);
    return NextResponse.json(
      {
        error: 'Failed to update issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
