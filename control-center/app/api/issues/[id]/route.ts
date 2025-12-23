/**
 * API Route: /api/issues/[id]
 * 
 * Manages individual AFU9 issue - get and update operations
 * Issue #297: AFU9 Issues API (List/Detail/Edit/Activate/Handoff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  getAfu9IssueById,
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
import { isValidUUID } from '../../../../src/lib/utils/uuid-validator';

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

    // Validate UUID format (basic check)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid issue ID format' },
        { status: 400 }
      );
    }

    const result = await getAfu9IssueById(pool, id);

    if (!result.success) {
      if (result.error && result.error.includes('not found')) {
        return NextResponse.json(
          { error: 'Issue not found', id },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to get issue', details: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result.data);
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

    // Validate UUID format
    if (!isValidUUID(id)) {
      return NextResponse.json(
        { error: 'Invalid issue ID format' },
        { status: 400 }
      );
    }

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
    const result = await updateAfu9Issue(pool, id, updates);

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

    return NextResponse.json(result.data);
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
