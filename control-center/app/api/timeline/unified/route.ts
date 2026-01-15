/**
 * API Route: /api/timeline/unified
 * 
 * Query API for retrieving unified timeline events.
 * Supports filtering by sessionId, canonicalId, ghIssueNumber, prNumber, etc.
 * 
 * E87.3: Unified Audit Trail Timeline
 * 
 * Features:
 * - Filterable by multiple subject identifiers
 * - Deterministic sorting (timestamp DESC)
 * - Pagination support
 * - Strict schema validation
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '../../../../src/lib/db';
import { 
  queryTimelineEvents,
  countTimelineEvents,
} from '../../../../src/lib/db/unifiedTimelineEvents';
import { 
  TimelineQueryFilterSchema,
  UNIFIED_EVENT_TYPES,
  SUBJECT_TYPES,
} from '../../../../src/lib/timeline/unifiedTimelineEvents';
import { withApi, apiError } from '../../../../src/lib/http/withApi';

/**
 * Query parameters schema
 */
const QueryParamsSchema = z.object({
  sessionId: z.string().optional(),
  canonicalId: z.string().optional(),
  ghIssueNumber: z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : undefined),
  prNumber: z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : undefined),
  eventType: z.enum(UNIFIED_EVENT_TYPES).optional(),
  actor: z.string().optional(),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 100),
  offset: z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 0),
});

/**
 * GET /api/timeline/unified
 * 
 * Query unified timeline events with optional filters.
 * 
 * Query Parameters:
 * - sessionId: Filter by AFU-9 session ID
 * - canonicalId: Filter by AFU-9 canonical ID
 * - ghIssueNumber: Filter by GitHub issue number
 * - prNumber: Filter by GitHub PR number
 * - eventType: Filter by event type
 * - actor: Filter by actor
 * - subjectType: Filter by subject type
 * - startTime: Filter by start time (ISO 8601)
 * - endTime: Filter by end time (ISO 8601)
 * - limit: Number of results to return (default: 100, max: 1000)
 * - offset: Number of results to skip (default: 0)
 * 
 * Returns:
 * - events: Array of timeline events (sorted by timestamp DESC)
 * - metadata: Query metadata (total count, pagination info)
 */
export const GET = withApi(async (request: NextRequest): Promise<NextResponse> => {
  const pool = getPool();
  
  // Parse and validate query parameters
  const searchParams = request.nextUrl.searchParams;
  const rawParams = {
    sessionId: searchParams.get('sessionId') || undefined,
    canonicalId: searchParams.get('canonicalId') || undefined,
    ghIssueNumber: searchParams.get('ghIssueNumber') || undefined,
    prNumber: searchParams.get('prNumber') || undefined,
    eventType: searchParams.get('eventType') || undefined,
    actor: searchParams.get('actor') || undefined,
    subjectType: searchParams.get('subjectType') || undefined,
    startTime: searchParams.get('startTime') || undefined,
    endTime: searchParams.get('endTime') || undefined,
    limit: searchParams.get('limit') || undefined,
    offset: searchParams.get('offset') || undefined,
  };
  
  // Validate query parameters
  const validation = QueryParamsSchema.safeParse(rawParams);
  if (!validation.success) {
    const errors = validation.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return apiError('Invalid query parameters', 400, errors);
  }
  
  const params = validation.data;
  
  // Build filter for DAO
  const filter = TimelineQueryFilterSchema.parse({
    session_id: params.sessionId,
    canonical_id: params.canonicalId,
    gh_issue_number: params.ghIssueNumber,
    pr_number: params.prNumber,
    event_type: params.eventType,
    actor: params.actor,
    subject_type: params.subjectType,
    start_time: params.startTime,
    end_time: params.endTime,
    limit: params.limit,
    offset: params.offset,
  });
  
  try {
    // Query events
    const events = await queryTimelineEvents(pool, filter);
    
    // Count total (for pagination metadata)
    const total = await countTimelineEvents(pool, {
      session_id: filter.session_id,
      canonical_id: filter.canonical_id,
      gh_issue_number: filter.gh_issue_number,
      pr_number: filter.pr_number,
      event_type: filter.event_type,
      actor: filter.actor,
      subject_type: filter.subject_type,
      start_time: filter.start_time,
      end_time: filter.end_time,
    });
    
    // Build response
    const response = {
      events,
      metadata: {
        total,
        limit: filter.limit || 100,
        offset: filter.offset || 0,
        returned: events.length,
        hasMore: (filter.offset || 0) + events.length < total,
        timestamp: new Date().toISOString(),
      },
    };
    
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[/api/timeline/unified] Error querying timeline:', error);
    return apiError(
      'Failed to query timeline events',
      500,
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
});
