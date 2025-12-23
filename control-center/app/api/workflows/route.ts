/**
 * API Route: GET /api/workflows
 * 
 * Returns a list of all available workflows
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { WorkflowOutput, isWorkflowOutput } from '@/lib/contracts/outputContracts';
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
        created_at: pick('created_at'),
        updated_at: pick('updated_at'),
        version: pick('version'),
        enabled: pick('enabled'),
      },
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Extended workflow response includes last run info (not part of base contract)
 */
interface WorkflowWithLastRun extends WorkflowOutput {
  last_run?: {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    triggered_by: string | null;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    const requestId = request.headers.get('x-request-id');
    const pool = getPool();
    
    // Get all workflows with their latest execution info
    const query = `
      SELECT 
        w.id,
        w.name,
        w.description,
        w.definition,
        w.version,
        w.enabled,
        w.created_at,
        w.updated_at,
        (
          SELECT json_build_object(
            'id', we.id,
            'status', we.status,
            'started_at', we.started_at,
            'completed_at', we.completed_at,
            'triggered_by', we.triggered_by
          )
          FROM workflow_executions we
          WHERE we.workflow_id = w.id
          ORDER BY we.started_at DESC
          LIMIT 1
        ) as last_run
      FROM workflows w
      ORDER BY w.name ASC
    `;
    
    const result = await pool.query(query);
    
    // Validate each workflow row against output contract
    const workflows: WorkflowWithLastRun[] = result.rows.map((row) => {
      const normalizedRow = normalizeOutput(row) as Record<string, unknown>;
      // Extract last_run before contract validation (not part of base contract)
      const { last_run, ...workflowData } = normalizedRow as any;
      
      // Validate workflow output contract
      if (!isWorkflowOutput(workflowData)) {
        console.error('[API /api/workflows] Contract validation failed for workflow', {
          id: (workflowData as any)?.id,
          name: (workflowData as any)?.name,
        });
        logContractTypeEvidence({ route: '/api/workflows', requestId, candidate: workflowData });
        throw new Error('Workflow output contract validation failed');
      }
      
      return {
        ...workflowData,
        last_run,
      };
    });
    
    return NextResponse.json({
      workflows,
      total: workflows.length
    });
  } catch (error) {
    console.error('[API /api/workflows] Error fetching workflows:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflows' },
      { status: 500 }
    );
  }
}
