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
import { resumeExecution, getExecution } from '@/lib/workflow-persistence';
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

    // Check if execution exists and is paused
    const execution = await getExecution(executionId);
    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    if (execution.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot resume execution in status: ${execution.status}. Only paused executions can be resumed.` },
        { status: 400 }
      );
    }

    // Resume the execution
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resume execution' },
      { status: 500 }
    );
  }
}
