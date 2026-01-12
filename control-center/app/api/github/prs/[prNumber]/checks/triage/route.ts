/**
 * GET /api/github/prs/{prNumber}/checks/triage
 * 
 * Analyzes GitHub PR checks to classify failures, extract logs, and recommend actions.
 * Returns deterministic triage report for failed checks.
 * 
 * Epic E84.1: Checks Triage Analyzer
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { generateChecksTriageReport } from '@/lib/github/checks-triage-service';
import {
  ChecksTriageInputSchema,
} from '@/lib/types/checks-triage';
import { logger } from '@/lib/logger';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * GET /api/github/prs/{prNumber}/checks/triage?owner=...&repo=...
 * 
 * Query params:
 * - owner: string (required)
 * - repo: string (required)
 * - workflowRunId: number (optional)
 * - maxLogBytes: number (optional, default 65536)
 * - maxSteps: number (optional, default 50)
 * 
 * Response:
 * {
 *   schemaVersion: "1.0",
 *   requestId: string,
 *   deploymentEnv: "staging" | "prod",
 *   lawbookHash: string,
 *   repo: { owner, repo },
 *   pr: { number, headSha },
 *   summary: { overall, failingChecks, failingRuns },
 *   failures: FailureV1[]
 * }
 * 
 * Status codes:
 * - 200: Success
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Repository access denied
 * - 404: PR not found
 * - 500: Internal error
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || `triage-${Date.now()}`;

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
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner');
    const repo = searchParams.get('repo');
    const workflowRunId = searchParams.get('workflowRunId');
    const maxLogBytes = searchParams.get('maxLogBytes');
    const maxSteps = searchParams.get('maxSteps');

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing required parameters: owner, repo', code: 'MISSING_PARAMS' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Validate input
    const input = ChecksTriageInputSchema.parse({
      owner,
      repo,
      prNumber,
      workflowRunId: workflowRunId ? parseInt(workflowRunId, 10) : undefined,
      maxLogBytes: maxLogBytes ? parseInt(maxLogBytes, 10) : undefined,
      maxSteps: maxSteps ? parseInt(maxSteps, 10) : undefined,
      requestId,
    });

    logger.info('Generating checks triage report', {
      owner: input.owner,
      repo: input.repo,
      prNumber,
      requestId,
    }, 'ChecksTriageAPI');

    // Generate triage report
    const report = await generateChecksTriageReport(input);

    logger.info('Checks triage report generated', {
      requestId,
      overall: report.summary.overall,
      failingChecks: report.summary.failingChecks,
      failingRuns: report.summary.failingRuns,
    }, 'ChecksTriageAPI');

    return NextResponse.json(report, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error) {
    logger.error(
      'Failed to generate checks triage report',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'ChecksTriageAPI'
    );

    // Handle specific errors
    if (error instanceof RepoAccessDeniedError) {
      return NextResponse.json(
        {
          error: 'Repository access denied',
          code: 'REPO_ACCESS_DENIED',
          details: { repository: error.repository },
        },
        { status: 403, headers: { 'x-request-id': requestId } }
      );
    }

    // Validation errors
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          code: 'INVALID_INPUT',
          details: error.errors,
        },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // GitHub API errors
    if (error instanceof Error && error.message.includes('Not Found')) {
      return NextResponse.json(
        {
          error: 'PR not found',
          code: 'PR_NOT_FOUND',
        },
        { status: 404, headers: { 'x-request-id': requestId } }
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
