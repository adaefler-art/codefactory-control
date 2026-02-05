/**
 * GET /api/loop/issues/[issueId]/events
 * 
 * E9.1-CTRL-8: Query timeline events for loop runs by issue ID
 * 
 * Returns events in reverse chronological order with pagination.
 * Events follow the loop-timeline-events.v1 contract.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getLoopEventStore } from '@/lib/loop/eventStore';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../../../issues/_shared';

const SCHEMA_VERSION = 'loop.events.v1';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> }
): Promise<NextResponse> {
  try {
    const requestId = getRequestId(request);
    const { issueId } = await context.params;
    const responseHeaders = getControlResponseHeaders(requestId);

    const resolved = await resolveIssueIdentifier(issueId, requestId);
    if (!resolved.ok) {
      return jsonResponse(
        resolved.body,
        { status: resolved.status, requestId, headers: responseHeaders }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    const limit = Math.min(
      parseInt(limitParam || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(offsetParam || '0', 10);

    // Validate pagination parameters
    if (isNaN(limit) || limit < 1) {
      return jsonResponse(
        {
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: 'INVALID_REQUEST',
            message: 'limit must be a positive integer',
          },
        },
        { status: 400, requestId, headers: responseHeaders }
      );
    }

    if (isNaN(offset) || offset < 0) {
      return jsonResponse(
        {
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: 'INVALID_REQUEST',
            message: 'offset must be a non-negative integer',
          },
        },
        { status: 400, requestId, headers: responseHeaders }
      );
    }

    const pool = getPool();
    const eventStore = getLoopEventStore(pool);

    // Get events and total count
    const [events, total] = await Promise.all([
      eventStore.getEventsByIssue(resolved.uuid, limit, offset),
      eventStore.countEventsByIssue(resolved.uuid),
    ]);

    // Transform events to API response format
    const formattedEvents = events.map(event => ({
      id: event.id,
      issueId: event.issue_id,
      runId: event.run_id,
      eventType: event.event_type,
      eventData: event.event_data,
      occurredAt: event.occurred_at.toISOString(),
    }));

    return jsonResponse(
      {
        schemaVersion: SCHEMA_VERSION,
        issueId: resolved.uuid,
        events: formattedEvents,
        total,
        limit,
        offset,
      },
      { requestId, headers: responseHeaders }
    );
  } catch (error) {
    console.error('[API] Error fetching loop events', error);

    const requestId = getRequestId(request);
    return jsonResponse(
      {
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      },
      { status: 500, requestId, headers: getControlResponseHeaders(requestId) }
    );
  }
}
