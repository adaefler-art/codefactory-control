/**
 * API Route: Generate Outcome/Postmortem
 * 
 * POST /api/outcomes/generate
 * 
 * Generates an evidence-based postmortem artifact for an incident.
 * Idempotent: same inputs → same outcome record.
 * 
 * Request body:
 * - incidentId: UUID of the incident
 * - lawbookVersion: (optional) Lawbook version to use
 * 
 * Authentication: Required (x-afu9-sub header)
 * 
 * SECURITY NOTE:
 * The x-afu9-sub header is set by proxy.ts after JWT verification.
 * Client-provided x-afu9-* headers are stripped by the middleware.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getRequestId, errorResponse, jsonResponse } from '../../../../src/lib/api/response-helpers';
import { generatePostmortemForIncident } from '../../../../src/lib/generators/postmortem-generator';
import { z } from 'zod';

const GeneratePostmortemRequestSchema = z.object({
  incidentId: z.string().uuid(),
  lawbookVersion: z.string().optional(),
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
    const validation = GeneratePostmortemRequestSchema.safeParse(body);
    
    if (!validation.success) {
      return errorResponse('Invalid request', {
        status: 400,
        requestId,
        details: validation.error.message,
      });
    }

    const { incidentId, lawbookVersion } = validation.data;

    console.log('[API] Generating postmortem for incident:', incidentId, 'userId:', userId);

    const pool = getPool();

    // Generate postmortem (idempotent)
    const result = await generatePostmortemForIncident(
      pool,
      incidentId,
      lawbookVersion
    );

    return jsonResponse({
      success: true,
      outcomeRecord: result.outcomeRecord,
      postmortem: result.postmortem,
      isNew: result.isNew,
    }, { 
      requestId,
      status: result.isNew ? 201 : 200,
    });
  } catch (error) {
    console.error('[API] Error generating postmortem:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific error cases
    if (errorMessage.includes('not found')) {
      return errorResponse('Incident not found', {
        status: 404,
        requestId,
        details: errorMessage,
      });
    }

    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: errorMessage,
    });
  }
}
