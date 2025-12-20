/**
 * API Route: List Paused Workflow Executions
 * 
 * Issue B4: HOLD workflow enforcement
 * GET /api/executions/paused
 * 
 * Returns all workflow executions that are currently paused
 * and waiting for human intervention.
 */

import { NextResponse } from 'next/server';
import { getPausedExecutions } from '@/lib/workflow-persistence';
import { checkDatabase } from '@/lib/db';

export async function GET() {
  try {
    // Check database availability
    const dbAvailable = await checkDatabase();
    if (!dbAvailable) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 503 }
      );
    }

    // Get all paused executions
    const pausedExecutions = await getPausedExecutions();

    return NextResponse.json({
      success: true,
      count: pausedExecutions.length,
      executions: pausedExecutions.map(exec => ({
        id: exec.id,
        workflowId: exec.workflow_id,
        status: exec.status,
        startedAt: exec.started_at,
        pauseMetadata: exec.pause_metadata,
        context: exec.context,
        input: exec.input,
      })),
    });
  } catch (error) {
    console.error('[API] Failed to get paused executions:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get paused executions' },
      { status: 500 }
    );
  }
}
