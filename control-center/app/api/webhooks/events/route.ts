/**
 * Webhook Events API Route
 * 
 * GET /api/webhooks/events
 * 
 * List and retrieve webhook events for monitoring and debugging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import { listWebhookEvents, getWebhookStats } from '../../../../src/lib/webhooks';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const statsOnly = searchParams.get('stats') === 'true';

    const pool = getPool();

    if (statsOnly) {
      // Return statistics only
      const stats = await getWebhookStats(pool);
      return NextResponse.json(stats);
    }

    // Return list of events
    const events = await listWebhookEvents(pool, limit, offset);

    // Get total count
    const countQuery = 'SELECT COUNT(*) as total FROM webhook_events';
    const countResult = await pool.query(countQuery);
    const total = parseInt(countResult.rows[0].total);

    return NextResponse.json({
      events,
      pagination: {
        limit,
        offset,
        total,
        hasMore: offset + events.length < total,
      },
    });
  } catch (error) {
    console.error('[Webhook Events API] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve webhook events',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
