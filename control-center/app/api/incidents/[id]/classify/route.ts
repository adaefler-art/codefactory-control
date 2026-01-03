/**
 * API Route: Classify Incident
 * 
 * POST /api/incidents/[id]/classify
 * 
 * Classifies an incident using the rule-based classifier v1.
 * Updates the incident classification in the database and emits a CLASSIFIED event.
 * Supports reclassification if evidence changes.
 * 
 * Authentication: Required (x-afu9-sub header)
 * Authorization: System/admin-scoped (incidents are system-wide resources)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getIncidentDAO } from '../../../../../src/lib/db/incidents';
import { classifyIncident, computeClassificationHash } from '../../../../../src/lib/classifier';
import { getRequestId, errorResponse, jsonResponse } from '../../../../../src/lib/api/response-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request);

  try {
    // Authentication: fail-closed, require x-afu9-sub
    const userId = request.headers.get('x-afu9-sub');
    if (!userId) {
      return errorResponse('Unauthorized', {
        status: 401,
        requestId,
        details: 'User authentication required',
      });
    }

    const { id } = await params;

    if (!id) {
      return errorResponse('Incident ID is required', {
        status: 400,
        requestId,
      });
    }

    console.log('[API] Classifying incident:', id, 'userId:', userId);

    const pool = getPool();
    const dao = getIncidentDAO(pool);

    // Get incident
    const incident = await dao.getIncident(id);

    if (!incident) {
      return errorResponse('Incident not found', {
        status: 404,
        requestId,
      });
    }

    // Get evidence
    const evidence = await dao.getEvidence(id);

    // Classify incident
    const classification = classifyIncident(incident, evidence);

    // Compute classification hash for idempotency
    const classificationHash = computeClassificationHash(classification);

    // Update incident with classification (idempotent)
    const result = await dao.updateClassification(id, classification, classificationHash);

    if (!result.incident) {
      return errorResponse('Failed to update incident classification', {
        status: 500,
        requestId,
      });
    }

    // Emit CLASSIFIED event only if classification actually changed
    if (result.updated) {
      await dao.createEvent({
        incident_id: id,
        event_type: 'CLASSIFIED',
        payload: {
          classifierVersion: classification.classifierVersion,
          category: classification.category,
          confidence: classification.confidence,
          classificationHash,
        },
      });

      console.log('[API] Incident classified (updated):', {
        id,
        category: classification.category,
        confidence: classification.confidence,
        hash: classificationHash,
      });
    } else {
      console.log('[API] Incident classification unchanged (idempotent):', {
        id,
        hash: classificationHash,
      });
    }

    return jsonResponse({
      success: true,
      incident: result.incident,
      classification,
      updated: result.updated,
    }, { requestId });
  } catch (error) {
    console.error('[API] Error classifying incident:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
