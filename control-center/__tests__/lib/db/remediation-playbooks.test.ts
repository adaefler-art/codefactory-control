/**
 * Remediation Playbook DAO Tests
 * 
 * Tests for remediation playbook persistence layer:
 * - Idempotent run creation by run_key
 * - Step creation and status updates
 * - Deterministic querying
 * 
 * Reference: I771 (E77.1 - Remediation Playbook Framework)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { RemediationPlaybookDAO } from '@/lib/db/remediation-playbooks';
import {
  RemediationRunInput,
  RemediationStepInput,
} from '@/lib/contracts/remediation-playbook';

// Mock the database pool
const mockQuery = jest.fn();

const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('RemediationPlaybookDAO', () => {
  let dao: RemediationPlaybookDAO;

  beforeEach(() => {
    dao = new RemediationPlaybookDAO(mockPool);
    jest.clearAllMocks();
  });

  describe('upsertRunByKey', () => {
    test('creates new run on first insert', async () => {
      const input: RemediationRunInput = {
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'PLANNED',
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
        planned_json: {
          playbookId: 'restart-service',
          steps: [],
        },
      };

      const mockRow = {
        id: 'run-uuid-1',
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'PLANNED',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
        planned_json: {
          playbookId: 'restart-service',
          steps: [],
        },
        result_json: null,
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertRunByKey(input);

      expect(result.id).toBe('run-uuid-1');
      expect(result.run_key).toBe('test:incident:1:restart-service:abc123');
      expect(result.status).toBe('PLANNED');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remediation_runs'),
        expect.arrayContaining(['test:incident:1:restart-service:abc123', 'incident-uuid-1', 'restart-service'])
      );
    });

    test('returns existing run on conflict (idempotent)', async () => {
      const input: RemediationRunInput = {
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'PLANNED',
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      const mockRow = {
        id: 'run-uuid-existing',
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'SUCCEEDED', // Existing run is already completed
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z'),
        planned_json: { playbookId: 'restart-service', steps: [] },
        result_json: { totalSteps: 1, successCount: 1 },
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertRunByKey(input);

      expect(result.id).toBe('run-uuid-existing');
      expect(result.status).toBe('SUCCEEDED');
    });
  });

  describe('getRunByKey', () => {
    test('retrieves run by run_key', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'SUCCEEDED',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z'),
        planned_json: { playbookId: 'restart-service', steps: [] },
        result_json: { totalSteps: 1, successCount: 1 },
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.getRunByKey('test:incident:1:restart-service:abc123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('run-uuid-1');
      expect(result!.run_key).toBe('test:incident:1:restart-service:abc123');
    });

    test('returns null when run not found', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await dao.getRunByKey('nonexistent:key');

      expect(result).toBeNull();
    });
  });

  describe('updateRunStatus', () => {
    test('updates run status and result_json', async () => {
      const mockRow = {
        id: 'run-uuid-1',
        run_key: 'test:incident:1:restart-service:abc123',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'SUCCEEDED',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z'),
        planned_json: { playbookId: 'restart-service', steps: [] },
        result_json: { totalSteps: 1, successCount: 1, failedCount: 0 },
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.updateRunStatus('run-uuid-1', 'SUCCEEDED', {
        totalSteps: 1,
        successCount: 1,
        failedCount: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('SUCCEEDED');
      expect(result!.result_json).toEqual({ totalSteps: 1, successCount: 1, failedCount: 0 });
    });
  });

  describe('createStep', () => {
    test('creates new step', async () => {
      const input: RemediationStepInput = {
        remediation_run_id: 'run-uuid-1',
        step_id: 'step1',
        action_type: 'RESTART_SERVICE',
        status: 'PLANNED',
        idempotency_key: 'RESTART_SERVICE:test:abc123',
        input_json: { service: 'prod-api' },
      };

      const mockRow = {
        id: 'step-uuid-1',
        remediation_run_id: 'run-uuid-1',
        step_id: 'step1',
        action_type: 'RESTART_SERVICE',
        status: 'PLANNED',
        started_at: null,
        finished_at: null,
        idempotency_key: 'RESTART_SERVICE:test:abc123',
        input_json: { service: 'prod-api' },
        output_json: null,
        error_json: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.createStep(input);

      expect(result.id).toBe('step-uuid-1');
      expect(result.step_id).toBe('step1');
      expect(result.action_type).toBe('RESTART_SERVICE');
    });
  });

  describe('updateStepStatus', () => {
    test('updates step status with timestamps and output', async () => {
      const mockRow = {
        id: 'step-uuid-1',
        remediation_run_id: 'run-uuid-1',
        step_id: 'step1',
        action_type: 'RESTART_SERVICE',
        status: 'SUCCEEDED',
        started_at: new Date('2024-01-01T00:00:00Z'),
        finished_at: new Date('2024-01-01T00:01:00Z'),
        idempotency_key: 'RESTART_SERVICE:test:abc123',
        input_json: { service: 'prod-api' },
        output_json: { taskArn: 'arn:aws:ecs:...' },
        error_json: null,
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.updateStepStatus('step-uuid-1', 'SUCCEEDED', {
        finished_at: new Date('2024-01-01T00:01:00Z'),
        output_json: { taskArn: 'arn:aws:ecs:...' },
      });

      expect(result).not.toBeNull();
      expect(result!.status).toBe('SUCCEEDED');
      expect(result!.output_json).toEqual({ taskArn: 'arn:aws:ecs:...' });
    });
  });

  describe('getStepsForRun', () => {
    test('retrieves all steps for a run ordered by step_id', async () => {
      const mockRows = [
        {
          id: 'step-uuid-1',
          remediation_run_id: 'run-uuid-1',
          step_id: 'step1',
          action_type: 'RESTART_SERVICE',
          status: 'SUCCEEDED',
          started_at: new Date('2024-01-01T00:00:00Z'),
          finished_at: new Date('2024-01-01T00:01:00Z'),
          idempotency_key: 'RESTART_SERVICE:test:abc123',
          input_json: { service: 'prod-api' },
          output_json: { taskArn: 'arn:aws:ecs:...' },
          error_json: null,
        },
        {
          id: 'step-uuid-2',
          remediation_run_id: 'run-uuid-1',
          step_id: 'step2',
          action_type: 'NOTIFY_SLACK',
          status: 'SUCCEEDED',
          started_at: new Date('2024-01-01T00:01:00Z'),
          finished_at: new Date('2024-01-01T00:02:00Z'),
          idempotency_key: 'NOTIFY_SLACK:test:abc123',
          input_json: { channel: '#alerts' },
          output_json: { messageId: 'msg-123' },
          error_json: null,
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await dao.getStepsForRun('run-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0].step_id).toBe('step1');
      expect(result[1].step_id).toBe('step2');
    });
  });
});
