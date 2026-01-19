/**
 * API Route: POST /api/afu9/runs/:runId/evidence/refresh
 * 
 * I201.6: Evidence Link/Refresh Endpoint
 * 
 * Updates the evidence reference for a run without duplicating Engine evidence.
 * Control stores only a reference (URL + hash + fetchedAt + version).
 * 
 * Request:
 * - POST /api/afu9/runs/:runId/evidence/refresh
 * - Body: { url: string, evidenceHash: string, version?: string }
 * 
 * Response:
 * - 200: { runId, evidenceRef: { url, evidenceHash, fetchedAt, version } }
 * - 400: Invalid request body
 * - 404: Run not found
 * - 500: Server error
 * 
 * Side Effects:
 * - Updates run evidence reference fields (deterministic, bounded)
 * - Optionally logs EVIDENCE_LINKED timeline event
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRunsDAO } from '@/lib/db/afu9Runs';
import { logTimelineEvent } from '@/lib/db/issueTimeline';
import { IssueTimelineEventType, ActorType } from '@/lib/contracts/issueTimeline';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Request body schema for evidence refresh
 */
const EvidenceRefreshBodySchema = z.object({
  url: z.string().min(1, 'url is required'),
  evidenceHash: z.string().length(64, 'evidenceHash must be 64-character SHA256 hash'),
  version: z.string().optional(),
}).strict();

/**
 * POST /api/afu9/runs/:runId/evidence/refresh
 * Update evidence reference for a run
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const requestId = getRequestId(request);

  try {
    const pool = getPool();
    const dao = getRunsDAO(pool);
    const { runId } = await params;

    // Parse and validate request body
    const body = await request.json();
    const parseResult = EvidenceRefreshBodySchema.safeParse(body);

    if (!parseResult.success) {
      return errorResponse('Invalid request body', {
        status: 400,
        requestId,
        details: parseResult.error.errors,
      });
    }

    const { url, evidenceHash, version } = parseResult.data;

    // Verify run exists
    const run = await dao.getRun(runId);
    if (!run) {
      return errorResponse('Run not found', {
        status: 404,
        requestId,
        details: { runId },
      });
    }

    // Update evidence reference (deterministic, bounded operation)
    await dao.updateEvidenceRef(runId, url, evidenceHash, version);

    // Get updated run to fetch the fetchedAt timestamp
    const updatedRun = await dao.getRun(runId);
    if (!updatedRun || !updatedRun.run.evidence_fetched_at) {
      // Should not happen - the update should have set the timestamp
      throw new Error('Evidence reference update failed - timestamp not set');
    }

    const evidenceRef = {
      url,
      evidenceHash,
      fetchedAt: updatedRun.run.evidence_fetched_at.toISOString(),
      version: version || undefined,
    };

    // Optional: Log EVIDENCE_LINKED timeline event if run has issue_id
    const issueId = run.run.issue_id;
    if (issueId) {
      await logTimelineEvent(pool, {
        issue_id: issueId,
        event_type: IssueTimelineEventType.EVIDENCE_LINKED,
        event_data: {
          runId,
          evidenceHash,
          evidenceUrl: url,
          evidenceVersion: version,
        },
        actor: ActorType.SYSTEM,
        actor_type: ActorType.SYSTEM,
      });
    }

    return jsonResponse(
      {
        runId,
        evidenceRef,
      },
      {
        requestId,
        status: 200,
      }
    );
  } catch (error) {
    console.error('[API /api/afu9/runs/:runId/evidence/refresh] Error:', error);
    return errorResponse('Failed to refresh evidence', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
