/**
 * API Route: Export Remediation Run Bundle
 * 
 * GET /api/remediation/runs/[id]/export
 * 
 * Exports a complete bundle for a remediation run including:
 * - Run details
 * - All steps
 * - All audit events
 * - Incident reference
 * 
 * E77.5 / I775: Full Audit Trail for Remediation
 */

import { NextRequest } from 'next/server';
import { getPool } from '../../../../../../src/lib/db';
import { getRemediationPlaybookDAO } from '../../../../../../src/lib/db/remediation-playbooks';
import { getIncidentDAO } from '../../../../../../src/lib/db/incidents';
import { jsonResponse, errorResponse, getRequestId } from '../../../../../../src/lib/api/response-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const requestId = getRequestId(request);
  const runId = params.id;

  try {
    const pool = getPool();
    const remediationDAO = getRemediationPlaybookDAO(pool);
    const incidentDAO = getIncidentDAO(pool);

    // Get complete audit bundle
    const bundle = await remediationDAO.getAuditBundle(runId);

    if (!bundle.run) {
      return errorResponse('Remediation run not found', {
        status: 404,
        requestId,
      });
    }

    // Get incident reference
    const incident = await incidentDAO.getIncident(bundle.run.incident_id);

    // Build export bundle
    const exportBundle = {
      exportedAt: new Date().toISOString(),
      run: bundle.run,
      steps: bundle.steps,
      auditEvents: bundle.auditEvents,
      incidentRef: incident ? {
        id: incident.id,
        incident_key: incident.incident_key,
        severity: incident.severity,
        status: incident.status,
        title: incident.title,
      } : null,
    };

    return jsonResponse(exportBundle, {
      status: 200,
      requestId,
      headers: {
        'Content-Disposition': `attachment; filename="remediation-run-${runId}-export.json"`,
      },
    });
  } catch (error: any) {
    console.error('[remediation-export] Error exporting run:', {
      runId,
      error: error.message,
      requestId,
    });

    return errorResponse('Failed to export remediation run', {
      status: 500,
      requestId,
      details: error.message,
    });
  }
}
