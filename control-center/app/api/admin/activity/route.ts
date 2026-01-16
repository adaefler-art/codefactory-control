/**
 * API Route: Admin Activity Log
 * 
 * GET /api/admin/activity?cursor=&types=&sessionId=&issueId=&limit=
 * 
 * Provides a centralized activity log for all Steering/Automation actions.
 * Uses the unified_timeline_events table for event storage and querying.
 * 
 * Features:
 * - Cursor-based pagination for efficient loading
 * - Filter by sessionId, githubIssueNumber, event type, date range
 * - PII/secrets redaction (handled by DB layer)
 * - Performance target: < 2s for 200 events
 * 
 * Issue: I904 - Activity Log (UI + API)
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { queryTimelineEvents, countTimelineEvents } from '@/lib/db/unifiedTimelineEvents';
import { TimelineQueryFilter, UNIFIED_EVENT_TYPES } from '@/lib/timeline/unifiedTimelineEvents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Check if user is admin (based on AFU9_ADMIN_SUBS env var)
 */
function isAdminUser(userId: string | null): boolean {
  if (!userId) return false;
  const adminSubs = process.env.AFU9_ADMIN_SUBS || '';
  if (!adminSubs.trim()) return false;
  const allowed = adminSubs.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(userId);
}

/**
 * Validate smoke key for unauthenticated access (staging smoke tests)
 */
function isValidSmokeKey(key: string | null): boolean {
  const validKey = process.env.AFU9_SMOKE_KEY;
  return !!(validKey && validKey.trim() && key === validKey);
}

/**
 * Parse comma-separated event types from query param
 */
function parseEventTypes(typesParam: string | null): string[] | undefined {
  if (!typesParam) return undefined;
  
  const types = typesParam.split(',').map(t => t.trim()).filter(Boolean);
  const validTypes = types.filter(t => UNIFIED_EVENT_TYPES.includes(t as any));
  
  return validTypes.length > 0 ? validTypes : undefined;
}

/**
 * Parse integer from query param
 */
function parseInteger(value: string | null, defaultValue: number, min: number, max: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr: string | null): string | undefined {
  if (!dateStr) return undefined;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * GET /api/admin/activity
 * 
 * Query params:
 * - cursor: offset for pagination (default: 0)
 * - types: comma-separated event types to filter (NOTE: only first type is used currently)
 * - sessionId: filter by AFU-9 session ID (optional)
 * - issueId: filter by GitHub issue number (optional)
 * - limit: max events to return (default: 50, max: 200)
 * - startDate: filter events after this date (optional, ISO format)
 * - endDate: filter events before this date (optional, ISO format)
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  // Authentication check (admin or smoke key)
  const userId = request.headers.get('x-afu9-sub');
  const smokeKey = request.headers.get('x-afu9-smoke-key');
  
  const isAdmin = isAdminUser(userId);
  const hasValidSmokeKey = isValidSmokeKey(smokeKey);
  
  if (!isAdmin && !hasValidSmokeKey) {
    return errorResponse('Unauthorized', {
      status: 401,
      requestId,
      code: 'UNAUTHORIZED',
      details: 'Admin privileges or valid smoke key required',
    });
  }
  
  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const cursor = parseInteger(searchParams.get('cursor'), 0, 0, 999999);
  const limit = parseInteger(searchParams.get('limit'), 50, 1, 200);
  const sessionId = searchParams.get('sessionId') || undefined;
  const issueIdParam = searchParams.get('issueId');
  const issueId = issueIdParam ? parseInteger(issueIdParam, 0, 1, 999999999) : undefined;
  const typesParam = searchParams.get('types');
  const eventTypes = parseEventTypes(typesParam);
  const startDate = parseDate(searchParams.get('startDate'));
  const endDate = parseDate(searchParams.get('endDate'));
  
  // Build filter
  const filter: TimelineQueryFilter = {
    limit,
    offset: cursor,
  };
  
  if (sessionId) filter.session_id = sessionId;
  if (issueId) filter.gh_issue_number = issueId;
  if (startDate) filter.start_time = startDate;
  if (endDate) filter.end_time = endDate;
  
  const pool = getPool();
  
  try {
    // NOTE: Current implementation supports single event type filtering.
    // Multi-type filtering would require OR query support in the DB layer.
    // For now, we use the first type if multiple are specified.
    if (eventTypes && eventTypes.length > 0) {
      filter.event_type = eventTypes[0] as any;
    }
    
    // Query events
    const events = await queryTimelineEvents(pool, filter);
    
    // Get total count for pagination metadata
    const totalCount = await countTimelineEvents(pool, {
      session_id: filter.session_id,
      gh_issue_number: filter.gh_issue_number,
      event_type: filter.event_type,
      start_time: filter.start_time,
      end_time: filter.end_time,
    });
    
    // Calculate pagination metadata
    const hasMore = (cursor + events.length) < totalCount;
    const nextCursor = hasMore ? cursor + events.length : null;
    
    return jsonResponse(
      {
        ok: true,
        schemaVersion: '1.0.0',
        events: events.map(event => ({
          id: event.id,
          timestamp: event.timestamp,
          type: event.event_type,
          actor: event.actor,
          correlationId: event.request_id,
          sessionId: event.session_id,
          canonicalId: event.canonical_id,
          githubIssueNumber: event.gh_issue_number,
          prNumber: event.pr_number,
          subjectType: event.subject_type,
          subjectIdentifier: event.subject_identifier,
          summary: event.summary,
          links: event.links,
          // Note: details field may contain large payloads, sanitized by DB layer
          details: event.details,
        })),
        pagination: {
          cursor,
          limit,
          total: totalCount,
          hasMore,
          nextCursor,
        },
        filters: {
          sessionId: sessionId || null,
          issueId: issueId || null,
          types: eventTypes || null,
          startDate: startDate || null,
          endDate: endDate || null,
        },
      },
      { 
        requestId,
        headers: { 
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/admin/activity] Error querying activity log:', error);
    return errorResponse('Failed to load activity log', {
      status: 500,
      requestId,
      code: 'QUERY_FAILED',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
