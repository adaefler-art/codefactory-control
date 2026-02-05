/**
 * API Route: /api/issues/[id]/events
 * 
 * Retrieves activity log events for an AFU9 issue
 * Issue #5: AFU9 Single-Issue Mode Enforcement + Activity Log
 * Issue #3: Identifier Consistency (UUID + publicId)
 * 
 * **Identifier Handling:**
 * - Accepts both UUID (canonical) and 8-hex publicId (display)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getIssueEvents } from '../../../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { getControlResponseHeaders, resolveIssueIdentifier } from '../../_shared';
import { normalizeOutput } from '@/lib/api/normalize-output';
import { isAfu9IssueEventOutput } from '@/lib/contracts/outputContracts';
import { getRequestId, jsonResponse } from '@/lib/api/response-helpers';

/**
 * GET /api/issues/[id]/events
 * 
 * Retrieves the activity log events for an issue
 * 
 * **Identifier Formats (Issue #3):**
 * - Full UUID: "a1b2c3d4-5678-90ab-cdef-1234567890ab"
 * - 8-hex publicId: "a1b2c3d4"
 * 
 * Query parameters:
 * - limit: Maximum number of events to return (default: 100, max: 500)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pool = getPool();
    const { id } = await params;
    const requestId = getRequestId(request);
    const responseHeaders = getControlResponseHeaders(requestId);
    const resolved = await resolveIssueIdentifier(id, requestId);
    if (!resolved.ok) {
      return jsonResponse(resolved.body, {
        status: resolved.status,
        requestId,
        headers: responseHeaders,
      });
    }

    const internalId = resolved.uuid;

    // Parse limit parameter
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100', 10),
      500
    );

    // Get events from database
    const result = await getIssueEvents(pool, internalId, limit);

    if (!result.success) {
      return jsonResponse(
        { error: 'Failed to get issue events', details: result.error },
        { status: 500, requestId, headers: responseHeaders }
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

    return jsonResponse(responseBody, { requestId, headers: responseHeaders });
  } catch (error) {
    console.error('[API /api/issues/[id]/events] Error getting events:', error);
    const requestId = getRequestId(request);
    return jsonResponse(
      {
        error: 'Failed to get issue events',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500, requestId, headers: getControlResponseHeaders(requestId) }
    );
  }
}
