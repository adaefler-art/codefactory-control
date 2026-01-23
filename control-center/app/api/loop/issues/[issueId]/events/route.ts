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

const SCHEMA_VERSION = 'loop.events.v1';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ issueId: string }> }
): Promise<NextResponse> {
  try {
    const { issueId } = await context.params;

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
      return NextResponse.json(
        {
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: 'INVALID_REQUEST',
            message: 'limit must be a positive integer',
          },
        },
        { status: 400 }
      );
    }

    if (isNaN(offset) || offset < 0) {
      return NextResponse.json(
        {
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: 'INVALID_REQUEST',
            message: 'offset must be a non-negative integer',
          },
        },
        { status: 400 }
      );
    }

    const pool = getPool();
    const eventStore = getLoopEventStore(pool);

    // Get events and total count
    const [events, total] = await Promise.all([
      eventStore.getEventsByIssue(issueId, limit, offset),
      eventStore.countEventsByIssue(issueId),
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

    return NextResponse.json({
      schemaVersion: SCHEMA_VERSION,
      issueId,
      events: formattedEvents,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[API] Error fetching loop events', error);

    return NextResponse.json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      },
      { status: 500 }
    );
  }
}
