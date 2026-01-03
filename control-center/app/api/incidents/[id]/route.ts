/**
 * API Route: Get Incident Details
 * 
 * GET /api/incidents/[id]
 * 
 * Retrieves detailed information about a specific incident including:
 * - Incident metadata
 * - Evidence items
 * - Events timeline
 * - Links to timeline nodes
 * 
 * Authentication: Required (x-afu9-sub header)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { getIncidentDAO } from '../../../../src/lib/db/incidents';
import { getRequestId, errorResponse, jsonResponse } from '../../../../src/lib/api/response-helpers';

export async function GET(
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

    console.log('[API] Getting incident details:', id, 'userId:', userId);

    const pool = getPool();
    const dao = getIncidentDAO(pool);

    // Fetch incident
    const incident = await dao.getIncident(id);

    if (!incident) {
      return errorResponse('Incident not found', {
        status: 404,
        requestId,
      });
    }

    // Fetch evidence
    const evidence = await dao.getEvidence(id);

    // Fetch events
    const events = await dao.getEvents(id);

    // Fetch links to timeline nodes
    const links = await dao.getLinks(id);

    // For each link, fetch the timeline node info
    const timelineNodes = [];
    for (const link of links) {
      try {
        // Query timeline_nodes table for basic info
        const nodeResult = await pool.query(
          `SELECT id, node_type, node_id, created_at, payload
           FROM timeline_nodes
           WHERE id = $1`,
          [link.timeline_node_id]
        );

        if (nodeResult.rows.length > 0) {
          const node = nodeResult.rows[0];
          timelineNodes.push({
            link_id: link.id,
            link_type: link.link_type,
            timeline_node_id: link.timeline_node_id,
            node_type: node.node_type,
            node_id: node.node_id,
            created_at: node.created_at.toISOString(),
            payload: node.payload || {},
          });
        }
      } catch (err) {
        console.error('[API] Error fetching timeline node:', link.timeline_node_id, err);
      }
    }

    return jsonResponse({
      success: true,
      incident,
      evidence,
      events,
      links: timelineNodes,
    }, { requestId });
  } catch (error) {
    console.error('[API] Error getting incident details:', error);
    return errorResponse('Internal server error', {
      status: 500,
      requestId,
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
