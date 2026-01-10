/**
 * UI test: Cost Control page renders safely with empty settings and unknown status.
 *
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import AdminCostControlPage from '../../../../app/admin/cost-control/page';

function mockFetchSequence(responses: Array<{ ok: boolean; json: any }>) {
  let i = 0;
  global.fetch = jest.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.ok,
      json: async () => r.json,
    } as any;
  }) as any;
}

describe('AdminCostControlPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('renders unknown status and empty event log without crashing', async () => {
    mockFetchSequence([
      {
        ok: true,
        json: { sub: 'admin', isAdmin: true, deploymentEnv: 'staging' },
      },
      {
        ok: true,
        json: { ok: true, env: 'staging', settings: [], events: [] },
      },
      {
        ok: true,
        json: {
          ok: true,
          env: 'staging',
          ecs: { state: 'unknown' },
          rds: { state: 'unknown' },
          timestamp: new Date().toISOString(),
        },
      },
    ]);

    render(<AdminCostControlPage />);

    await waitFor(() => {
      expect(screen.getByText('Desired State (staging)')).toBeInTheDocument();
    });

    expect(screen.getByText('Status (read-only)')).toBeInTheDocument();
    expect(screen.getAllByText('unknown').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('No events.')).toBeInTheDocument();
  });
});
