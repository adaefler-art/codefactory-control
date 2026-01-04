/**
 * API Route: Get Remediation Run Audit Trail
 * 
 * GET /api/remediation/runs/[id]/audit
 * 
 * Retrieves the complete audit trail for a remediation run.
 * Events are returned in deterministic order (created_at ASC, id ASC).
 * 
 * E77.5 / I775: Full Audit Trail for Remediation
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../../src/lib/db';
import { getRemediationPlaybookDAO } from '../../../../../../src/lib/db/remediation-playbooks';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../src/lib/api/response-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  const runId = params.id;

  try {
    const pool = getPool();
    const dao = getRemediationPlaybookDAO(pool);

    // Validate run exists
    const run = await dao.getRun(runId);
    if (!run) {
      return errorResponse('Remediation run not found', {
        status: 404,
        requestId,
      });
    }

    // Get audit events (deterministic ordering)
    const auditEvents = await dao.getAuditEventsForRun(runId);

    return jsonResponse({
      runId: run.id,
      incidentId: run.incident_id,
      playbookId: run.playbook_id,
      status: run.status,
      auditEvents,
    }, {
      status: 200,
      requestId,
    });
  } catch (error: any) {
    console.error('[remediation-audit] Error fetching audit trail:', {
      runId,
      error: error.message,
      requestId,
    });

    return errorResponse('Failed to fetch audit trail', {
      status: 500,
      requestId,
      details: error.message,
    });
  }
}
