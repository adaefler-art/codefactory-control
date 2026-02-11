/**
 * API Route: /api/clinical/intake/[id]/synthesize
 * 
 * Trigger clinical intake synthesis from conversation messages
 * Issue #10: Clinical Intake Synthesis (CRE-konform)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { 
  getClinicalIntakeById,
  updateClinicalIntake,
  createClinicalIntake 
} from '@/lib/db/clinicalIntakes';
import { getIntentSession } from '@/lib/db/intentSessions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import { validateClinicalIntakeWithRules } from '@/lib/validators/clinicalIntakeValidator';
import { 
  synthesizeClinicalIntake,
  type SynthesisTrigger 
} from '@/lib/services/clinicalIntakeSynthesisService';

/**
 * POST /api/clinical/intake/[id]/synthesize
 * Synthesize or update clinical intake from conversation messages
 * 
 * Body:
 * - session_id: string (required)
 * - trigger: SynthesisTrigger (optional, defaults to manual)
 * - create_new: boolean (optional, if true creates new intake instead of updating)
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);
  
  try {
    const pool = getPool();
    
    // Get authenticated user ID
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }
    
    // Await params
    const { id } = await context.params;
    
    // Parse request body
    const body = await request.json();
    const { session_id, trigger, create_new = false } = body;
    
    if (!session_id) {
      return errorResponse('session_id is required', {
        status: 400,
        requestId,
      });
    }
    
    // Get session with messages
    const sessionResult = await getIntentSession(pool, session_id, userId);
    
    if (!sessionResult.success) {
      return errorResponse('Failed to get session', {
        status: 404,
        requestId,
        details: sessionResult.error,
      });
    }
    
    const session = sessionResult.data;
    
    if (!session.messages || session.messages.length === 0) {
      return errorResponse('Session has no messages to synthesize', {
        status: 400,
        requestId,
      });
    }
    
    // Get current intake if updating
    let currentIntake;
    if (!create_new && id !== 'new') {
      const intakeResult = await getClinicalIntakeById(pool, id);
      if (intakeResult.success) {
        currentIntake = intakeResult.data;
      }
    }
    
    // Default trigger if not provided
    const synthesisTrigger: SynthesisTrigger = trigger || {
      type: 'manual',
      messageIds: session.messages.map((m: any) => m.id || 'unknown'),
      reason: 'Manual synthesis triggered by user',
    };
    
    // Synthesize intake
    const synthesisResult = await synthesizeClinicalIntake(
      session.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
      synthesisTrigger,
      session_id,
      currentIntake
    );
    
    if (!synthesisResult.success) {
      return errorResponse('Failed to synthesize clinical intake', {
        status: 500,
        requestId,
        details: synthesisResult.error,
      });
    }
    
    // Validate synthesized intake
    const validationResult = validateClinicalIntakeWithRules({
      session_id,
      structured_intake: synthesisResult.structuredIntake!,
      clinical_summary: synthesisResult.clinicalSummary!,
    });
    
    if (!validationResult.isValid) {
      return errorResponse('Synthesized intake failed validation', {
        status: 422,
        requestId,
        details: {
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          synthesis: synthesisResult,
        },
      });
    }
    
    // Create or update intake
    let finalResult;
    
    if (create_new || id === 'new' || !currentIntake) {
      // Create new intake
      finalResult = await createClinicalIntake(
        pool,
        {
          session_id,
          structured_intake: synthesisResult.structuredIntake!,
          clinical_summary: synthesisResult.clinicalSummary!,
          version: 1,
        },
        userId
      );
    } else {
      // Update existing intake
      finalResult = await updateClinicalIntake(
        pool,
        id,
        {
          structured_intake: synthesisResult.structuredIntake!,
          clinical_summary: synthesisResult.clinicalSummary!,
        },
        userId
      );
    }
    
    if (!finalResult.success) {
      return errorResponse('Failed to save clinical intake', {
        status: 500,
        requestId,
        details: finalResult.error,
      });
    }
    
    return jsonResponse({
      intake: finalResult.data,
      synthesis_metadata: synthesisResult.metadata,
      validation: {
        isValid: validationResult.isValid,
        warnings: validationResult.warnings,
      },
    }, { 
      status: create_new || id === 'new' ? 201 : 200,
      requestId,
    });
    
  } catch (error) {
    console.error('[API /api/clinical/intake/[id]/synthesize] Error:', error);
    return errorResponse('Failed to synthesize clinical intake', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
