/**
 * API Route: Classify Incident
 * 
 * POST /api/incidents/[id]/classify
 * 
 * Classifies an incident using the rule-based classifier v1.
 * Updates the incident classification in the database and emits a CLASSIFIED event.
 * Supports reclassification if evidence changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getIncidentDAO } from '../../../../../src/lib/db/incidents';
import { classifyIncident } from '../../../../../src/lib/classifier';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Incident ID is required' },
        { status: 400 }
      );
    }

    console.log('[API] Classifying incident:', id);

    const pool = getPool();
    const dao = getIncidentDAO(pool);

    // Get incident
    const incident = await dao.getIncident(id);

    if (!incident) {
      return NextResponse.json(
        { error: 'Incident not found' },
        { status: 404 }
      );
    }

    // Get evidence
    const evidence = await dao.getEvidence(id);

    // Classify incident
    const classification = classifyIncident(incident, evidence);

    // Update incident with classification
    const updatedIncident = await dao.updateClassification(id, classification);

    if (!updatedIncident) {
      return NextResponse.json(
        { error: 'Failed to update incident classification' },
        { status: 500 }
      );
    }

    // Emit CLASSIFIED event
    await dao.createEvent({
      incident_id: id,
      event_type: 'CLASSIFIED',
      payload: {
        classifierVersion: classification.classifierVersion,
        category: classification.category,
        confidence: classification.confidence,
      },
    });

    console.log('[API] Incident classified:', {
      id,
      category: classification.category,
      confidence: classification.confidence,
    });

    return NextResponse.json({
      success: true,
      incident: updatedIncident,
      classification,
    });
  } catch (error) {
    console.error('[API] Error classifying incident:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
