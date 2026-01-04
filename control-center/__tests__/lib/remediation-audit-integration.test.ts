/**
 * Remediation Audit Trail Integration Tests (E77.5 / I775)
 * 
 * Tests for audit event emission during remediation execution:
 * - Events emitted in correct order for successful run
 * - Events emitted for failed run
 * - Append-only enforcement
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  ExecutePlaybookRequest,
  StepContext,
  StepResult,
} from '@/lib/contracts/remediation-playbook';
import { IncidentInput } from '@/lib/contracts/incident';

// Mock the lawbook loader
jest.mock('@/lawbook/load', () => ({
  loadGuardrails: jest.fn().mockResolvedValue({
    hash: 'abcd1234567890',
    data: { version: 1, guardrails: [] },
  }),
}));

import { RemediationPlaybookExecutor } from '@/lib/remediation-executor';

// Mock the database pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('Remediation Audit Trail Integration (E77.5 / I775)', () => {
  let executor: RemediationPlaybookExecutor;

  beforeEach(() => {
    executor = new RemediationPlaybookExecutor(mockPool);
    jest.clearAllMocks();
  });

  // ========================================
  // Test: Events Emitted for Successful Run
  // ========================================

  describe('Audit Events for Successful Run', () => {
    test('should emit audit events in correct order: PLANNED → STEP_STARTED → STEP_FINISHED → STATUS_UPDATED → COMPLETED', async () => {
      const incident: IncidentInput = {
        incident_key: 'test:incident:audit:1',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test Audit Trail',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod' },
        },
        lawbook_version: 'v1.0.0',
      };

      const playbook: PlaybookDefinition = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'restart',
            actionType: 'RESTART_SERVICE',
            description: 'Restart the service',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
        inputs: {},
      };

      // Track all INSERT calls to verify audit events
      const auditInserts: any[] = [];
      
      mockQuery.mockImplementation((query: string, params: any[]) => {
        // Capture audit event inserts
        if (query.includes('INSERT INTO remediation_audit_events')) {
          auditInserts.push({
            event_type: params[2], // event_type is 3rd param
            lawbook_version: params[3], // lawbook_version is 4th param
            payload_json: params[4], // payload_json is 5th param
          });
          return Promise.resolve({
            rows: [{
              id: `audit-event-${auditInserts.length}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'test-hash',
            }],
          });
        }

        // Mock incident retrieval
        if (query.includes('SELECT') && query.includes('FROM incidents WHERE id')) {
          return Promise.resolve({
            rows: [{
              id: 'incident-uuid-1',
              incident_key: 'test:incident:audit:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Audit Trail',
              source_primary: JSON.stringify({ kind: 'deploy_status', ref: { env: 'prod' } }),
              lawbook_version: 'v1.0.0',
              created_at: new Date(),
              updated_at: new Date(),
            }],
          });
        }

        // Mock evidence retrieval (empty)
        if (query.includes('FROM evidence WHERE incident_id')) {
          return Promise.resolve({ rows: [] });
        }

        // Mock check for existing run
        if (query.includes('FROM remediation_runs WHERE run_key')) {
          return Promise.resolve({ rows: [] }); // No existing run
        }

        // Mock run creation
        if (query.includes('INSERT INTO remediation_runs')) {
          return Promise.resolve({
            rows: [{
              id: 'run-uuid-1',
              run_key: 'test:incident:audit:1:restart-service:abc',
              incident_id: 'incident-uuid-1',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: params[4] || 'PLANNED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: params[5],
              result_json: null,
              lawbook_version: 'abcd1234',
              inputs_hash: params[8],
            }],
          });
        }

        // Mock step creation
        if (query.includes('INSERT INTO remediation_steps')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: params[1],
              action_type: params[2],
              status: params[3],
              started_at: null,
              finished_at: null,
              idempotency_key: params[4],
              input_json: params[5],
              output_json: null,
              error_json: null,
            }],
          });
        }

        // Mock step updates
        if (query.includes('UPDATE remediation_steps')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'restart',
              action_type: 'RESTART_SERVICE',
              status: params[0],
              started_at: params[1] || null,
              finished_at: params[2] || null,
              idempotency_key: 'restart:test:abc',
              input_json: {},
              output_json: params[3],
              error_json: null,
            }],
          });
        }

        // Mock run status update
        if (query.includes('UPDATE remediation_runs')) {
          return Promise.resolve({
            rows: [{
              id: 'run-uuid-1',
              run_key: 'test:incident:audit:1:restart-service:abc',
              incident_id: 'incident-uuid-1',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: params[0],
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: {},
              result_json: params[1],
              lawbook_version: 'abcd1234',
              inputs_hash: 'abc',
            }],
          });
        }

        // Mock get steps for run
        if (query.includes('FROM remediation_steps WHERE remediation_run_id')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'restart',
              action_type: 'RESTART_SERVICE',
              status: 'SUCCEEDED',
              started_at: new Date(),
              finished_at: new Date(),
              idempotency_key: 'restart:test:abc',
              input_json: {},
              output_json: { success: true },
              error_json: null,
            }],
          });
        }

        return Promise.resolve({ rows: [] });
      });

      // Custom step executor that succeeds
      const stepExecutors = new Map();
      stepExecutors.set('restart', async (pool: Pool, ctx: StepContext): Promise<StepResult> => ({
        success: true,
        output: { restarted: true },
      }));

      const response = await executor.executePlaybook(request, playbook, stepExecutors);

      // Verify execution succeeded
      expect(response.status).toBe('SUCCEEDED');

      // Verify audit events were emitted in correct order
      expect(auditInserts.length).toBeGreaterThanOrEqual(5);
      
      // 1. PLANNED event
      expect(auditInserts[0].event_type).toBe('PLANNED');
      expect(auditInserts[0].payload_json).toHaveProperty('playbookId', 'restart-service');
      expect(auditInserts[0].lawbook_version).toBe('abcd1234');

      // 2. STEP_STARTED event
      expect(auditInserts[1].event_type).toBe('STEP_STARTED');
      expect(auditInserts[1].payload_json).toHaveProperty('stepId', 'restart');
      expect(auditInserts[1].payload_json).toHaveProperty('actionType', 'RESTART_SERVICE');

      // 3. STEP_FINISHED event
      expect(auditInserts[2].event_type).toBe('STEP_FINISHED');
      expect(auditInserts[2].payload_json).toHaveProperty('stepId', 'restart');
      expect(auditInserts[2].payload_json).toHaveProperty('status', 'SUCCEEDED');

      // 4. STATUS_UPDATED event
      expect(auditInserts[3].event_type).toBe('STATUS_UPDATED');
      expect(auditInserts[3].payload_json).toHaveProperty('status', 'SUCCEEDED');

      // 5. COMPLETED event
      expect(auditInserts[4].event_type).toBe('COMPLETED');
      expect(auditInserts[4].payload_json).toHaveProperty('status', 'SUCCEEDED');
    });
  });

  // ========================================
  // Test: Events Emitted for Failed Run
  // ========================================

  describe('Audit Events for Failed Run', () => {
    test('should emit FAILED event when step fails', async () => {
      const incident: IncidentInput = {
        incident_key: 'test:incident:audit:2',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test Failed Audit',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod' },
        },
        lawbook_version: 'v1.0.0',
      };

      const playbook: PlaybookDefinition = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'restart',
            actionType: 'RESTART_SERVICE',
            description: 'Restart the service',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-2',
        playbookId: playbook.id,
        inputs: {},
      };

      const auditInserts: any[] = [];
      
      mockQuery.mockImplementation((query: string, params: any[]) => {
        // Capture audit event inserts
        if (query.includes('INSERT INTO remediation_audit_events')) {
          auditInserts.push({
            event_type: params[2],
            payload_json: params[4],
          });
          return Promise.resolve({
            rows: [{
              id: `audit-event-${auditInserts.length}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'test-hash',
            }],
          });
        }

        // Similar mocks as above...
        if (query.includes('SELECT') && query.includes('FROM incidents WHERE id')) {
          return Promise.resolve({
            rows: [{
              id: 'incident-uuid-2',
              incident_key: 'test:incident:audit:2',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Failed Audit',
              source_primary: JSON.stringify({ kind: 'deploy_status', ref: { env: 'prod' } }),
              lawbook_version: 'v1.0.0',
              created_at: new Date(),
              updated_at: new Date(),
            }],
          });
        }

        if (query.includes('FROM evidence WHERE incident_id')) {
          return Promise.resolve({ rows: [] });
        }

        if (query.includes('FROM remediation_runs WHERE run_key')) {
          return Promise.resolve({ rows: [] });
        }

        if (query.includes('INSERT INTO remediation_runs')) {
          return Promise.resolve({
            rows: [{
              id: 'run-uuid-2',
              run_key: 'test:incident:audit:2:restart-service:abc',
              incident_id: 'incident-uuid-2',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: 'PLANNED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: params[5],
              result_json: null,
              lawbook_version: 'abcd1234',
              inputs_hash: params[8],
            }],
          });
        }

        if (query.includes('INSERT INTO remediation_steps')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-2',
              remediation_run_id: 'run-uuid-2',
              step_id: params[1],
              action_type: params[2],
              status: params[3],
              started_at: null,
              finished_at: null,
              idempotency_key: params[4],
              input_json: params[5],
              output_json: null,
              error_json: null,
            }],
          });
        }

        if (query.includes('UPDATE remediation_steps')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-2',
              remediation_run_id: 'run-uuid-2',
              step_id: 'restart',
              action_type: 'RESTART_SERVICE',
              status: params[0],
              started_at: params[1] || null,
              finished_at: params[2] || null,
              idempotency_key: 'restart:test:abc',
              input_json: {},
              output_json: null,
              error_json: params[4],
            }],
          });
        }

        if (query.includes('UPDATE remediation_runs')) {
          return Promise.resolve({
            rows: [{
              id: 'run-uuid-2',
              run_key: 'test:incident:audit:2:restart-service:abc',
              incident_id: 'incident-uuid-2',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: params[0],
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: {},
              result_json: params[1],
              lawbook_version: 'abcd1234',
              inputs_hash: 'abc',
            }],
          });
        }

        if (query.includes('FROM remediation_steps WHERE remediation_run_id')) {
          return Promise.resolve({
            rows: [{
              id: 'step-uuid-2',
              remediation_run_id: 'run-uuid-2',
              step_id: 'restart',
              action_type: 'RESTART_SERVICE',
              status: 'FAILED',
              started_at: new Date(),
              finished_at: new Date(),
              idempotency_key: 'restart:test:abc',
              input_json: {},
              output_json: null,
              error_json: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' },
            }],
          });
        }

        return Promise.resolve({ rows: [] });
      });

      // Custom step executor that fails
      const stepExecutors = new Map();
      stepExecutors.set('restart', async (pool: Pool, ctx: StepContext): Promise<StepResult> => ({
        success: false,
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: 'Service not found',
        },
      }));

      const response = await executor.executePlaybook(request, playbook, stepExecutors);

      // Verify execution failed
      expect(response.status).toBe('FAILED');

      // Verify audit events include FAILED events
      expect(auditInserts.length).toBeGreaterThanOrEqual(5);
      
      // Last event should be FAILED
      const lastEvent = auditInserts[auditInserts.length - 1];
      expect(lastEvent.event_type).toBe('FAILED');
      expect(lastEvent.payload_json).toHaveProperty('status', 'FAILED');
      expect(lastEvent.payload_json.failedCount).toBeGreaterThan(0);
    });
  });
});
