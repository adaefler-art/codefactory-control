import { computeDeliveryId, extractGithubEvent, parseEnvelope } from '../../src/lib/github-events/extract';

describe('GitHub Events (Event Bus) extraction', () => {
  test('uses explicit delivery_id when present', () => {
    const body = JSON.stringify({ delivery_id: 'd-123', event_name: 'issues', repository: { full_name: 'o/r' } });
    const env = parseEnvelope(body);
    expect(computeDeliveryId(env, body)).toBe('d-123');
  });

  test('falls back to gha:run_id when run_id is present', () => {
    const body = JSON.stringify({ run_id: 12345, event_name: 'workflow_run' });
    const env = parseEnvelope(body);
    expect(computeDeliveryId(env, body)).toBe('gha:12345');
  });

  test('extracts event_name and repository_full_name', () => {
    const body = JSON.stringify({
      delivery_id: 'x',
      event_name: 'issues',
      repository: { full_name: 'adaefler-art/codefactory-control' },
    });

    const env = parseEnvelope(body);
    const extracted = extractGithubEvent(env, body);

    expect(extracted.delivery_id).toBe('x');
    expect(extracted.event_name).toBe('issues');
    expect(extracted.repository_full_name).toBe('adaefler-art/codefactory-control');
  });
});
