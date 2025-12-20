/**
 * API Route: Resume Workflow Execution
 * 
 * Issue B4: HOLD workflow enforcement
 * POST /api/executions/[id]/resume
 * 
 * Resumes a paused workflow execution with explicit human approval.
 * This is the only way to continue a workflow that was paused due to HOLD state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resumeExecution } from '@/lib/workflow-persistence';
import { checkDatabase } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check database availability
    const dbAvailable = await checkDatabase();
    if (!dbAvailable) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    const executionId = params.id;
    const body = await request.json();
    
    const { resumedBy } = body;
    
    if (!resumedBy) {
      return NextResponse.json(
        { error: 'resumedBy is required (user who approved resume)' },
        { status: 400 }
      );
    }

    // Resume the execution (validates status internally)
    await resumeExecution(executionId, resumedBy);

    return NextResponse.json({
      success: true,
      executionId,
      status: 'running',
      resumedBy,
      resumedAt: new Date().toISOString(),
      note: 'Execution has been resumed. The workflow engine should pick it up for continued execution.',
    });
  } catch (error) {
    console.error('[API] Failed to resume execution:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to resume execution';
    const statusCode = errorMessage.includes('not found') || errorMessage.includes('not in') ? 400 : 500;
    
    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}
