/**
 * API Route: GET /api/intent/sessions/[id]/sources
 * 
 * Get all used_sources for an INTENT session
 * Issue E89.5: INTENT "Sources" Integration
 * 
 * Returns aggregated sources from all assistant messages in the session,
 * ordered by created_at (deterministic).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import type { UsedSources, SourceRef } from '@/lib/schemas/usedSources';
import { deduplicateSources } from '@/lib/intent/tool-sources-tracker';

/**
 * GET /api/intent/sessions/[id]/sources
 * 
 * Returns all sources used in the session's assistant messages.
 * Auth-first: Only returns sources for sessions owned by authenticated user.
 * 
 * Query params:
 * - type: Filter by source type (optional)
 * 
 * Response:
 * {
 *   sources: SourceRef[],
 *   count: number,
 *   sessionId: string
 * }
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID from middleware
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params (Next.js 13.4+)
    const { id: rawId } = await context.params;
    const sessionId = typeof rawId === 'string' ? rawId.trim() : '';
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
        details: 'Invalid session ID',
      });
    }
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type') || undefined;
    
    // Verify session ownership
    const sessionCheck = await pool.query(
      `SELECT id FROM intent_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
    
    if (sessionCheck.rows.length === 0) {
      return errorResponse('Session not found', {
        status: 403,
        requestId,
        details: 'Session not found or access denied',
      });
    }
    
    // Fetch all assistant messages with sources, ordered by created_at (deterministic)
    const messagesResult = await pool.query(
      `SELECT id, used_sources_json, used_sources_hash, created_at
       FROM intent_messages
       WHERE session_id = $1 
         AND role = 'assistant'
         AND used_sources_json IS NOT NULL
       ORDER BY created_at ASC, id ASC`,
      [sessionId]
    );
    
    // Aggregate all sources from messages
    const allSources: SourceRef[] = [];
    
    for (const row of messagesResult.rows) {
      const sources = row.used_sources_json as UsedSources;
      if (sources && Array.isArray(sources)) {
        allSources.push(...sources);
      }
    }
    
    // Fetch all uploads for session and convert to SourceRef
    const uploadsResult = await pool.query(
      `SELECT id, filename, content_type, size_bytes, content_sha256, created_at
       FROM intent_session_uploads
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );
    
    for (const row of uploadsResult.rows) {
      allSources.push({
        kind: 'upload',
        uploadId: row.id,
        filename: row.filename,
        contentType: row.content_type,
        sizeBytes: row.size_bytes,
        contentSha256: row.content_sha256,
        uploadedAt: row.created_at,
      });
    }
    
    // Apply type filter if specified
    let filteredSources = allSources;
    if (typeFilter) {
      filteredSources = allSources.filter(source => source.kind === typeFilter);
    }
    
    // Deduplicate sources using shared helper
    const uniqueSources = deduplicateSources(filteredSources);
    
    return jsonResponse({
      sources: uniqueSources,
      count: uniqueSources.length,
      sessionId,
      typeFilter: typeFilter || null,
    }, { status: 200, requestId });
    
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/sources] Error fetching sources:', error);
    return errorResponse('Failed to fetch sources', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
