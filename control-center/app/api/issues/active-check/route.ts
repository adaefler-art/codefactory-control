/**
 * API Route: /api/issues/active-check
 * 
 * Check if there is currently an active issue.
 * Used by the UI to enforce Single-Active constraint before activation.
 * Issue #I5-2.1: Enforce Single Active Issue
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getActiveIssue } from '../../../../src/lib/db/afu9Issues';
import { buildContextTrace, isDebugApiEnabled } from '@/lib/api/context-trace';
import { toPublicIdFromUuid } from '../_shared';
import { normalizeOutput } from '@/lib/api/normalize-output';

/**
 * GET /api/issues/active-check
 * 
 * Returns information about the currently active issue (if any).
 * 
 * Response:
 * {
 *   hasActive: boolean,
 *   activeIssue: { id: string, publicId: string, title: string } | null
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const pool = getPool();

    // Get the currently active issue
    const activeIssueResult = await getActiveIssue(pool);
    
    if (!activeIssueResult.success) {
      return NextResponse.json(
        {
          error: 'Failed to check active issue',
          details: activeIssueResult.error,
        },
        { status: 500 }
      );
    }

    const activeIssue = activeIssueResult.data;
    const hasActive = activeIssue !== null;

    // Normalize active issue data if it exists
    const normalizedActiveIssue = activeIssue ? normalizeOutput(activeIssue) : null;

    const responseBody: {
      hasActive: boolean;
      activeIssue: { id: string; publicId: string; title: string } | null;
      contextTrace?: unknown;
    } = {
      hasActive,
      activeIssue: hasActive && normalizedActiveIssue
        ? {
            id: (normalizedActiveIssue as Record<string, unknown>).id as string,
            publicId: toPublicIdFromUuid((normalizedActiveIssue as Record<string, unknown>).id as string) ?? 
                      ((normalizedActiveIssue as Record<string, unknown>).id as string).substring(0, 8),
            title: (normalizedActiveIssue as Record<string, unknown>).title as string,
          }
        : null,
    };

    if (isDebugApiEnabled()) {
      responseBody.contextTrace = await buildContextTrace(request);
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[API /api/issues/active-check] Error checking active issue:', error);
    return NextResponse.json(
      {
        error: 'Failed to check active issue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
