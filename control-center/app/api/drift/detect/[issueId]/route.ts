/**
 * API Route: Detect Drift
 * E85.4: Drift Detection + Repair Suggestions
 * 
 * GET /api/drift/detect/:issueId
 * 
 * Detects drift between AFU-9 and GitHub for a specific issue.
 * Returns drift detection results with repair suggestions.
 * 
 * Guards:
 * - ❌ No Auto-Repair
 * - ✅ Evidence-first
 * - ✅ Read-only operation
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { Octokit } from 'octokit';
import { DriftDetectionService } from '@/lib/drift-detection-service';
import { saveDriftDetection } from '@/lib/db/driftDetection';
import { getAfu9IssueById } from '@/lib/db/afu9Issues';
import { getPool } from '@/lib/db';
import { getOctokit } from '@/lib/github';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drift/detect/:issueId
 * 
 * Detect drift for an issue
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { issueId: string } }
): Promise<NextResponse> {
  const { issueId } = params;

  try {
    const pool = getPool();
    const octokit = getOctokit();

    // Get issue to find GitHub metadata
    const issueResult = await getAfu9IssueById(pool, issueId);
    if (!issueResult.success || !issueResult.data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Issue not found',
        },
        { status: 404 }
      );
    }

    const issue = issueResult.data;

    // Validate GitHub metadata
    if (!issue.github_owner || !issue.github_repo || !issue.github_issue_number) {
      return NextResponse.json(
        {
          success: false,
          error: 'Issue does not have GitHub metadata (not synced to GitHub)',
        },
        { status: 400 }
      );
    }

    // Parse dry_run flag from query params
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';

    // Create drift detection service
    const service = new DriftDetectionService(pool, octokit);

    // Detect drift
    const detection = await service.detectDrift({
      issue_id: issueId,
      github_owner: issue.github_owner,
      github_repo: issue.github_repo,
      github_issue_number: issue.github_issue_number,
      dry_run: dryRun,
    });

    // Save detection to database (unless dry-run)
    if (!dryRun) {
      const saveResult = await saveDriftDetection(pool, detection);
      if (!saveResult.success) {
        console.error('[drift/detect] Failed to save detection:', saveResult.error);
        // Continue anyway - detection is already computed
      }
    }

    return NextResponse.json({
      success: true,
      data: detection,
    });
  } catch (error) {
    console.error('[drift/detect] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
