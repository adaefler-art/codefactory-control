/**
 * Deploy Status Verification Resolver Tests (E65.1 v2)
 *
 * Verifies deterministic status mapping based solely on E65.2 post-deploy verification runs.
 *
 * @jest-environment node
 */

import { resolveDeployStatusFromVerificationRuns } from '../../src/lib/deploy-status/verification-resolver';

jest.mock('../../src/lib/db/playbookRuns', () => ({
  listPlaybookRuns: jest.fn(),
}));

jest.mock('../../src/lib/playbook-executor', () => ({
  getPlaybookRunResult: jest.fn(),
}));

describe('Deploy Status Verification Resolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('no run => YELLOW', async () => {
    const { listPlaybookRuns } = require('../../src/lib/db/playbookRuns');
    listPlaybookRuns.mockResolvedValue([]);

    const result = await resolveDeployStatusFromVerificationRuns({} as any, { env: 'prod' });

    expect(result.status).toBe('YELLOW');
    expect(result.reasons[0].code).toBe('NO_VERIFICATION_RUN');
    expect(result.signals.verification_run).toBeNull();
  });

  test('latest SUCCESS => GREEN', async () => {
    const { listPlaybookRuns } = require('../../src/lib/db/playbookRuns');
    listPlaybookRuns.mockResolvedValue([
      {
        id: 'run-1',
        playbook_id: 'post-deploy-verify',
        playbook_version: '1.0.0',
        env: 'prod',
        status: 'success',
        started_at: null,
        completed_at: '2025-01-01T00:00:10.000Z',
        summary: null,
        created_at: '2025-01-01T00:00:00.000Z',
      },
    ]);

    const result = await resolveDeployStatusFromVerificationRuns({} as any, { env: 'prod' });

    expect(result.status).toBe('GREEN');
    expect(result.reasons[0].code).toBe('VERIFICATION_SUCCESS');
    expect(result.signals.verification_run?.run_id).toBe('run-1');
  });

  test('latest FAILED => RED', async () => {
    const { listPlaybookRuns } = require('../../src/lib/db/playbookRuns');
    listPlaybookRuns.mockResolvedValue([
      {
        id: 'run-2',
        playbook_id: 'post-deploy-verify',
        playbook_version: '1.0.0',
        env: 'prod',
        status: 'failed',
        started_at: '2025-01-01T00:00:00.000Z',
        completed_at: '2025-01-01T00:00:10.000Z',
        summary: null,
        created_at: '2025-01-01T00:00:00.000Z',
      },
    ]);

    const result = await resolveDeployStatusFromVerificationRuns({} as any, { env: 'prod' });

    expect(result.status).toBe('RED');
    expect(result.reasons[0].code).toBe('VERIFICATION_FAILED');
  });

  test('latest RUNNING => YELLOW', async () => {
    const { listPlaybookRuns } = require('../../src/lib/db/playbookRuns');
    listPlaybookRuns.mockResolvedValue([
      {
        id: 'run-3',
        playbook_id: 'post-deploy-verify',
        playbook_version: '1.0.0',
        env: 'prod',
        status: 'running',
        started_at: '2025-01-01T00:00:00.000Z',
        completed_at: null,
        summary: null,
        created_at: '2025-01-01T00:00:00.000Z',
      },
    ]);

    const result = await resolveDeployStatusFromVerificationRuns({} as any, { env: 'prod' });

    expect(result.status).toBe('YELLOW');
    expect(result.reasons[0].code).toBe('VERIFICATION_RUNNING');
  });

  test('correlationId (UUID) treated as runId: SUCCESS => GREEN', async () => {
    const { getPlaybookRunResult } = require('../../src/lib/playbook-executor');
    getPlaybookRunResult.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      playbookId: 'post-deploy-verify',
      playbookVersion: '1.0.0',
      env: 'prod',
      status: 'success',
      startedAt: null,
      completedAt: '2025-01-01T00:00:10.000Z',
      summary: null,
      steps: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    });

    const result = await resolveDeployStatusFromVerificationRuns({} as any, {
      env: 'prod',
      correlationId: '11111111-1111-1111-1111-111111111111',
    });

    expect(result.status).toBe('GREEN');
    expect(result.reasons[0].evidence).toEqual(
      expect.objectContaining({
        correlation_id: '11111111-1111-1111-1111-111111111111',
        run_id: '11111111-1111-1111-1111-111111111111',
      })
    );
  });
});
