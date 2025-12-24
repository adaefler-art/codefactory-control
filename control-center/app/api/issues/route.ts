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
import { normalizeIssueForApi } from './_shared';
import {
  Afu9IssueStatus,
  Afu9HandoffState,
  Afu9IssuePriority,
  validateAfu9IssueInput,
  isValidStatus,
  isValidHandoffState,
  isValidPriority,
} from '../../../src/lib/contracts/afu9Issue';

/**
 * GET /api/issues
 * List issues with optional filtering and sorting
 * 
 * Query parameters:
 * - status: Filter by status (CREATED, ACTIVE, BLOCKED, DONE)
 * - label: Filter by label (single label, exact match)
 * - q: Search query (searches in title and body)
 * - sort: Sort field (default: updatedAt)
 * - order: Sort order (asc, desc - default: desc)
 * - limit: Results per page (default: 100, max: 100)
 * - offset: Pagination offset (default: 0)
 */
export async function GET(request: NextRequest) {
  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate status filter
    const statusParam = searchParams.get('status');
    let status: Afu9IssueStatus | undefined;
    if (statusParam) {
      if (!isValidStatus(statusParam)) {
        return NextResponse.json(
          {
            error: 'Invalid status parameter',
            details: `Status must be one of: ${Object.values(Afu9IssueStatus).join(', ')}`,
          },
          { status: 400 }
        );
      }
      status = statusParam as Afu9IssueStatus;
    }

    // Parse handoff_state filter (optional)
    const handoffStateParam = searchParams.get('handoff_state');
    let handoff_state: Afu9HandoffState | undefined;
    if (handoffStateParam) {
      if (!isValidHandoffState(handoffStateParam)) {
        return NextResponse.json(
          {
            error: 'Invalid handoff_state parameter',
            details: `handoff_state must be one of: ${Object.values(Afu9HandoffState).join(', ')}`,
          },
          { status: 400 }
        );
      }
      handoff_state = handoffStateParam as Afu9HandoffState;
    }

    // Parse pagination
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Get issues from database
    const result = await listAfu9Issues(pool, {
      status,
      handoff_state,
      limit,
      offset,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to list issues', details: result.error },
        { status: 500 }
      );
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

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[API /api/issues] Error listing issues:', error);
    return NextResponse.json(
      {
        error: 'Failed to list issues',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
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
  try {
    const pool = getPool();
    const body = await request.json();

    // Validate input
    const validation = validateAfu9IssueInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: validation.errors,
        },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: result.error },
          { status: 409 } // Conflict
        );
      }

      return NextResponse.json(
        { error: 'Failed to create issue', details: result.error },
        { status: 500 }
      );
    }

    const responseBody: any = normalizeIssueForApi(result.data);
    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }
    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    console.error('[API /api/issues] Error creating issue:', error);
    return NextResponse.json(
      {
        error: 'Failed to create issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
