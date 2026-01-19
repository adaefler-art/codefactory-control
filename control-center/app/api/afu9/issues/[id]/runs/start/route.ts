/**
 * API Route: POST /api/afu9/issues/:issueId/runs/start
 * 
 * I201.4: Start Run Endpoint (MVP)
 * 
 * Creates a run record, transitions issue state, and logs timeline event.
 * 
 * Request:
 * - POST /api/afu9/issues/:issueId/runs/start
 * - Body: { type?: string } (optional run type)
 * 
 * Response:
 * - 200: { runId, issueId, type, status, createdAt, startedAt }
 * - 404: Issue not found
 * - 500: Server error
 * 
 * Side Effects:
 * - Creates run record with status=RUNNING
 * - Transitions issue: CREATED → IMPLEMENTING
 * - Logs RUN_STARTED timeline event
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRunsDAO } from '@/lib/db/afu9Runs';
import { updateAfu9Issue, getAfu9IssueById } from '@/lib/db/afu9Issues';
import { logTimelineEvent } from '@/lib/db/issueTimeline';
import { Afu9IssueStatus } from '@/lib/contracts/afu9Issue';
import { IssueTimelineEventType, ActorType } from '@/lib/contracts/issueTimeline';
import { v4 as uuidv4 } from 'uuid';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/afu9/issues/:issueId/runs/start
 * Start a new run for an issue
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const dao = getRunsDAO(pool);
    const { id: issueId } = await params;

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const runType = body.type || 'manual';

    // Verify issue exists
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return errorResponse('Issue not found', {
        status: 404,
        requestId,
        details: { issueId },
      });
    }

    const issue = issueResult.data;

    // Generate run ID
    const runId = uuidv4();
    const now = new Date();

    // Create run with minimal spec
    const spec = {
      title: `Run for ${issue.title}`,
      runtime: 'afu9' as const,
      steps: [
        {
          name: 'Initialize',
          shell: 'bash' as const,
          command: 'echo "Run started"',
        },
      ],
    };

    // Create run in database
    await dao.createRun(runId, spec, issueId, undefined, undefined);

    // Transition run to RUNNING immediately
    await dao.updateRunStatus(runId, 'RUNNING', now, undefined);

    // Update issue state: CREATED → IMPLEMENTING (if applicable)
    if (issue.status === Afu9IssueStatus.CREATED) {
      await updateAfu9Issue(pool, issueId, {
        status: Afu9IssueStatus.IMPLEMENTING,
        execution_state: 'RUNNING',
        execution_started_at: now.toISOString(),
      });
    }

    // Log RUN_STARTED timeline event
    await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.RUN_STARTED,
      event_data: {
        runId,
        type: runType,
        status: 'RUNNING',
      },
      actor: ActorType.SYSTEM,
      actor_type: ActorType.SYSTEM,
    });

    return jsonResponse({
      runId,
      issueId,
      type: runType,
      status: 'RUNNING',
      createdAt: now.toISOString(),
      startedAt: now.toISOString(),
    }, {
      requestId,
      status: 200,
    });
  } catch (error) {
    console.error('[API /api/afu9/issues/:id/runs/start] Error:', error);
    return errorResponse('Failed to start run', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
