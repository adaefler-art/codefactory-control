/**
 * GitHub Webhook Handler API Route
 * 
 * POST /api/webhooks/github
 * 
 * Receives and processes GitHub webhook events:
 * - Validates signature
 * - Stores event in database
 * - Maps event to workflows
 * - Optionally triggers workflow execution
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../src/lib/db';
import {
  verifyGitHubSignature,
  parseGitHubEvent,
  storeWebhookEvent,
  getWebhookConfig,
  processWebhookEvent,
} from '../../../../src/lib/webhooks';

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text();
    
    // Get headers
    const signature = request.headers.get('x-hub-signature-256');
    const eventType = request.headers.get('x-github-event');
    const deliveryId = request.headers.get('x-github-delivery');

    if (!signature || !eventType) {
      console.error('[Webhook] Missing required headers');
      return NextResponse.json(
        { error: 'Missing required headers' },
        { status: 400 }
      );
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error('[Webhook] Invalid JSON payload');
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Get webhook configuration
    const pool = getPool();
    const config = await getWebhookConfig(pool, 'github');

    if (!config) {
      console.error('[Webhook] GitHub webhook not configured or disabled');
      return NextResponse.json(
        { error: 'Webhook not configured' },
        { status: 503 }
      );
    }

    // Verify signature
    const isValid = verifyGitHubSignature(rawBody, signature, config.secret_key);
    if (!isValid) {
      console.error('[Webhook] Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    console.log('[Webhook] Received valid GitHub webhook', {
      event_type: eventType,
      action: payload.action,
      delivery_id: deliveryId,
    });

    // Parse event details
    const { event_type, event_action } = parseGitHubEvent(eventType, payload);

    // Check if event is filtered
    if (config.event_filters?.events) {
      if (!config.event_filters.events.includes(event_type)) {
        console.log('[Webhook] Event type filtered out', { event_type });
        return NextResponse.json({
          message: 'Event type filtered',
          event_type,
        });
      }
    }

    // Store event in database
    const event = await storeWebhookEvent(pool, {
      event_id: deliveryId || `${Date.now()}-${Math.random()}`,
      event_type,
      event_action,
      payload,
      signature,
      delivery_id: deliveryId || undefined,
    });

    console.log('[Webhook] Event stored', {
      event_id: event.event_id,
      event_type: event.event_type,
      event_action: event.event_action,
    });

    // Process event asynchronously (don't wait for completion)
    processWebhookEvent(pool, event, config)
      .then((result) => {
        console.log('[Webhook] Event processed', result);
      })
      .catch((error) => {
        console.error('[Webhook] Error processing event:', error);
      });

    // Return success immediately
    return NextResponse.json({
      success: true,
      event_id: event.event_id,
      event_type: event.event_type,
      event_action: event.event_action,
      message: 'Webhook received and queued for processing',
    });
  } catch (error) {
    console.error('[Webhook] Error handling webhook:', error);

    return NextResponse.json(
      {
        error: 'Failed to process webhook',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
