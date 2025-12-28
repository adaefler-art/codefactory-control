import type { Pool } from 'pg';
import type { GithubEventRecord } from './types';

export type DeliveryUpsertResult =
  | { status: 'inserted' }
  | { status: 'duplicate'; processed: boolean };

export async function upsertGithubActionDelivery(
  pool: Pool,
  input: {
    delivery_id: string;
    event_name: string | null;
    repository_full_name: string | null;
    envelope: Record<string, unknown>;
  }
): Promise<DeliveryUpsertResult> {
  // Insert-once idempotency via PRIMARY KEY (delivery_id).
  const insertQuery = `
    INSERT INTO github_action_deliveries (delivery_id, event_name, repository_full_name, envelope)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING delivery_id
  `;

  const inserted = await pool.query(insertQuery, [
    input.delivery_id,
    input.event_name,
    input.repository_full_name,
    JSON.stringify(input.envelope),
  ]);

  if (inserted.rowCount && inserted.rowCount > 0) {
    return { status: 'inserted' };
  }

  const selectQuery = `
    SELECT processed
    FROM github_action_deliveries
    WHERE delivery_id = $1
  `;

  const existing = await pool.query(selectQuery, [input.delivery_id]);
  const processed = Boolean(existing.rows?.[0]?.processed);

  return { status: 'duplicate', processed };
}

export async function markGithubActionDeliveryProcessed(
  pool: Pool,
  delivery_id: string,
  error: string | null = null
): Promise<void> {
  const query = `
    UPDATE github_action_deliveries
    SET processed = $2,
        processed_at = NOW(),
        error = $3
    WHERE delivery_id = $1
  `;

  await pool.query(query, [delivery_id, error === null, error]);
}

export async function listGithubActionDeliveries(
  pool: Pool,
  limit: number = 50
): Promise<GithubEventRecord[]> {
  const query = `
    SELECT delivery_id, event_name, repository_full_name, envelope,
           received_at, processed, processed_at, error
    FROM github_action_deliveries
    ORDER BY received_at DESC
    LIMIT $1
  `;

  const result = await pool.query(query, [limit]);
  return result.rows;
}
