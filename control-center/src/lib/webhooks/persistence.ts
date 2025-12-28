/**
 * Webhook Event Persistence
 * 
 * Database operations for storing and retrieving webhook events
 */

import { Pool } from 'pg';
import { WebhookEvent, WebhookConfig } from './types';

export type GitHubWebhookDeliveryRecordResult =
  | { inserted: true }
  | { inserted: false; duplicate: true };

/**
 * Record a GitHub webhook delivery for idempotency.
 *
 * Returns { inserted: false, duplicate: true } if the delivery_id was already seen.
 */
export async function recordGitHubWebhookDelivery(
  pool: Pool,
  input: {
    delivery_id: string;
    event_type: string;
    repository_full_name?: string;
  }
): Promise<GitHubWebhookDeliveryRecordResult> {
  const query = `
    INSERT INTO github_webhook_deliveries (delivery_id, event_type, repository_full_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING delivery_id
  `;

  const result = await pool.query(query, [
    input.delivery_id,
    input.event_type,
    input.repository_full_name ?? null,
  ]);

  if (result.rowCount && result.rowCount > 0) {
    return { inserted: true };
  }

  return { inserted: false, duplicate: true };
}

/**
 * Store a webhook event in the database
 */
export async function storeWebhookEvent(
  pool: Pool,
  event: Omit<WebhookEvent, 'id' | 'received_at' | 'processed'>
): Promise<WebhookEvent> {
  const query = `
    INSERT INTO webhook_events (
      event_id, event_type, event_action, payload, signature, delivery_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const values = [
    event.event_id,
    event.event_type,
    event.event_action,
    JSON.stringify(event.payload),
    event.signature,
    event.delivery_id,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Mark webhook event as processed
 */
export async function markWebhookProcessed(
  pool: Pool,
  event_id: string,
  workflow_execution_id?: string,
  error?: string
): Promise<void> {
  const query = `
    UPDATE webhook_events
    SET processed = TRUE,
        processed_at = NOW(),
        workflow_execution_id = $2,
        error = $3
    WHERE event_id = $1
  `;

  await pool.query(query, [event_id, workflow_execution_id, error]);
}

/**
 * Get webhook configuration by name
 */
export async function getWebhookConfig(
  pool: Pool,
  name: string
): Promise<WebhookConfig | null> {
  const query = `
    SELECT * FROM webhook_configs
    WHERE name = $1 AND enabled = TRUE
  `;

  const result = await pool.query(query, [name]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * List recent webhook events
 */
export async function listWebhookEvents(
  pool: Pool,
  limit: number = 50,
  offset: number = 0
): Promise<WebhookEvent[]> {
  const query = `
    SELECT * FROM webhook_events
    ORDER BY received_at DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await pool.query(query, [limit, offset]);
  return result.rows;
}

/**
 * Get webhook event by ID
 */
export async function getWebhookEvent(
  pool: Pool,
  event_id: string
): Promise<WebhookEvent | null> {
  const query = `
    SELECT * FROM webhook_events
    WHERE event_id = $1
  `;

  const result = await pool.query(query, [event_id]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get webhook statistics
 */
export async function getWebhookStats(pool: Pool): Promise<{
  total: number;
  processed: number;
  failed: number;
  by_type: Record<string, number>;
}> {
  const statsQuery = `
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE processed = TRUE AND error IS NULL) as processed,
      COUNT(*) FILTER (WHERE error IS NOT NULL) as failed
    FROM webhook_events
  `;

  const byTypeQuery = `
    SELECT event_type, COUNT(*) as count
    FROM webhook_events
    GROUP BY event_type
    ORDER BY count DESC
  `;

  const [statsResult, byTypeResult] = await Promise.all([
    pool.query(statsQuery),
    pool.query(byTypeQuery),
  ]);

  const stats = statsResult.rows[0];
  const by_type: Record<string, number> = {};
  
  byTypeResult.rows.forEach((row) => {
    by_type[row.event_type] = parseInt(row.count);
  });

  return {
    total: parseInt(stats.total),
    processed: parseInt(stats.processed),
    failed: parseInt(stats.failed),
    by_type,
  };
}
