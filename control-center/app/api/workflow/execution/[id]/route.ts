/**
 * API Route: Get Workflow Execution Status
 * 
 * GET /api/workflow/execution/[id]
 * 
 * Retrieves the status and details of a workflow execution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getExecution, getExecutionSteps } from '../../../../../src/lib/workflow-persistence';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Execution ID is required' },
        { status: 400 }
      );
    }

    console.log('[API] Getting execution status:', id);

    // Get execution from database
    const execution = await getExecution(id);

    if (!execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Get steps for this execution
    const steps = await getExecutionSteps(id);

    const result = {
      execution: {
        id: execution.id,
        workflowId: execution.workflow_id,
        status: execution.status,
        input: execution.input,
        output: execution.output,
        context: execution.context,
        startedAt: execution.started_at,
        completedAt: execution.completed_at,
        error: execution.error,
        triggeredBy: execution.triggered_by,
        githubRunId: execution.github_run_id,
      },
      steps: steps.map((step) => ({
        id: step.id,
        name: step.step_name,
        index: step.step_index,
        status: step.status,
        input: step.input,
        output: step.output,
        startedAt: step.started_at,
        completedAt: step.completed_at,
        durationMs: step.duration_ms,
        error: step.error,
        retryCount: step.retry_count,
      })),
      metadata: {
        totalSteps: steps.length,
        completedSteps: steps.filter((s) => s.status === 'completed').length,
        failedSteps: steps.filter((s) => s.status === 'failed').length,
        skippedSteps: steps.filter((s) => s.status === 'skipped').length,
      },
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error getting execution:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to get execution',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
