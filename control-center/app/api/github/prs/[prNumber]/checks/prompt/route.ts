/**
 * GET /api/github/prs/{prNumber}/checks/prompt
 * 
 * Generates a deterministic Copilot prompt from a checks triage report.
 * 
 * Epic E84.2: Copilot Prompt Generator
 * 
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateChecksTriageReport } from '@/lib/github/checks-triage-service';
import { generateCopilotPrompt } from '@/lib/github/copilot-prompt-generator';
import { ChecksTriageInputSchema } from '@/lib/types/checks-triage';
import { logger } from '@/lib/logger';
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

type RouteContext = {
  params: Promise<{
    prNumber: string;
  }>;
};

/**
 * GET /api/github/prs/{prNumber}/checks/prompt?owner=...&repo=...
 * 
 * Query params:
 * - owner: string (required)
 * - repo: string (required)
 * - workflowRunId: number (optional)
 * - maxLogBytes: number (optional, default 65536)
 * - maxSteps: number (optional, default 50)
 * - maxFiles: number (optional, default 5) - max files to suggest touching
 * 
 * Response: CopilotPromptV1
 * {
 *   schemaVersion: "1.0",
 *   requestId: string,
 *   lawbookHash: string,
 *   failureClass: "lint" | "test" | "build" | "e2e" | "infra" | "deploy" | "unknown",
 *   promptText: string,
 *   attachments: { evidenceUrls: string[], excerptHashes: string[] },
 *   verifySteps: string[],
 *   doneDefinition: string[]
 * }
 * 
 * Status codes:
 * - 200: Success
 * - 400: Invalid input
 * - 401: Authentication required
 * - 403: Repository access denied
 * - 404: PR not found
 * - 409: No failures found (conflict - nothing to fix)
 * - 500: Internal error
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const requestId = request.headers.get('x-request-id') || `prompt-${Date.now()}`;

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
    const maxFiles = searchParams.get('maxFiles');

    if (!owner || !repo) {
      return NextResponse.json(
        { error: 'Missing required parameters: owner, repo', code: 'MISSING_PARAMS' },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }

    // Validate input
    const triageInput = ChecksTriageInputSchema.parse({
      owner,
      repo,
      prNumber,
      workflowRunId: workflowRunId ? parseInt(workflowRunId, 10) : undefined,
      maxLogBytes: maxLogBytes ? parseInt(maxLogBytes, 10) : undefined,
      maxSteps: maxSteps ? parseInt(maxSteps, 10) : undefined,
      requestId,
    });

    logger.info('Generating copilot prompt from checks', {
      owner: triageInput.owner,
      repo: triageInput.repo,
      prNumber,
      requestId,
    }, 'CopilotPromptAPI');

    // Generate triage report
    const triageReport = await generateChecksTriageReport(triageInput);

    // Check if there are failures
    if (triageReport.failures.length === 0) {
      logger.info('No failures found, cannot generate prompt', {
        requestId,
        overall: triageReport.summary.overall,
      }, 'CopilotPromptAPI');

      return NextResponse.json(
        {
          error: 'No failures found in checks',
          code: 'NO_FAILURES',
          details: {
            overall: triageReport.summary.overall,
            message: 'All checks are passing, no prompt needed',
          },
        },
        { status: 409, headers: { 'x-request-id': requestId } }
      );
    }

    // Generate copilot prompt
    const prompt = await generateCopilotPrompt({
      triageReport,
      constraints: {
        maxFiles: maxFiles ? parseInt(maxFiles, 10) : 5,
        preferMinimalDiff: true,
      },
    });

    logger.info('Copilot prompt generated successfully', {
      requestId,
      failureClass: prompt.failureClass,
      failureCount: triageReport.failures.length,
      promptLength: prompt.promptText.length,
    }, 'CopilotPromptAPI');

    return NextResponse.json(prompt, {
      status: 200,
      headers: { 'x-request-id': requestId },
    });
  } catch (error) {
    logger.error(
      'Failed to generate copilot prompt',
      error instanceof Error ? error : new Error(String(error)),
      { requestId },
      'CopilotPromptAPI'
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
