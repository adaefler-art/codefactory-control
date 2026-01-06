/**
 * API Route: /api/intent/sessions/[id]/cr/validate
 * 
 * Validate a CR draft and store validation status
 * Issue E74.3: CR Preview/Edit UI + Validation Gate
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { validateAndSaveCrDraft } from '@/lib/db/intentCrDrafts';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

/**
 * POST /api/intent/sessions/[id]/cr/validate
 * Validate CR JSON and save with status
 */
export async function POST(
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
    const { id: sessionId } = await context.params;
    
    if (!sessionId) {
      return errorResponse('Session ID required', {
        status: 400,
        requestId,
      });
    }
    
    // Parse request body
    let body: { crJson: unknown };
    try {
      body = await request.json();
    } catch (parseError) {
      // Return detailed parse error in standard format
      return jsonResponse(
        {
          draft: null,
          validation: {
            ok: false,
            errors: [
              {
                code: 'CR_SCHEMA_INVALID',
                message: `Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Parse error'}`,
                path: '/',
                severity: 'error',
                details: {
                  parseError: parseError instanceof Error ? parseError.message : String(parseError),
                },
              },
            ],
            warnings: [],
            meta: {
              validatedAt: new Date().toISOString(),
              validatorVersion: '0.7.0',
            },
          },
        },
        { requestId }
      );
    }
    
    if (!body.crJson) {
      return errorResponse('crJson field is required', {
        status: 400,
        requestId,
      });
    }
    
    const result = await validateAndSaveCrDraft(pool, sessionId, userId, body.crJson);
    
    if (!result.success) {
      if (result.error === 'Session not found or access denied') {
        return errorResponse('Session not found', {
          status: 404,
          requestId,
        });
      }
      
      // If validation failed but we have validation results, return them
      if (result.validation) {
        return jsonResponse(
          {
            draft: null,
            validation: result.validation,
          },
          { requestId }
        );
      }
      
      return errorResponse('Failed to validate CR draft', {
        status: 500,
        requestId,
        details: result.error,
      });
    }
    
    return jsonResponse(
      {
        draft: result.data,
        validation: result.validation,
      },
      { requestId }
    );
  } catch (error) {
    console.error('[API /api/intent/sessions/[id]/cr/validate] Error validating CR draft:', error);
    return errorResponse('Failed to validate CR draft', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
