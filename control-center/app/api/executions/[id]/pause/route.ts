/**
 * API Route: Pause Workflow Execution
 * 
 * Issue B4: HOLD workflow enforcement
 * POST /api/executions/[id]/pause
 * 
 * Pauses a running workflow execution. The workflow will not continue
 * automatically - human intervention is required to resume.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pauseExecution, getExecution } from '@/lib/workflow-persistence';
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
    
    const { pausedBy, reason } = body;
    
    if (!pausedBy) {
      return NextResponse.json(
        { error: 'pausedBy is required' },
        { status: 400 }
      );
    }

    // Check if execution exists and is running
    const execution = await getExecution(executionId);
    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    if (execution.status !== 'running') {
      return NextResponse.json(
        { error: `Cannot pause execution in status: ${execution.status}` },
        { status: 400 }
      );
    }

    // Pause the execution
    await pauseExecution(
      executionId,
      pausedBy,
      reason || 'Manually paused',
      undefined
    );

    return NextResponse.json({
      success: true,
      executionId,
      status: 'paused',
      pausedBy,
      pausedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[API] Failed to pause execution:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to pause execution' },
      { status: 500 }
    );
  }
}
