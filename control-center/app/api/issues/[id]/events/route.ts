/**
 * API Route: /api/issues/[id]/events
 * 
 * Retrieves activity log events for an AFU9 issue
 * Issue #5: AFU9 Single-Issue Mode Enforcement + Activity Log
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getIssueEvents } from '../../../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { fetchIssueRowByIdentifier } from '../../_shared';
import { normalizeOutput } from '@/lib/api/normalize-output';
import { isAfu9IssueEventOutput } from '@/lib/contracts/outputContracts';

/**
 * GET /api/issues/[id]/events
 * 
 * Retrieves the activity log events for an issue
 * 
 * Query parameters:
 * - limit: Maximum number of events to return (default: 100, max: 500)
 */
export async function GET(
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

    // Parse limit parameter
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      500
    );

    // Get events from database
    const result = await getIssueEvents(pool, internalId, limit);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to get issue events', details: result.error },
        { status: 500 }
      );
    }

    // Normalize events to ensure timestamps are ISO strings
    const normalizedEvents = normalizeOutput(result.data || []);

    // Validate each event against the output contract
    if (Array.isArray(normalizedEvents)) {
      for (const event of normalizedEvents) {
        if (!isAfu9IssueEventOutput(event)) {
          // Log validation failure with evidence
          const eventRecord = event as Record<string, unknown>;
          const evidence: Record<string, string> = {};
          ['id', 'issue_id', 'event_type', 'created_at'].forEach(field => {
            const value = eventRecord[field];
            evidence[field] = `type=${typeof value}, isNull=${value === null}`;
          });
          
          console.error('[API /api/issues/[id]/events] Event output contract validation failed', {
            issueId: internalId,
            eventId: eventRecord?.id,
            evidence,
          });
          throw new Error('Afu9IssueEventOutput contract validation failed');
        }
      }
    }

    const responseBody: any = {
      events: normalizedEvents,
      total: Array.isArray(normalizedEvents) ? normalizedEvents.length : 0,
      limit,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[API /api/issues/[id]/events] Error getting events:', error);
    return NextResponse.json(
      {
        error: 'Failed to get issue events',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
