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

// Mock lawbook version helper (E79.3)
jest.mock('@/lib/lawbook-version-helper', () => ({
  requireActiveLawbookVersion: jest.fn().mockResolvedValue('2025-12-30.1'),
}));

// Mock lawbook database (E79.4)
jest.mock('@/lib/db/lawbook', () => ({
  getActiveLawbook: jest.fn().mockResolvedValue({
    success: true,
    data: {
      lawbook_json: {
        version: '0.7.0',
        lawbookId: 'AFU9-LAWBOOK',
        lawbookVersion: '2025-12-30.1',
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        github: { allowedRepos: [] },
        determinism: {
          requireDeterminismGate: false,
          requirePostDeployVerification: false,
        },
        remediation: {
          enabled: true,
          allowedPlaybooks: [
            'run-verification',
            'restart-service',
          ],
          allowedActions: [
            'RUN_VERIFICATION',
            'RESTART_SERVICE',
          ],
        },
        evidence: {
          requiredKindsByCategory: {},
        },
        enforcement: {
          requiredFields: ['lawbookVersion'],
          strictMode: true,
        },
        ui: {
          displayName: 'Test Lawbook',
        },
      },
    },
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

      // Track audit event inserts
      let auditInsertCount = 0;
      const auditInserts: any[] = [];

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'incident-uuid-1',
            incident_key: 'test:incident:audit:1',
            severity: 'RED',
            status: 'OPEN',
            title: 'Test Audit Trail',
            summary: null,
            classification: null,
            source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
            tags: [],
            lawbook_version: 'v1.0.0',
            created_at: new Date(),
            updated_at: new Date(),
            first_seen_at: new Date(),
            last_seen_at: new Date(),
          }],
        })
        // Mock evidence retrieval (empty)
        .mockResolvedValueOnce({ rows: [] })
        // Mock check for existing run (none found)
        .mockResolvedValueOnce({ rows: [] })
        // Mock run creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'run-uuid-1',
            run_key: 'test:incident:audit:1:restart-service:abc',
            incident_id: 'incident-uuid-1',
            playbook_id: 'restart-service',
            playbook_version: '1.0.0',
            status: 'PLANNED',
            created_at: new Date(),
            updated_at: new Date(),
            planned_json: {},
            result_json: null,
            lawbook_version: 'abcd1234',
            inputs_hash: 'abc',
          }],
        })
        // Mock PLANNED audit event insert
        .mockImplementationOnce((query: string, params: any[]) => {
          if (query.includes('INSERT INTO remediation_audit_events')) {
            auditInserts.push({ event_type: params[2], payload_json: params[4] });
            auditInsertCount++;
          }
          return Promise.resolve({
            rows: [{
              id: `audit-${auditInsertCount}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'hash',
            }],
          });
        })
        // Mock step creation
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-uuid-1',
            remediation_run_id: 'run-uuid-1',
            step_id: 'restart',
            action_type: 'RESTART_SERVICE',
            status: 'PLANNED',
            started_at: null,
            finished_at: null,
            idempotency_key: 'restart:test:abc',
            input_json: {},
            output_json: null,
            error_json: null,
          }],
        })
        // Mock STEP_STARTED audit event insert
        .mockImplementationOnce((query: string, params: any[]) => {
          if (query.includes('INSERT INTO remediation_audit_events')) {
            auditInserts.push({ event_type: params[2], payload_json: params[4] });
            auditInsertCount++;
          }
          return Promise.resolve({
            rows: [{
              id: `audit-${auditInsertCount}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'hash',
            }],
          });
        })
        // Mock step status update to RUNNING
        .mockResolvedValueOnce({
          rows: [{
            id: 'step-uuid-1',
            remediation_run_id: 'run-uuid-1',
            step_id: 'restart',
            action_type: 'RESTART_SERVICE',
            status: 'RUNNING',
            started_at: new Date(),
            finished_at: null,
            idempotency_key: 'restart:test:abc',
            input_json: {},
            output_json: null,
            error_json: null,
          }],
        })
        // Mock step status update to SUCCEEDED
        .mockResolvedValueOnce({
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
            output_json: { restarted: true },
            error_json: null,
          }],
        })
        // Mock STEP_FINISHED audit event insert
        .mockImplementationOnce((query: string, params: any[]) => {
          if (query.includes('INSERT INTO remediation_audit_events')) {
            auditInserts.push({ event_type: params[2], payload_json: params[4] });
            auditInsertCount++;
          }
          return Promise.resolve({
            rows: [{
              id: `audit-${auditInsertCount}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'hash',
            }],
          });
        })
        // Mock get steps for run
        .mockResolvedValueOnce({
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
            output_json: { restarted: true },
            error_json: null,
          }],
        })
        // Mock run status update
        .mockResolvedValueOnce({
          rows: [{
            id: 'run-uuid-1',
            run_key: 'test:incident:audit:1:restart-service:abc',
            incident_id: 'incident-uuid-1',
            playbook_id: 'restart-service',
            playbook_version: '1.0.0',
            status: 'SUCCEEDED',
            created_at: new Date(),
            updated_at: new Date(),
            planned_json: {},
            result_json: { totalSteps: 1, successCount: 1 },
            lawbook_version: 'abcd1234',
            inputs_hash: 'abc',
          }],
        })
        // Mock STATUS_UPDATED audit event insert
        .mockImplementationOnce((query: string, params: any[]) => {
          if (query.includes('INSERT INTO remediation_audit_events')) {
            auditInserts.push({ event_type: params[2], payload_json: params[4] });
            auditInsertCount++;
          }
          return Promise.resolve({
            rows: [{
              id: `audit-${auditInsertCount}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'hash',
            }],
          });
        })
        // Mock COMPLETED audit event insert
        .mockImplementationOnce((query: string, params: any[]) => {
          if (query.includes('INSERT INTO remediation_audit_events')) {
            auditInserts.push({ event_type: params[2], payload_json: params[4] });
            auditInsertCount++;
          }
          return Promise.resolve({
            rows: [{
              id: `audit-${auditInsertCount}`,
              remediation_run_id: params[0],
              incident_id: params[1],
              event_type: params[2],
              created_at: new Date(),
              lawbook_version: params[3],
              payload_json: params[4],
              payload_hash: 'hash',
            }],
          });
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
      expect(auditInserts.length).toBe(5);
      
      // 1. PLANNED event
      expect(auditInserts[0].event_type).toBe('PLANNED');
      expect(auditInserts[0].payload_json).toHaveProperty('playbookId', 'restart-service');

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
});
