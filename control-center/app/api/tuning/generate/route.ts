/**
 * API Route: Generate Tuning Suggestions
 * 
 * POST /api/tuning/generate
 * 
 * Generates tuning suggestions for a specified time window.
 * Idempotent: same inputs → same suggestions.
 * 
 * Request body:
 * - window: Aggregation window (daily, weekly, release, custom)
 * - windowStart: Start timestamp (ISO 8601)
 * - windowEnd: End timestamp (ISO 8601)
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { generateTuningSuggestions } from '@/lib/tuning-suggestions-service';
import { getRequestId, errorResponse, jsonResponse } from '@/lib/api/response-helpers';
import { z } from 'zod';

const GenerateSuggestionsRequestSchema = z.object({
  window: z.enum(['daily', 'weekly', 'release', 'custom']),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    // Authentication: fail-closed, require x-afu9-sub
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = GenerateSuggestionsRequestSchema.safeParse(body);
    
    if (!validation.success) {
      return errorResponse('Invalid request', {
        status: 400,
        requestId,
        details: validation.error.message,
      });
    }

    const { window, windowStart, windowEnd } = validation.data;

    // Validate window times
    const start = new Date(windowStart);
    const end = new Date(windowEnd);

    if (start >= end) {
      return errorResponse('Invalid time window', {
        status: 400,
        requestId,
        details: 'windowStart must be before windowEnd',
      });
    }

    console.log('[API] Generating tuning suggestions:', {
      window,
      windowStart,
      windowEnd,
      userId,
    });

    const pool = getPool();

    // Generate suggestions (idempotent)
    const result = await generateTuningSuggestions(pool, {
      window,
      windowStart: start,
      windowEnd: end,
    });

    return jsonResponse({
      success: true,
      suggestions: result.suggestions,
      count: result.suggestions.length,
      isNew: result.isNew,
      metadata: result.metadata,
    }, { 
      requestId,
      status: result.isNew ? 201 : 200,
    });
  } catch (error) {
    console.error('[API] Error generating tuning suggestions:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: errorMessage,
    });
  }
}
