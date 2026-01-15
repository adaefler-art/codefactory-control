/**
 * POST /api/automation/policy/evaluate
 * 
 * Debug endpoint for testing automation policy evaluation.
 * Returns policy decision without executing the action.
 * 
 * E87.2: Automation Policy Evaluation Debug Endpoint
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { evaluateAutomationPolicy } from '@/lib/automation/policy-evaluator';
import { PolicyEvaluationContext } from '@/lib/lawbook/automation-policy';
import { logger } from '@/lib/logger';

/**
 * POST /api/automation/policy/evaluate
 * 
 * Request body:
 * {
 *   actionType: string,
 *   targetType: string,
 *   targetIdentifier: string,
 *   deploymentEnv?: "staging" | "prod" | "development",
 *   actionContext: Record<string, unknown>,
 *   hasApproval?: boolean,
 *   approvalFingerprint?: string
 * }
 * 
 * Response:
 * {
 *   decision: "allowed" | "denied",
 *   allow: boolean,
 *   reason: string,
 *   nextAllowedAt: string | null,
 *   requiresApproval: boolean,
 *   idempotencyKey: string,
 *   idempotencyKeyHash: string,
 *   policyName: string | null,
 *   lawbookVersion?: string,
 *   lawbookHash?: string,
 *   enforcementData: object
 * }
 * 
 * Status codes:
 * - 200: Success (includes both allow and deny decisions)
 * - 400: Invalid input
 * - 500: Internal error
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || `policy-eval-${Date.now()}`;

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.actionType || !body.targetType || !body.targetIdentifier) {
      return NextResponse.json(
        {
          error: 'Missing required fields: actionType, targetType, targetIdentifier',
          code: 'MISSING_PARAMS',
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    if (!body.actionContext || typeof body.actionContext !== 'object') {
      return NextResponse.json(
        {
          error: 'Missing or invalid actionContext',
          code: 'INVALID_CONTEXT',
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Build policy evaluation context
    const context: PolicyEvaluationContext = {
      requestId,
      sessionId: body.sessionId,
      actionType: body.actionType,
      targetType: body.targetType,
      targetIdentifier: body.targetIdentifier,
      deploymentEnv: body.deploymentEnv,
      actor: request.headers.get('x-afu9-sub') || body.actor,
      actionContext: body.actionContext,
      hasApproval: body.hasApproval || false,
      approvalFingerprint: body.approvalFingerprint,
    };

    logger.info('Evaluating automation policy (debug)', {
      requestId,
      actionType: context.actionType,
      targetIdentifier: context.targetIdentifier,
      deploymentEnv: context.deploymentEnv,
    }, 'PolicyEvaluateAPI');

    // Evaluate policy (without recording - this is debug endpoint)
    const result = await evaluateAutomationPolicy(context);

    logger.info('Policy evaluation result (debug)', {
      requestId,
      decision: result.decision,
      policyName: result.policyName,
    }, 'PolicyEvaluateAPI');

    // Return result
    return NextResponse.json(
      {
        ...result,
        nextAllowedAt: result.nextAllowedAt?.toISOString() || null,
      },
      { status: 200, headers: { 'x-request-id': requestId } }
    );
  } catch (error) {
    logger.error(
      'Failed to evaluate policy',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'PolicyEvaluateAPI'
    );

    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
