/**
 * API Route: /api/afu9/timeline
 * 
 * I201.3: Timeline API + Minimal Event Contract (append-only)
 * 
 * This endpoint provides read access to the issue timeline events.
 * Events are returned in stable, deterministic order (created_at ASC).
 * 
 * Query parameters:
 * - issueId (required): Filter by issue ID (UUID or 8-hex publicId)
 * - eventType: Filter by specific event type (optional)
 * - limit: Results per page (default: 100, max: 500)
 * - offset: Pagination offset (default: 0)
 * 
 * Response format:
 * {
 *   events: [...],
 *   total: number,
 *   limit: number,
 *   offset: number,
 *   issueId: string
 * }
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getAfu9IssueById, getAfu9IssueByPublicId } from '../../../../src/lib/db/afu9Issues';
import { IssueTimelineEventType, isValidTimelineEventType } from '../../../../src/lib/contracts/issueTimeline';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Avoid stale reads in production/CDN layers
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/afu9/timeline
 * Read timeline events for an issue with stable sorting
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const searchParams = request.nextUrl.searchParams;

    // Parse issueId (required)
    const issueIdParam = searchParams.get('issueId');
    if (!issueIdParam) {
      return errorResponse('Missing required parameter: issueId', {
        status: 400,
        requestId,
        details: 'issueId query parameter is required (UUID or 8-hex publicId)',
      });
    }

    // Resolve issueId (support both UUID and 8-hex publicId)
    let issueId: string;
    if (issueIdParam.length === 8 && /^[0-9a-f]{8}$/i.test(issueIdParam)) {
      // 8-hex publicId format
      const issueResult = await getAfu9IssueByPublicId(pool, issueIdParam);
      if (!issueResult.success || !issueResult.data) {
        return errorResponse('Issue not found', {
          status: 404,
          requestId,
          details: `No issue found with publicId: ${issueIdParam}`,
        });
      }
      issueId = issueResult.data.id;
    } else {
      // UUID format
      const issueResult = await getAfu9IssueById(pool, issueIdParam);
      if (!issueResult.success || !issueResult.data) {
        return errorResponse('Issue not found', {
          status: 404,
          requestId,
          details: `No issue found with id: ${issueIdParam}`,
        });
      }
      issueId = issueResult.data.id;
    }

    // Parse eventType filter (optional)
    const eventTypeParam = searchParams.get('eventType');
    let eventType: IssueTimelineEventType | undefined;
    if (eventTypeParam) {
      if (!isValidTimelineEventType(eventTypeParam)) {
        return errorResponse('Invalid eventType parameter', {
          status: 400,
          requestId,
          details: `eventType must be one of: ${Object.values(IssueTimelineEventType).join(', ')}`,
        });
      }
      eventType = eventTypeParam as IssueTimelineEventType;
    }

    // Parse pagination
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      500 // Max limit to prevent abuse
    );
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

    // Build query
    let query = `
      SELECT
        id,
        issue_id,
        event_type,
        event_data,
        actor,
        actor_type,
        created_at
      FROM issue_timeline
      WHERE issue_id = $1
    `;
    const params: (string | number)[] = [issueId];
    let paramIndex = 2;

    // Add eventType filter if specified
    if (eventType) {
      query += ` AND event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }

    // Stable sort: created_at ASC (deterministic order)
    query += ' ORDER BY created_at ASC, id ASC';

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    // Execute query
    const result = await pool.query(query, params);

    // Get total count for this issue (with eventType filter if specified)
    let countQuery = 'SELECT COUNT(*) as total FROM issue_timeline WHERE issue_id = $1';
    const countParams: (string | IssueTimelineEventType)[] = [issueId];
    if (eventType) {
      countQuery += ' AND event_type = $2';
      countParams.push(eventType);
    }
    const countResult = await pool.query<{ total: string }>(countQuery, countParams);
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Build response
    interface ResponseBody {
      events: unknown[];
      total: number;
      limit: number;
      offset: number;
      issueId: string;
    }

    const responseBody: ResponseBody = {
      events: result.rows.map(row => ({
        id: row.id,
        issueId: row.issue_id,
        eventType: row.event_type,
        eventData: row.event_data,
        actor: row.actor,
        actorType: row.actor_type,
        createdAt: row.created_at,
      })),
      total,
      limit,
      offset,
      issueId,
    };

    return jsonResponse(responseBody, {
      requestId,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    console.error('[API /api/afu9/timeline] Error fetching timeline:', error);
    return errorResponse('Failed to fetch timeline events', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
