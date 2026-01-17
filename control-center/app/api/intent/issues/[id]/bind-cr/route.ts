/**
 * API Route: POST /api/intent/issues/[id]/bind-cr
 * 
 * Bind a Change Request to an AFU-9 Issue
 * 
 * This creates an explicit binding between an AFU-9 Issue and a CR version.
 * The CR must be validated before binding. Publish requires an active CR binding.
 * 
 * Returns:
 * - 200: Success with updated issue
 * - 400: Invalid request
 * - 401: Unauthorized
 * - 404: Issue or CR not found
 * - 500: Internal error
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { bindCrToIssue, getAfu9IssueById } from '@/lib/db/afu9Issues';
import { logTimelineEvent } from '@/lib/db/issueTimeline';
import { recordEvidence } from '@/lib/db/issueEvidence';
import { IssueTimelineEventType } from '@/lib/contracts/issueTimeline';
import { IssueEvidenceType } from '@/lib/contracts/issueEvidence';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    // Authentication check
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
      });
    }
    
    // Get issue ID from params
    const { id: issueId } = await context.params;
    
    if (!issueId) {
      return errorResponse('Issue ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse request body
    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      return errorResponse('Invalid JSON body', {
        status: 400,
        requestId,
      });
    }
    
    const { cr_id } = body;
    
    if (!cr_id || typeof cr_id !== 'string') {
      return errorResponse('cr_id is required and must be a string (UUID)', {
        status: 400,
        requestId,
      });
    }
    
    const pool = getPool();
    
    // Verify issue exists
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return errorResponse('Issue not found', {
        status: 404,
        requestId,
        details: issueResult.error,
      });
    }
    
    const previousCrId = issueResult.data.active_cr_id;
    
    // Bind CR to issue
    const bindResult = await bindCrToIssue(pool, issueId, cr_id);
    
    if (!bindResult.success) {
      return errorResponse('Failed to bind CR', {
        status: 500,
        requestId,
        details: bindResult.error,
      });
    }
    
    // Log timeline event
    await logTimelineEvent(pool, {
      issue_id: issueId,
      event_type: IssueTimelineEventType.CR_BOUND,
      event_data: {
        cr_id,
        previous_cr_id: previousCrId,
        bound_by: userId,
      },
      actor: userId,
      actor_type: 'user',
    });
    
    // Record evidence
    await recordEvidence(pool, {
      issue_id: issueId,
      evidence_type: IssueEvidenceType.CR_BINDING_RECEIPT,
      evidence_data: {
        cr_id,
        bound_at: new Date().toISOString(),
        bound_by: userId,
        previous_cr_id: previousCrId || undefined,
      },
      request_id: requestId,
    });
    
    return jsonResponse({
      success: true,
      issue_id: issueId,
      active_cr_id: cr_id,
      previous_cr_id: previousCrId,
      message: 'CR bound successfully',
    }, {
      status: 200,
      requestId,
    });
  } catch (error) {
    console.error('[API /api/intent/issues/[id]/bind-cr] Error:', error);
    return errorResponse('Failed to bind CR', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
