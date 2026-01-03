/**
 * Incident Ingestion Orchestrator Tests (E76.2 / I762)
 * 
 * Tests for idempotent ingestion functions:
 * - Incident upsert idempotency
 * - Evidence deduplication
 * - Event logging
 * - Batch processing
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  ingestDeployStatusSignal,
  ingestVerificationFailureSignal,
  ingestEcsStoppedTaskSignal,
  ingestRunnerStepFailureSignal,
  batchIngestDeployStatusSignals,
} from '../../../src/lib/incident-ingestion';
import { IncidentDAO } from '../../../src/lib/db/incidents';
import {
  DeployStatusSignal,
  VerificationSignal,
  EcsStoppedTaskSignal,
  RunnerStepFailureSignal,
} from '../../../src/lib/incident-ingestion/mappers';

// Mock the database pool and DAO
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

// Mock IncidentDAO
jest.mock('../../../src/lib/db/incidents', () => {
  return {
    IncidentDAO: jest.fn().mockImplementation(() => {
      return {
        getIncidentByKey: jest.fn(),
        upsertIncidentByKey: jest.fn(),
        addEvidence: jest.fn(),
        createEvent: jest.fn(),
      };
    }),
    getIncidentDAO: jest.fn((pool: Pool) => {
      return new (require('../../../src/lib/db/incidents').IncidentDAO)(pool);
    }),
  };
});

describe('Incident Ingestion Orchestrator', () => {
  let mockDao: jest.Mocked<IncidentDAO>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a fresh mock DAO for each test
    mockDao = {
      getIncidentByKey: jest.fn(),
      upsertIncidentByKey: jest.fn(),
      addEvidence: jest.fn(),
      createEvent: jest.fn(),
    } as any;

    // Mock getIncidentDAO to return our mock
    const { getIncidentDAO } = require('../../../src/lib/db/incidents');
    getIncidentDAO.mockReturnValue(mockDao);
  });

  describe('ingestDeployStatusSignal', () => {
    test('GREEN status returns null result without creating incident', async () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'GREEN',
        changedAt: '2024-01-01T00:00:00Z',
        signals: { checkedAt: '2024-01-01T00:00:00Z' },
        reasons: [],
      };

      const result = await ingestDeployStatusSignal(mockPool, signal);

      expect(result.incident).toBeNull();
      expect(result.isNew).toBe(false);
      expect(result.evidenceAdded).toBe(0);
      expect(mockDao.upsertIncidentByKey).not.toHaveBeenCalled();
    });

    test('YELLOW status creates new incident with evidence and event', async () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'YELLOW',
        changedAt: '2024-01-01T00:00:00Z',
        signals: { checkedAt: '2024-01-01T00:00:00Z' },
        reasons: [
          {
            code: 'READY_DEGRADED',
            severity: 'warning',
            message: 'Ready endpoint degraded',
          },
        ],
        deployId: 'deploy-123',
      };

      // Mock no existing incident
      mockDao.getIncidentByKey.mockResolvedValue(null);

      // Mock upserted incident
      const mockIncident = {
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'Deploy status YELLOW in prod',
        summary: '[warning] READY_DEGRADED: Ready endpoint degraded',
        classification: { error_code: 'DEPLOY_STATUS_YELLOW' },
        lawbook_version: null,
        source_primary: { kind: 'deploy_status', ref: {} },
        tags: ['deploy_status', 'prod'],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };
      mockDao.upsertIncidentByKey.mockResolvedValue(mockIncident as any);

      // Mock evidence addition
      mockDao.addEvidence.mockResolvedValue([
        { id: 'evidence-1', kind: 'deploy_status' },
        { id: 'evidence-2', kind: 'deploy_status' },
      ] as any);

      const result = await ingestDeployStatusSignal(mockPool, signal);

      expect(result.incident).toEqual(mockIncident);
      expect(result.isNew).toBe(true);
      expect(result.evidenceAdded).toBe(2);
      expect(mockDao.upsertIncidentByKey).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
          severity: 'YELLOW',
        })
      );
      expect(mockDao.addEvidence).toHaveBeenCalled();
      expect(mockDao.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'incident-uuid-1',
          event_type: 'CREATED',
        })
      );
    });

    test('RED status updates existing incident', async () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'RED',
        changedAt: '2024-01-01T01:00:00Z',
        signals: { checkedAt: '2024-01-01T01:00:00Z' },
        reasons: [
          {
            code: 'HEALTH_FAIL',
            severity: 'error',
            message: 'Health check failed',
          },
        ],
        deployId: 'deploy-123',
      };

      // Mock existing incident
      const existingIncident = {
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T01:00:00Z',
      };
      mockDao.getIncidentByKey.mockResolvedValue(existingIncident as any);

      // Mock upserted incident
      mockDao.upsertIncidentByKey.mockResolvedValue({
        ...existingIncident,
        severity: 'RED',
        last_seen_at: '2024-01-01T01:00:00Z',
      } as any);

      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result = await ingestDeployStatusSignal(mockPool, signal);

      expect(result.isNew).toBe(false);
      expect(mockDao.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'UPDATED',
        })
      );
    });

    test('idempotent: same signal twice does not duplicate', async () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'YELLOW',
        changedAt: '2024-01-01T00:00:00Z',
        signals: { checkedAt: '2024-01-01T00:00:00Z' },
        reasons: [],
        deployId: 'deploy-123',
      };

      // First call: no existing incident
      mockDao.getIncidentByKey.mockResolvedValueOnce(null);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result1 = await ingestDeployStatusSignal(mockPool, signal);

      // Second call: existing incident
      mockDao.getIncidentByKey.mockResolvedValueOnce({
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
      } as any);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result2 = await ingestDeployStatusSignal(mockPool, signal);

      expect(result1.isNew).toBe(true);
      expect(result2.isNew).toBe(false);
      expect(result1.incident?.incident_key).toBe(result2.incident?.incident_key);
    });
  });

  describe('ingestVerificationFailureSignal', () => {
    test('failed verification creates RED incident', async () => {
      const signal: VerificationSignal = {
        runId: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'failed',
        deployId: 'deploy-123',
        completedAt: '2024-01-01T00:00:00Z',
        reportHash: 'sha256-abc123',
      };

      mockDao.getIncidentByKey.mockResolvedValue(null);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-2',
        incident_key: 'verification:deploy-123:sha256-abc123',
        severity: 'RED',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result = await ingestVerificationFailureSignal(mockPool, signal);

      expect(result.incident).not.toBeNull();
      expect(result.isNew).toBe(true);
      expect(mockDao.upsertIncidentByKey).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_key: 'verification:deploy-123:sha256-abc123',
          severity: 'RED',
        })
      );
    });

    test('success status returns null result', async () => {
      const signal: any = {
        runId: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'prod',
        status: 'success',
        completedAt: '2024-01-01T00:00:00Z',
      };

      const result = await ingestVerificationFailureSignal(mockPool, signal);

      expect(result.incident).toBeNull();
      expect(mockDao.upsertIncidentByKey).not.toHaveBeenCalled();
    });
  });

  describe('ingestEcsStoppedTaskSignal', () => {
    test('stopped task creates incident', async () => {
      const signal: EcsStoppedTaskSignal = {
        cluster: 'prod-cluster',
        taskArn: 'arn:aws:ecs:us-east-1:123:task/prod/abc',
        stoppedAt: '2024-01-01T00:00:00Z',
        exitCode: 1,
      };

      mockDao.getIncidentByKey.mockResolvedValue(null);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-3',
        incident_key: 'ecs_stopped:prod-cluster:arn:aws:ecs:us-east-1:123:task/prod/abc:2024-01-01T00:00:00Z',
        severity: 'RED',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result = await ingestEcsStoppedTaskSignal(mockPool, signal);

      expect(result.incident).not.toBeNull();
      expect(result.isNew).toBe(true);
    });
  });

  describe('ingestRunnerStepFailureSignal', () => {
    test('failed step creates RED incident', async () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123456',
        stepName: 'Build',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
      };

      mockDao.getIncidentByKey.mockResolvedValue(null);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-4',
        incident_key: 'runner:123456:Build:failure',
        severity: 'RED',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result = await ingestRunnerStepFailureSignal(mockPool, signal);

      expect(result.incident).not.toBeNull();
      expect(result.isNew).toBe(true);
      expect(mockDao.upsertIncidentByKey).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_key: 'runner:123456:Build:failure',
          severity: 'RED',
        })
      );
    });

    test('cancelled step creates YELLOW incident', async () => {
      const signal: RunnerStepFailureSignal = {
        runId: '123456',
        stepName: 'Deploy',
        conclusion: 'cancelled',
        completedAt: '2024-01-01T00:00:00Z',
      };

      mockDao.getIncidentByKey.mockResolvedValue(null);
      mockDao.upsertIncidentByKey.mockResolvedValue({
        id: 'incident-uuid-5',
        incident_key: 'runner:123456:Deploy:cancelled',
        severity: 'YELLOW',
      } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const result = await ingestRunnerStepFailureSignal(mockPool, signal);

      expect(result.incident?.severity).toBe('YELLOW');
    });
  });

  describe('batchIngestDeployStatusSignals', () => {
    test('processes multiple signals', async () => {
      const signals: DeployStatusSignal[] = [
        {
          env: 'prod',
          status: 'YELLOW',
          changedAt: '2024-01-01T00:00:00Z',
          signals: { checkedAt: '2024-01-01T00:00:00Z' },
          reasons: [],
          deployId: 'deploy-1',
        },
        {
          env: 'stage',
          status: 'RED',
          changedAt: '2024-01-01T00:00:00Z',
          signals: { checkedAt: '2024-01-01T00:00:00Z' },
          reasons: [],
          deployId: 'deploy-2',
        },
      ];

      mockDao.getIncidentByKey.mockResolvedValue(null);
      mockDao.upsertIncidentByKey
        .mockResolvedValueOnce({
          id: 'incident-1',
          incident_key: 'deploy_status:prod:deploy-1:2024-01-01T00:00:00Z',
        } as any)
        .mockResolvedValueOnce({
          id: 'incident-2',
          incident_key: 'deploy_status:stage:deploy-2:2024-01-01T00:00:00Z',
        } as any);
      mockDao.addEvidence.mockResolvedValue([{ id: 'evidence-1' }] as any);

      const results = await batchIngestDeployStatusSignals(mockPool, signals);

      expect(results).toHaveLength(2);
      expect(results[0].incident?.id).toBe('incident-1');
      expect(results[1].incident?.id).toBe('incident-2');
    });
  });

  describe('Error Handling', () => {
    test('handles database errors gracefully', async () => {
      const signal: DeployStatusSignal = {
        env: 'prod',
        status: 'RED',
        changedAt: '2024-01-01T00:00:00Z',
        signals: { checkedAt: '2024-01-01T00:00:00Z' },
        reasons: [],
      };

      mockDao.getIncidentByKey.mockRejectedValue(new Error('Database connection failed'));

      const result = await ingestDeployStatusSignal(mockPool, signal);

      expect(result.incident).toBeNull();
      expect(result.error).toContain('Database connection failed');
    });
  });
});
