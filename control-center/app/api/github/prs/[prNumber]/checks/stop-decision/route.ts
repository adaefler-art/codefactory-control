/**
 * GET /api/github/prs/{prNumber}/checks/stop-decision
 * 
 * Evaluates stop conditions based on lawbook rules to prevent infinite
 * loops in automated workflow reruns.
 * 
 * Epic E84.4: Stop Conditions + HOLD Rules
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { makeStopDecision } from '@/lib/github/stop-decision-service';
import { StopDecisionContextSchema } from '@/lib/types/stop-decision';
import { logger } from '@/lib/logger';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * GET /api/github/prs/{prNumber}/checks/stop-decision
 * 
 * Query parameters:
 * - owner: string (required)
 * - repo: string (required)
 * - runId: number (optional)
 * - failureClass: string (optional)
 * - currentJobAttempts: number (required)
 * - totalPrAttempts: number (required)
 * - lastChangedAt: ISO 8601 datetime (optional)
 * - firstFailureAt: ISO 8601 datetime (optional)
 * - previousFailureSignals: comma-separated hashes (optional)
 * - requestId: string (optional)
 * 
 * Response:
 * {
 *   schemaVersion: "1.0",
 *   requestId: string,
 *   lawbookHash: string,
 *   deploymentEnv: "staging" | "prod",
 *   target: { prNumber, runId? },
 *   decision: "CONTINUE" | "HOLD" | "KILL",
 *   reasonCode?: string,
 *   reasons: string[],
 *   recommendedNextStep: "PROMPT" | "MANUAL_REVIEW" | "FIX_REQUIRED" | "WAIT",
 *   evidence: { attemptCounts, thresholds, appliedRules },
 *   metadata: { evaluatedAt, lawbookVersion? }
 * }
 * 
 * Status codes:
 * - 200: Success
 * - 400: Invalid input
 * - 500: Internal error
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || `stop-decision-${Date.now()}`;

  try {
    // Get PR number from params
    const params = await context.params;
    const prNumber = parseInt(params.prNumber, 10);

    if (isNaN(prNumber) || prNumber <= 0) {
      return NextResponse.json(
        { error: 'Invalid PR number', code: 'INVALID_PR_NUMBER' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const currentJobAttempts = searchParams.get('currentJobAttempts');
    const totalPrAttempts = searchParams.get('totalPrAttempts');

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing required query parameters: owner, repo', code: 'MISSING_PARAMS' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    if (!currentJobAttempts || !totalPrAttempts) {
      return NextResponse.json(
        { 
          error: 'Missing required query parameters: currentJobAttempts, totalPrAttempts', 
          code: 'MISSING_PARAMS' 
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Parse optional parameters
    const runIdStr = searchParams.get('runId');
    const runId = runIdStr ? parseInt(runIdStr, 10) : undefined;
    const failureClass = searchParams.get('failureClass') || undefined;
    const lastChangedAt = searchParams.get('lastChangedAt') || undefined;
    const firstFailureAt = searchParams.get('firstFailureAt') || undefined;
    const previousFailureSignalsStr = searchParams.get('previousFailureSignals');
    const previousFailureSignals = previousFailureSignalsStr 
      ? previousFailureSignalsStr.split(',').filter(s => s.length > 0)
      : undefined;

    // Validate and create context
    const stopContext = StopDecisionContextSchema.parse({
      owner,
      repo,
      prNumber,
      runId,
      failureClass,
      attemptCounts: {
        currentJobAttempts: parseInt(currentJobAttempts, 10),
        totalPrAttempts: parseInt(totalPrAttempts, 10),
      },
      lastChangedAt,
      firstFailureAt,
      previousFailureSignals,
      requestId,
    });

    logger.info('Processing stop decision request', {
      owner,
      repo,
      prNumber,
      requestId,
    }, 'StopDecisionAPI');

    // Evaluate stop decision
    const result = await makeStopDecision(stopContext);

    logger.info('Stop decision completed', {
      requestId,
      decision: result.decision,
      reasonCode: result.reasonCode,
    }, 'StopDecisionAPI');

    return NextResponse.json(result, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error) {
    logger.error(
      'Failed to evaluate stop decision',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'StopDecisionAPI'
    );

    // Validation errors
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          code: 'INVALID_INPUT',
          details: error,
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Generic error
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
