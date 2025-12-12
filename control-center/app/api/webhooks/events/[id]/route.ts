/**
 * Webhook Event Detail API Route
 * 
 * GET /api/webhooks/events/[id]
 * 
 * Retrieve a specific webhook event by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../../src/lib/db';
import { getWebhookEvent } from '../../../../../src/lib/webhooks';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const pool = getPool();
    const event = await getWebhookEvent(pool, id);

    if (!event) {
      return NextResponse.json(
        { error: 'Webhook event not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(event);
  } catch (error) {
    console.error('[Webhook Event API] Error:', error);

    return NextResponse.json(
      {
        error: 'Failed to retrieve webhook event',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
