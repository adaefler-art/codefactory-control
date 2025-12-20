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
import { pauseExecution } from '@/lib/workflow-persistence';
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

    // Pause the execution (validates status internally)
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
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to pause execution';
    const statusCode = errorMessage.includes('not found') || errorMessage.includes('not in') ? 400 : 500;
    
    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}
