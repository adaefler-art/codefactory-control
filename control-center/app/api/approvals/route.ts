/**
 * POST /api/approvals - Create Approval Record (E87.1)
 * 
 * Creates an approval record for a dangerous operation.
 * 
 * SECURITY:
 * - Requires authentication (x-afu9-sub header)
 * - Validates signed phrase (exact match)
 * - Computes deterministic action fingerprint
 * - Append-only audit (no updates)
 * 
 * GUARD ORDER:
 * 1. AUTH CHECK (401) - Verify x-afu9-sub
 * 2. Input validation (400) - Validate request body
 * 3. Phrase validation (400) - Verify signed phrase
 * 4. DB insert (500) - Append-only insert
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { 
  ApprovalRequest,
  ActionType,
  validateApprovalRequest,
  computeActionFingerprint,
} from '@/lib/approvals/approval-gate';
import { insertApprovalRecord } from '@/lib/db/approvals';
import { recordMergeApprovalTouchpoint } from '@/lib/touchpoints/manual-touchpoints';

// ========================================
// Request Schema
// ========================================

const ApprovalRequestSchema = z.object({
  actionContext: z.object({
    actionType: z.enum(['merge', 'prod_operation', 'destructive_operation']),
    targetType: z.string(),
    targetIdentifier: z.string(),
    params: z.record(z.any()).optional(),
  }),
  approvalContext: z.object({
    sessionId: z.string().optional(),
    lawbookVersion: z.string().optional(),
    lawbookHash: z.string().optional(),
    contextPackHash: z.string().optional(),
    contextSummary: z.record(z.any()).optional(),
  }),
  signedPhrase: z.string(),
  reason: z.string().optional(),
  decision: z.enum(['approved', 'denied', 'cancelled']),
});

// ========================================
// POST Handler
// ========================================

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // GUARD 1: AUTH CHECK (401-first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
        details: 'Authentication required - no verified user context',
      });
    }
    
    // Parse request body
    let body: z.infer<typeof ApprovalRequestSchema>;
    try {
      const rawBody = await request.json();
      body = ApprovalRequestSchema.parse(rawBody);
    } catch (error) {
      return errorResponse('Invalid request body', {
        status: 400,
        requestId,
        code: 'INVALID_REQUEST',
        details: error instanceof Error ? error.message : 'Request validation failed',
      });
    }
    
    // Build approval request
    const approvalRequest: ApprovalRequest = {
      actionContext: body.actionContext,
      approvalContext: {
        requestId,
        ...body.approvalContext,
      },
      actor: userId,
      signedPhrase: body.signedPhrase,
      reason: body.reason,
    };
    
    // GUARD 2: Validate approval request (phrase, action type, etc.)
    const validation = validateApprovalRequest(approvalRequest);
    if (!validation.valid) {
      return errorResponse('Approval validation failed', {
        status: 400,
        requestId,
        code: 'VALIDATION_FAILED',
        details: validation.errors.join('; '),
      });
    }
    
    // Compute action fingerprint
    const actionFingerprint = computeActionFingerprint(approvalRequest.actionContext);
    
    // Insert approval record (append-only)
    const pool = getPool();
    const approvalRecord = await insertApprovalRecord(
      pool,
      approvalRequest,
      body.decision
    );
    
    // E88.1: Record manual touchpoint for merge approvals
    // Only record for 'merge' action type when decision is 'approved'
    if (
      approvalRecord.action_type === 'merge' && 
      approvalRecord.decision === 'approved'
    ) {
      // Extract PR number from target_identifier if it's a PR
      // Format: "owner/repo#123" or similar
      const prMatch = approvalRecord.target_identifier.match(/#(\d+)/);
      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;
      
      await recordMergeApprovalTouchpoint(pool, {
        prNumber,
        actor: userId,
        requestId,
        source: 'API',
        metadata: {
          actionType: approvalRecord.action_type,
          targetIdentifier: approvalRecord.target_identifier,
          signedPhrase: body.signedPhrase,
        },
      });
    }
    
    // Return success with approval details
    return jsonResponse(
      {
        success: true,
        approval: {
          id: approvalRecord.id,
          actionType: approvalRecord.action_type,
          actionFingerprint,
          decision: approvalRecord.decision,
          targetIdentifier: approvalRecord.target_identifier,
          actor: approvalRecord.actor,
          createdAt: approvalRecord.created_at.toISOString(),
        },
        message: `Approval ${body.decision} recorded`,
      },
      { status: 201, requestId }
    );
    
  } catch (error) {
    console.error('[APPROVALS] Error creating approval:', error);
    
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// ========================================
// GET Handler (optional - for querying approvals)
// ========================================

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  
  try {
    // AUTH CHECK
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        code: 'UNAUTHORIZED',
      });
    }
    
    // Get query params
    const { searchParams } = new URL(request.url);
    const actionFingerprint = searchParams.get('actionFingerprint');
    const reqId = searchParams.get('requestId');
    
    if (!actionFingerprint || !reqId) {
      return errorResponse('Missing required query params', {
        status: 400,
        requestId,
        code: 'INVALID_REQUEST',
        details: 'actionFingerprint and requestId are required',
      });
    }
    
    // Query approval
    const { getApprovalByFingerprint } = await import('@/lib/db/approvals');
    const pool = getPool();
    const approval = await getApprovalByFingerprint(pool, actionFingerprint, reqId);
    
    if (!approval) {
      return jsonResponse(
        { found: false, approval: null },
        { status: 404, requestId }
      );
    }
    
    return jsonResponse(
      {
        found: true,
        approval: {
          id: approval.id,
          actionType: approval.action_type,
          actionFingerprint: approval.action_fingerprint,
          decision: approval.decision,
          targetIdentifier: approval.target_identifier,
          actor: approval.actor,
          createdAt: approval.created_at.toISOString(),
        },
      },
      { status: 200, requestId }
    );
    
  } catch (error) {
    console.error('[APPROVALS] Error querying approval:', error);
    
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      code: 'INTERNAL_ERROR',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
