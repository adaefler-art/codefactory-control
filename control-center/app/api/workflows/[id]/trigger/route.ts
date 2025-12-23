/**
 * API Route: POST /api/workflows/[id]/trigger
 * 
 * Manually trigger a workflow execution with parameters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WorkflowEngine } from '@/lib/workflow-engine';
import { WorkflowDefinition, WorkflowContext } from '@/lib/types/workflow';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { input, triggeredBy } = body;
    
    const pool = getPool();
    
    // Get workflow definition
    const workflowQuery = `
      SELECT id, name, description, definition, enabled
      FROM workflows
      WHERE id = $1
    `;
    
    const workflowResult = await pool.query(workflowQuery, [id]);
    
    if (workflowResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }
    
    const workflow = workflowResult.rows[0];
    
    if (!workflow.enabled) {
      return NextResponse.json(
        { error: 'Workflow is disabled' },
        { status: 400 }
      );
    }
    
    // Parse workflow definition
    const definition: WorkflowDefinition = workflow.definition;
    
    // Build execution context
    const context: WorkflowContext = {
      variables: {},
      input: input || {},
      repo: input?.repo || undefined
    };
    
    // Create workflow engine and execute
    const engine = new WorkflowEngine();
    
    // Execute workflow asynchronously (don't wait for completion)
    // The workflow engine handles error logging and database persistence
    engine.execute(definition, context).catch(error => {
      console.error('[API /api/workflows/[id]/trigger] Workflow execution failed:', error);
      // Error is already persisted in the database by workflow engine
      // Users can view failed executions in the execution history
    });
    
    // Return immediately with execution started status
    return NextResponse.json({
      success: true,
      message: 'Workflow execution started',
      workflowId: id,
      workflowName: workflow.name
    });
  } catch (error) {
    console.error('[API /api/workflows/[id]/trigger] Error:', error);
    return NextResponse.json(
      { error: 'Failed to trigger workflow' },
      { status: 500 }
    );
  }
}
