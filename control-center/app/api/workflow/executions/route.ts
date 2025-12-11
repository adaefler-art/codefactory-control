/**
 * API Route: List Workflow Executions
 * 
 * GET /api/workflow/executions
 * 
 * Lists recent workflow executions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRecentExecutions } from '../../../../src/lib/workflow-persistence';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    console.log('[API] Listing executions, limit:', limit);

    // Get recent executions from database
    const executions = await getRecentExecutions(limit);

    const result = executions.map((execution) => ({
      id: execution.id,
      workflowId: execution.workflow_id,
      status: execution.status,
      startedAt: execution.started_at,
      completedAt: execution.completed_at,
      error: execution.error,
      triggeredBy: execution.triggered_by,
      githubRunId: execution.github_run_id,
    }));

    return NextResponse.json({ executions: result, total: result.length });
  } catch (error) {
    console.error('[API] Error listing executions:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to list executions',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
