/**
 * API Route: Execute Workflow
 * 
 * POST /api/workflow/execute
 * 
 * Executes a workflow definition with the provided context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowEngine } from '../../../../src/lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from '../../../../src/lib/types/workflow';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workflow, context } = body;

    if (!workflow || !workflow.steps) {
      return NextResponse.json(
        { error: 'Invalid workflow: must include steps array' },
        { status: 400 }
      );
    }

    if (!context) {
      return NextResponse.json(
        { error: 'Invalid context: must provide execution context' },
        { status: 400 }
      );
    }

    console.log('[API] Executing workflow', {
      stepsCount: workflow.steps.length,
      hasInput: !!context.input,
      hasRepo: !!context.repo,
    });

    const engine = getWorkflowEngine();
    const result = await engine.execute(
      workflow as WorkflowDefinition,
      context as WorkflowContext
    );

    console.log('[API] Workflow execution completed', {
      executionId: result.executionId,
      status: result.status,
      durationMs: result.metadata.durationMs,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API] Error executing workflow:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to execute workflow',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
