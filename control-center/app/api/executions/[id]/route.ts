/**
 * API Route: GET /api/executions/[id]
 * 
 * Returns details of a specific execution including all steps
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = getPool();
    
    // Get execution details
    const executionQuery = `
      SELECT 
        we.id,
        we.workflow_id,
        we.status,
        we.input,
        we.output,
        we.context,
        we.started_at,
        we.completed_at,
        we.error,
        we.triggered_by,
        we.github_run_id,
        w.name as workflow_name,
        w.description as workflow_description
      FROM workflow_executions we
      LEFT JOIN workflows w ON w.id = we.workflow_id
      WHERE we.id = $1
    `;
    
    // Get execution steps
    const stepsQuery = `
      SELECT 
        id,
        step_name,
        step_index,
        status,
        input,
        output,
        started_at,
        completed_at,
        duration_ms,
        error,
        retry_count
      FROM workflow_steps
      WHERE execution_id = $1
      ORDER BY step_index ASC
    `;
    
    const [executionResult, stepsResult] = await Promise.all([
      pool.query(executionQuery, [id]),
      pool.query(stepsQuery, [id])
    ]);
    
    if (executionResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }
    
    const execution = executionResult.rows[0];
    const steps = stepsResult.rows;
    
    return NextResponse.json({
      ...execution,
      steps
    });
  } catch (error) {
    console.error('[API /api/executions/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch execution details' },
      { status: 500 }
    );
  }
}
