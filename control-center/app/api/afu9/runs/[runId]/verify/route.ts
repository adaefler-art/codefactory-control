/**
 * API Route: POST /api/afu9/runs/:runId/verify
 * 
 * E9.3-CTRL-06: Verify Gate (S7 Verdict)
 * 
 * Accepts evidence and sets explicit verdict (GREEN/RED) for a deployment.
 * No implicit success - verdict must be explicitly set based on evidence.
 * 
 * Request:
 * - POST /api/afu9/runs/:runId/verify
 * - Body: { evidence: VerificationEvidence }
 * 
 * Response:
 * - 200: { verdict, verdictId, evidenceId, evaluatedAt, rationale }
 * - 400: Invalid evidence
 * - 404: Run not found
 * - 500: Server error
 * 
 * Side Effects:
 * - Creates verdict record (always explicit GREEN or RED)
 * - Links evidence to verdict (immutable)
 * - Logs VERIFICATION_COMPLETED timeline event
 * - Updates issue status based on verdict
 * 
 * Guarantees:
 * - Fail-closed: No implicit success
 * - Deterministic: Same evidence → Same verdict
 * - Idempotent: Multiple calls with same evidence → Same result
 */

import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { validateVerificationEvidence, evaluateVerdict, storeVerdict, linkEvidence } from '@/lib/verification/verificationService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/afu9/runs/:runId/verify
 * Verify deployment with evidence and set explicit verdict
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    const { runId } = await params;

    // Parse and validate request body
    const body = await request.json().catch(() => null);
    
    if (!body || !body.evidence) {
      return errorResponse('Evidence is required', {
        status: 400,
        requestId,
        details: 'Request body must contain evidence field',
      });
    }

    // Validate evidence structure
    const validation = validateVerificationEvidence(body.evidence);
    if (!validation.valid) {
      return errorResponse('Invalid evidence', {
        status: 400,
        requestId,
        details: validation.error,
      });
    }

    const { evidence } = body;

    // Verify run exists and get associated issue
    const runQuery = await pool.query(
      `SELECT lr.id, lr.issue_id, ai.status 
       FROM loop_runs lr
       JOIN afu9_issues ai ON lr.issue_id = ai.id
       WHERE lr.id = $1`,
      [runId]
    );

    if (runQuery.rows.length === 0) {
      return errorResponse('Run not found', {
        status: 404,
        requestId,
        details: { runId },
      });
    }

    const run = runQuery.rows[0];
    const issueId = run.issue_id;

    // Evaluate verdict based on evidence (deterministic)
    const evaluationResult = evaluateVerdict(evidence);
    const { verdict, rationale, failedChecks, evaluationRules } = evaluationResult;

    // Store verdict with evidence link (idempotent)
    const verdictResult = await storeVerdict(pool, {
      issueId,
      runId,
      verdict,
      evidence,
      rationale,
      failedChecks,
      evaluationRules,
      requestId,
    });

    if (!verdictResult.success) {
      return errorResponse('Failed to store verdict', {
        status: 500,
        requestId,
        details: verdictResult.error || 'Unknown error',
      });
    }

    const { verdictId, evidenceId, evaluatedAt } = verdictResult;

    // Link evidence to verdict (immutable)
    await linkEvidence(pool, verdictId, evidenceId, evidence);

    return jsonResponse({
      verdict,
      verdictId,
      evidenceId,
      evaluatedAt,
      rationale,
      ...(failedChecks && failedChecks.length > 0 ? { failedChecks } : {}),
    }, {
      requestId,
      status: 200,
    });
  } catch (error) {
    console.error('[API /api/afu9/runs/:runId/verify] Error:', error);
    return errorResponse('Failed to verify deployment', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
