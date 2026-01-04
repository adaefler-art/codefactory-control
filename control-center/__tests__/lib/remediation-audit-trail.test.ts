/**
 * Remediation Audit Trail Tests (E77.5 / I775)
 * 
 * Tests for comprehensive audit trail:
 * - Events emitted in correct order
 * - Payload hash deterministic
 * - Append-only behavior enforced
 * - Query API works correctly
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  RemediationAuditEventInput,
  computePayloadHash,
  stableStringify,
} from '@/lib/contracts/remediation-playbook';
import { RemediationPlaybookDAO } from '@/lib/db/remediation-playbooks';

// Mock the database pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('Remediation Audit Trail (E77.5 / I775)', () => {
  let dao: RemediationPlaybookDAO;

  beforeEach(() => {
    dao = new RemediationPlaybookDAO(mockPool);
    jest.clearAllMocks();
  });

  // ========================================
  // Test: Payload Hash Deterministic
  // ========================================

  describe('Payload Hash Deterministic', () => {
    test('should compute same hash for same payload regardless of key order', () => {
      const payload1 = {
        stepId: 'restart-service',
        actionType: 'RESTART_SERVICE',
        inputsHash: 'abc123',
      };

      const payload2 = {
        actionType: 'RESTART_SERVICE',
        inputsHash: 'abc123',
        stepId: 'restart-service',
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    });

    test('should compute different hash for different payloads', () => {
      const payload1 = {
        stepId: 'restart-service',
        actionType: 'RESTART_SERVICE',
      };

      const payload2 = {
        stepId: 'restart-service',
        actionType: 'SCALE_UP', // Different action
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).not.toBe(hash2);
    });

    test('should handle nested objects deterministically', () => {
      const payload1 = {
        step: {
          id: 'step1',
          action: 'RESTART',
          params: { service: 'api', region: 'us-east-1' },
        },
      };

      const payload2 = {
        step: {
          params: { region: 'us-east-1', service: 'api' }, // Different order
          action: 'RESTART',
          id: 'step1',
        },
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
    });
  });

  // ========================================
  // Test: Stable Stringify
  // ========================================

  describe('Stable Stringify', () => {
    test('should normalize undefined to null', () => {
      const obj1 = { a: null, b: 'test' };
      const obj2 = { a: undefined, b: 'test' };

      const str1 = stableStringify(obj1);
      const str2 = stableStringify(obj2);

      expect(str1).toBe(str2);
    });

    test('should sort object keys alphabetically', () => {
      const obj = { z: 1, a: 2, m: 3 };
      const result = stableStringify(obj);

      // Keys should be in alphabetical order
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    test('should handle arrays consistently', () => {
      const obj1 = { items: [1, 2, 3] };
      const obj2 = { items: [1, 2, 3] };

      const str1 = stableStringify(obj1);
      const str2 = stableStringify(obj2);

      expect(str1).toBe(str2);
    });
  });

  // ========================================
  // Test: Audit Event Creation
  // ========================================

  describe('Audit Event Creation', () => {
    test('should create audit event with sanitized payload and hash', async () => {
      const input: RemediationAuditEventInput = {
        remediation_run_id: 'run-uuid-1',
        incident_id: 'incident-uuid-1',
        event_type: 'PLANNED',
        lawbook_version: 'v1.0.0',
        payload_json: {
          playbookId: 'restart-service',
          stepsCount: 3,
        },
        payload_hash: '', // Will be computed
      };

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-event-uuid-1',
            remediation_run_id: 'run-uuid-1',
            incident_id: 'incident-uuid-1',
            event_type: 'PLANNED',
            created_at: new Date('2024-01-01T00:00:00Z'),
            lawbook_version: 'v1.0.0',
            payload_json: {
              playbookId: 'restart-service',
              stepsCount: 3,
            },
            payload_hash: computePayloadHash(input.payload_json),
          },
        ],
      });

      const event = await dao.createAuditEvent(input);

      expect(event.id).toBe('audit-event-uuid-1');
      expect(event.event_type).toBe('PLANNED');
      expect(event.payload_json).toEqual({
        playbookId: 'restart-service',
        stepsCount: 3,
      });
      expect(event.payload_hash).toMatch(/^[a-f0-9]{64}$/);

      // Verify INSERT query was called
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO remediation_audit_events'),
        expect.arrayContaining([
          'run-uuid-1',
          'incident-uuid-1',
          'PLANNED',
          'v1.0.0',
        ])
      );
    });

    test('should sanitize secrets in payload', async () => {
      const input: RemediationAuditEventInput = {
        remediation_run_id: 'run-uuid-1',
        incident_id: 'incident-uuid-1',
        event_type: 'STEP_STARTED',
        lawbook_version: 'v1.0.0',
        payload_json: {
          stepId: 'notify',
          token: 'secret-token-123', // Should be sanitized
          apiKey: 'sk-live-xyz', // Should be sanitized
        },
        payload_hash: '',
      };

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'audit-event-uuid-2',
            remediation_run_id: 'run-uuid-1',
            incident_id: 'incident-uuid-1',
            event_type: 'STEP_STARTED',
            created_at: new Date('2024-01-01T00:00:01Z'),
            lawbook_version: 'v1.0.0',
            payload_json: {
              stepId: 'notify',
              token: '********', // Sanitized
              apiKey: '********', // Sanitized
            },
            payload_hash: 'some-hash',
          },
        ],
      });

      const event = await dao.createAuditEvent(input);

      // Verify secrets were sanitized
      expect(event.payload_json.token).toBe('********');
      expect(event.payload_json.apiKey).toBe('********');
      expect(event.payload_json.stepId).toBe('notify'); // Non-secret preserved
    });
  });

  // ========================================
  // Test: Get Audit Events (Deterministic Order)
  // ========================================

  describe('Get Audit Events', () => {
    test('should return events in deterministic order (created_at ASC, id ASC)', async () => {
      const events = [
        {
          id: 'event-1',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'PLANNED',
          created_at: new Date('2024-01-01T00:00:00Z'),
          lawbook_version: 'v1.0.0',
          payload_json: { step: 'plan' },
          payload_hash: 'hash1',
        },
        {
          id: 'event-2',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'STEP_STARTED',
          created_at: new Date('2024-01-01T00:00:01Z'),
          lawbook_version: 'v1.0.0',
          payload_json: { step: 'start' },
          payload_hash: 'hash2',
        },
        {
          id: 'event-3',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'STEP_FINISHED',
          created_at: new Date('2024-01-01T00:00:02Z'),
          lawbook_version: 'v1.0.0',
          payload_json: { step: 'finish' },
          payload_hash: 'hash3',
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: events });

      const result = await dao.getAuditEventsForRun('run-uuid-1');

      expect(result).toHaveLength(3);
      expect(result[0].event_type).toBe('PLANNED');
      expect(result[1].event_type).toBe('STEP_STARTED');
      expect(result[2].event_type).toBe('STEP_FINISHED');

      // Verify query uses correct ORDER BY
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at ASC, id ASC'),
        ['run-uuid-1']
      );
    });

    test('should handle events with same timestamp using id ordering', async () => {
      const sameTime = new Date('2024-01-01T00:00:00Z');
      const events = [
        {
          id: 'event-a',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'STEP_STARTED',
          created_at: sameTime,
          lawbook_version: 'v1.0.0',
          payload_json: { step: 1 },
          payload_hash: 'hash-a',
        },
        {
          id: 'event-b',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'STEP_STARTED',
          created_at: sameTime,
          lawbook_version: 'v1.0.0',
          payload_json: { step: 2 },
          payload_hash: 'hash-b',
        },
      ];

      mockQuery.mockResolvedValueOnce({ rows: events });

      const result = await dao.getAuditEventsForRun('run-uuid-1');

      expect(result).toHaveLength(2);
      // Both have same timestamp, so order should be by id
      expect(result[0].id).toBe('event-a');
      expect(result[1].id).toBe('event-b');
    });
  });

  // ========================================
  // Test: Audit Bundle Export
  // ========================================

  describe('Audit Bundle Export', () => {
    test('should return complete bundle with run, steps, and audit events', async () => {
      const run = {
        id: 'run-uuid-1',
        run_key: 'test:incident:1:restart:abc',
        incident_id: 'incident-uuid-1',
        playbook_id: 'restart-service',
        playbook_version: '1.0.0',
        status: 'SUCCEEDED',
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:10Z'),
        planned_json: { steps: [] },
        result_json: { success: true },
        lawbook_version: 'v1.0.0',
        inputs_hash: 'abc123',
      };

      const steps = [
        {
          id: 'step-uuid-1',
          remediation_run_id: 'run-uuid-1',
          step_id: 'restart',
          action_type: 'RESTART_SERVICE',
          status: 'SUCCEEDED',
          started_at: new Date('2024-01-01T00:00:01Z'),
          finished_at: new Date('2024-01-01T00:00:05Z'),
          idempotency_key: 'restart:test:abc',
          input_json: {},
          output_json: { success: true },
          error_json: null,
        },
      ];

      const auditEvents = [
        {
          id: 'event-1',
          remediation_run_id: 'run-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'PLANNED',
          created_at: new Date('2024-01-01T00:00:00Z'),
          lawbook_version: 'v1.0.0',
          payload_json: {},
          payload_hash: 'hash1',
        },
      ];

      // Mock getRun
      mockQuery.mockResolvedValueOnce({ rows: [run] });
      // Mock getStepsForRun
      mockQuery.mockResolvedValueOnce({ rows: steps });
      // Mock getAuditEventsForRun
      mockQuery.mockResolvedValueOnce({ rows: auditEvents });

      const bundle = await dao.getAuditBundle('run-uuid-1');

      expect(bundle.run).toBeTruthy();
      expect(bundle.run?.id).toBe('run-uuid-1');
      expect(bundle.steps).toHaveLength(1);
      expect(bundle.auditEvents).toHaveLength(1);
    });
  });
});
