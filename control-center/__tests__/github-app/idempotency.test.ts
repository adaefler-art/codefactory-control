import type { Pool } from 'pg';
import { recordGitHubWebhookDelivery } from '../../src/lib/webhooks/persistence';

describe('recordGitHubWebhookDelivery', () => {
  it('returns inserted=true when row is inserted', async () => {
    const pool = {
      query: jest.fn(async () => ({ rowCount: 1, rows: [{ delivery_id: 'd1' }] })),
    } as unknown as Pool;

    await expect(
      recordGitHubWebhookDelivery(pool, {
        delivery_id: 'd1',
        event_type: 'issues',
        repository_full_name: 'o/r',
      })
    ).resolves.toEqual({ inserted: true });

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('returns duplicate=true when delivery already exists', async () => {
    const pool = {
      query: jest.fn(async () => ({ rowCount: 0, rows: [] })),
    } as unknown as Pool;

    await expect(
      recordGitHubWebhookDelivery(pool, {
        delivery_id: 'd1',
        event_type: 'issues',
        repository_full_name: 'o/r',
      })
    ).resolves.toEqual({ inserted: false, duplicate: true });
  });
});
