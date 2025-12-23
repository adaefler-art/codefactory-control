/**
 * API Route: GET /api/executions/[id]
 * 
 * Returns details of a specific execution including all steps
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WorkflowExecutionOutput, WorkflowStepOutput, isWorkflowExecutionOutput } from '@/lib/contracts/outputContracts';
import { normalizeOutput } from '@/lib/api/normalize-output';

function debugApiEnabled(): boolean {
  const raw = (process.env.AFU9_DEBUG_API || '').toLowerCase();
  return raw === '1' || raw === 'true';
}

function logContractTypeEvidence(params: {
  route: string;
  requestId: string | null;
  candidate: Record<string, unknown>;
}) {
  if (!debugApiEnabled()) return;

  const pick = (key: string) => {
    const value = (params.candidate as any)?.[key];
    return {
      type: typeof value,
      isDate: value instanceof Date,
      isString: typeof value === 'string',
      isNull: value === null,
    };
  };

  console.log(
    JSON.stringify({
      level: 'debug',
      route: params.route,
      requestId: params.requestId,
      evidence: {
        started_at: pick('started_at'),
        completed_at: pick('completed_at'),
        created_at: pick('created_at'),
        updated_at: pick('updated_at'),
      },
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Extended execution response includes joined workflow info
 */
interface ExecutionWithWorkflowInfo extends WorkflowExecutionOutput {
  workflow_name?: string;
  workflow_description?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const requestId = request.headers.get('x-request-id');
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
        we.created_at,
        we.updated_at,
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
        execution_id,
        step_name,
        step_index,
        status,
        input,
        output,
        started_at,
        completed_at,
        duration_ms,
        error,
        retry_count,
        created_at,
        updated_at
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
    
    const executionRow = normalizeOutput(executionResult.rows[0]) as Record<string, unknown>;
    // Extract joined fields that are not part of the base execution contract
    const { workflow_name, workflow_description, ...executionData } = executionRow as any;
    
    // Validate execution output contract
    if (!isWorkflowExecutionOutput(executionData)) {
      console.error('[API /api/executions/[id]] Contract validation failed for execution', {
        id: (executionData as any)?.id,
        workflow_id: (executionData as any)?.workflow_id,
        status: (executionData as any)?.status,
      });
      logContractTypeEvidence({ route: '/api/executions/[id]', requestId, candidate: executionData });
      throw new Error('Execution output contract validation failed');
    }
    
    // Build response with contract-validated execution + joined fields
    const execution: ExecutionWithWorkflowInfo = {
      ...executionData,
      workflow_name,
      workflow_description,
    };
    
    const steps = normalizeOutput(stepsResult.rows) as WorkflowStepOutput[];
    
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
