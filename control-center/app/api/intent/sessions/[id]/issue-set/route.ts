/**
 * API Route: /api/intent/sessions/[id]/issue-set
 * 
 * Get and manage issue sets for INTENT sessions
 * Issue E81.4: Briefing → Issue Set Generator (batch from a briefing doc)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueSet } from '@/lib/db/intentIssueSets';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { exportIssueSetToAFU9Markdown, generateIssueSetSummary } from '@/lib/utils/issueSetExporter';

/**
 * GET /api/intent/sessions/[id]/issue-set
 * Get the latest issue set for a session
 * 
 * Query params:
 * - format: 'json' (default) | 'markdown' - response format
 * - includeInvalid: 'true' | 'false' (default) - include invalid items in markdown export
 * 
 * Returns 404 if no issue set exists yet
 * Returns 401 if user not authenticated
 * Returns 403 if session doesn't belong to user
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware (401-first)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params (Next.js 13.4+)
    const { id: sessionId } = await context.params;
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }

    // Parse query params
    const url = new URL(request.url);
    const format = url.searchParams.get('format') || 'json';
    const includeInvalid = url.searchParams.get('includeInvalid') === 'true';
    
    const result = await getIssueSet(pool, sessionId, userId);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      return errorResponse('Failed to get issue set', {
        status: 500,
        requestId,
        details: 'DATABASE_ERROR',
      });
    }
    
    if (!result.data) {
      return errorResponse('No issue set exists for this session', {
        status: 404,
        requestId,
      });
    }

    const items = result.items || [];
    const summary = generateIssueSetSummary(items);

    // Handle markdown export format
    if (format === 'markdown') {
      const markdown = exportIssueSetToAFU9Markdown(items, {
        includeInvalid,
        onlyValid: !includeInvalid,
      });

      return new NextResponse(markdown, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown',
          'X-Request-ID': requestId,
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="issue-set-${sessionId}.md"`,
        },
      });
    }
    
    // Default JSON format
    return jsonResponse({
      issueSet: result.data,
      items,
      summary,
    }, { 
      requestId,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/issue-set] Error getting issue set:', error);
    return errorResponse('Failed to get issue set', {
      status: 500,
      requestId,
      details: 'INTERNAL_ERROR',
    });
  }
}
