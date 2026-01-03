/**
 * Remediation Playbook Executor Tests (E77.1 / I771)
 * 
 * Tests for remediation playbook framework:
 * - Deny-by-default lawbook gating
 * - Evidence gating (missing evidence → SKIPPED)
 * - Idempotency (same inputs → same run)
 * - Deterministic planning
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  PlaybookDefinition,
  ExecutePlaybookRequest,
  computeRunKey,
  computeInputsHash,
} from '@/lib/contracts/remediation-playbook';
import {
  IncidentInput,
  EvidenceInput,
} from '@/lib/contracts/incident';

// Mock the lawbook loader
jest.mock('@/lawbook/load', () => ({
  loadGuardrails: jest.fn().mockResolvedValue({
    hash: 'abcd1234567890',
    data: { version: 1, guardrails: [] },
  }),
}));

import { RemediationPlaybookExecutor } from '@/lib/remediation-executor';
import { RemediationPlaybookDAO } from '@/lib/db/remediation-playbooks';
import { IncidentDAO } from '@/lib/db/incidents';

// Mock the database pool
const mockQuery = jest.fn();
const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('RemediationPlaybookExecutor', () => {
  let executor: RemediationPlaybookExecutor;
  let dao: RemediationPlaybookDAO;
  let incidentDAO: IncidentDAO;

  beforeEach(() => {
    executor = new RemediationPlaybookExecutor(mockPool);
    dao = new RemediationPlaybookDAO(mockPool);
    incidentDAO = new IncidentDAO(mockPool);
    jest.clearAllMocks();
  });

  // ========================================
  // Test: Deny-by-default lawbook gating
  // ========================================

  describe('Lawbook Gating - Deny by Default', () => {
    test('should skip run when playbook is not in allowed list', async () => {
      const incident: IncidentInput = {
        incident_key: 'test:incident:1',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test Incident',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod' },
        },
        lawbook_version: 'v1.0.0',
      };

      const playbook: PlaybookDefinition = {
        id: 'unauthorized-playbook', // Not in allowed list
        version: '1.0.0',
        title: 'Unauthorized Playbook',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'step1',
            actionType: 'RESTART_SERVICE',
            description: 'Restart service',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
      };

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-uuid-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              summary: null,
              classification: null,
              lawbook_version: 'v1.0.0',
              source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
              tags: [],
              created_at: new Date(),
              updated_at: new Date(),
              first_seen_at: new Date(),
              last_seen_at: new Date(),
            },
          ],
        })
        // Mock evidence retrieval (empty)
        .mockResolvedValueOnce({ rows: [] })
        // Mock run creation (SKIPPED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-1',
              run_key: 'test:incident:1:unauthorized-playbook:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              incident_id: 'incident-uuid-1',
              playbook_id: 'unauthorized-playbook',
              playbook_version: '1.0.0',
              status: 'SKIPPED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: null,
              result_json: {
                skipReason: 'LAWBOOK_DENIED',
                message: "Playbook 'unauthorized-playbook' is not in allowed list",
              },
              lawbook_version: 'abcd1234',
              inputs_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        });

      const result = await executor.executePlaybook(request, playbook);

      expect(result.status).toBe('SKIPPED');
      expect(result.skipReason).toBe('LAWBOOK_DENIED');
      expect(result.message).toContain('not in allowed list');
    });

    test('should skip run when action type is denied', async () => {
      const playbook: PlaybookDefinition = {
        id: 'restart-service', // In allowed list
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'step1',
            actionType: 'ROLLBACK_DEPLOY', // Explicitly denied
            description: 'Rollback deploy',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
      };

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-uuid-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              summary: null,
              classification: null,
              lawbook_version: 'v1.0.0',
              source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
              tags: [],
              created_at: new Date(),
              updated_at: new Date(),
              first_seen_at: new Date(),
              last_seen_at: new Date(),
            },
          ],
        })
        // Mock evidence retrieval
        .mockResolvedValueOnce({ rows: [] })
        // Mock run creation (SKIPPED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-1',
              run_key: 'test:incident:1:restart-service:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              incident_id: 'incident-uuid-1',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: 'SKIPPED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: null,
              result_json: {
                skipReason: 'LAWBOOK_DENIED',
                message: "Action type 'ROLLBACK_DEPLOY' is explicitly denied",
              },
              lawbook_version: 'abcd1234',
              inputs_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        });

      const result = await executor.executePlaybook(request, playbook);

      expect(result.status).toBe('SKIPPED');
      expect(result.skipReason).toBe('LAWBOOK_DENIED');
      expect(result.message).toContain('explicitly denied');
    });
  });

  // ========================================
  // Test: Evidence gating
  // ========================================

  describe('Evidence Gating', () => {
    test('should skip run when required evidence is missing', async () => {
      const playbook: PlaybookDefinition = {
        id: 'run-verification',
        version: '1.0.0',
        title: 'Run Verification',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [
          {
            kind: 'verification',
            requiredFields: ['ref.reportHash'],
          },
        ],
        steps: [
          {
            stepId: 'step1',
            actionType: 'RUN_VERIFICATION',
            description: 'Run verification playbook',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
      };

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-uuid-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              summary: null,
              classification: null,
              lawbook_version: 'v1.0.0',
              source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
              tags: [],
              created_at: new Date(),
              updated_at: new Date(),
              first_seen_at: new Date(),
              last_seen_at: new Date(),
            },
          ],
        })
        // Mock evidence retrieval (no verification evidence)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'evidence-uuid-1',
              incident_id: 'incident-uuid-1',
              kind: 'runner',
              ref: { runId: 'run-123' },
              sha256: null,
              created_at: new Date(),
            },
          ],
        })
        // Mock run creation (SKIPPED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-1',
              run_key: 'test:incident:1:run-verification:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              incident_id: 'incident-uuid-1',
              playbook_id: 'run-verification',
              playbook_version: '1.0.0',
              status: 'SKIPPED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: null,
              result_json: {
                skipReason: 'EVIDENCE_MISSING',
                message: 'Required evidence not satisfied',
                missingEvidence: [
                  {
                    kind: 'verification',
                    requiredFields: ['ref.reportHash'],
                  },
                ],
              },
              lawbook_version: 'abcd1234',
              inputs_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        });

      const result = await executor.executePlaybook(request, playbook);

      expect(result.status).toBe('SKIPPED');
      expect(result.skipReason).toBe('EVIDENCE_MISSING');
      expect(result.message).toContain('Required evidence not satisfied');
    });

    test('should proceed when required evidence is present', async () => {
      const playbook: PlaybookDefinition = {
        id: 'run-verification',
        version: '1.0.0',
        title: 'Run Verification',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [
          {
            kind: 'verification',
            requiredFields: ['ref.reportHash'],
          },
        ],
        steps: [
          {
            stepId: 'step1',
            actionType: 'RUN_VERIFICATION',
            description: 'Run verification playbook',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
      };

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-uuid-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              summary: null,
              classification: null,
              lawbook_version: 'v1.0.0',
              source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
              tags: [],
              created_at: new Date(),
              updated_at: new Date(),
              first_seen_at: new Date(),
              last_seen_at: new Date(),
            },
          ],
        })
        // Mock evidence retrieval (with verification evidence)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'evidence-uuid-1',
              incident_id: 'incident-uuid-1',
              kind: 'verification',
              ref: { reportHash: 'hash-123', runId: 'run-123' },
              sha256: 'hash-123',
              created_at: new Date(),
            },
          ],
        })
        // Mock check for existing run (none)
        .mockResolvedValueOnce({ rows: [] })
        // Mock run creation (PLANNED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-1',
              run_key: 'test:incident:1:run-verification:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              incident_id: 'incident-uuid-1',
              playbook_id: 'run-verification',
              playbook_version: '1.0.0',
              status: 'PLANNED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: {
                playbookId: 'run-verification',
                playbookVersion: '1.0.0',
                steps: [
                  {
                    stepId: 'step1',
                    actionType: 'RUN_VERIFICATION',
                    resolvedInputs: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
                  },
                ],
                lawbookVersion: 'abcd1234',
                inputsHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              },
              result_json: null,
              lawbook_version: 'abcd1234',
              inputs_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        })
        // Mock step creation
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'step1',
              action_type: 'RUN_VERIFICATION',
              status: 'PLANNED',
              started_at: null,
              finished_at: null,
              idempotency_key: 'RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              input_json: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
              output_json: null,
              error_json: null,
            },
          ],
        })
        // Mock step status update (RUNNING)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'step1',
              action_type: 'RUN_VERIFICATION',
              status: 'RUNNING',
              started_at: new Date(),
              finished_at: null,
              idempotency_key: 'RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              input_json: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
              output_json: null,
              error_json: null,
            },
          ],
        })
        // Mock step status update (SUCCEEDED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'step1',
              action_type: 'RUN_VERIFICATION',
              status: 'SUCCEEDED',
              started_at: new Date(),
              finished_at: new Date(),
              idempotency_key: 'RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              input_json: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
              output_json: { stepId: 'step1', actionType: 'RUN_VERIFICATION', executed: true },
              error_json: null,
            },
          ],
        })
        // Mock get steps for run
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-1',
              step_id: 'step1',
              action_type: 'RUN_VERIFICATION',
              status: 'SUCCEEDED',
              started_at: new Date(),
              finished_at: new Date(),
              idempotency_key: 'RUN_VERIFICATION:test:incident:1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              input_json: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
              output_json: { stepId: 'step1', actionType: 'RUN_VERIFICATION', executed: true },
              error_json: null,
            },
          ],
        })
        // Mock run status update (SUCCEEDED)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-1',
              run_key: 'test:incident:1:run-verification:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              incident_id: 'incident-uuid-1',
              playbook_id: 'run-verification',
              playbook_version: '1.0.0',
              status: 'SUCCEEDED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: {
                playbookId: 'run-verification',
                playbookVersion: '1.0.0',
                steps: [
                  {
                    stepId: 'step1',
                    actionType: 'RUN_VERIFICATION',
                    resolvedInputs: { incidentId: 'incident-uuid-1', incidentKey: 'test:incident:1' },
                  },
                ],
                lawbookVersion: 'abcd1234',
                inputsHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              },
              result_json: { totalSteps: 1, successCount: 1, failedCount: 0, durationMs: 100 },
              lawbook_version: 'abcd1234',
              inputs_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            },
          ],
        });

      const result = await executor.executePlaybook(request, playbook);

      expect(result.status).toBe('SUCCEEDED');
      expect(result.steps).toHaveLength(1);
      expect(result.steps![0].status).toBe('SUCCEEDED');
    });
  });

  // ========================================
  // Test: Idempotency
  // ========================================

  describe('Idempotency', () => {
    test('should return existing run when invoked with same inputs', async () => {
      const playbook: PlaybookDefinition = {
        id: 'restart-service',
        version: '1.0.0',
        title: 'Restart Service',
        applicableCategories: ['DEPLOY_VERIFICATION_FAILED'],
        requiredEvidence: [],
        steps: [
          {
            stepId: 'step1',
            actionType: 'RESTART_SERVICE',
            description: 'Restart service',
          },
        ],
      };

      const request: ExecutePlaybookRequest = {
        incidentId: 'incident-uuid-1',
        playbookId: playbook.id,
        inputs: { service: 'prod-api' },
      };

      // Mock incident retrieval
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'incident-uuid-1',
              incident_key: 'test:incident:1',
              severity: 'RED',
              status: 'OPEN',
              title: 'Test Incident',
              summary: null,
              classification: null,
              lawbook_version: 'v1.0.0',
              source_primary: { kind: 'deploy_status', ref: { env: 'prod' } },
              tags: [],
              created_at: new Date(),
              updated_at: new Date(),
              first_seen_at: new Date(),
              last_seen_at: new Date(),
            },
          ],
        })
        // Mock evidence retrieval
        .mockResolvedValueOnce({ rows: [] })
        // Mock check for existing run (found)
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'run-uuid-existing',
              run_key: 'test:incident:1:restart-service:' + computeInputsHash({ service: 'prod-api' }),
              incident_id: 'incident-uuid-1',
              playbook_id: 'restart-service',
              playbook_version: '1.0.0',
              status: 'SUCCEEDED',
              created_at: new Date(),
              updated_at: new Date(),
              planned_json: {
                playbookId: 'restart-service',
                playbookVersion: '1.0.0',
                steps: [
                  {
                    stepId: 'step1',
                    actionType: 'RESTART_SERVICE',
                    resolvedInputs: { incidentId: 'incident-uuid-1', service: 'prod-api' },
                  },
                ],
                lawbookVersion: 'abcd1234',
                inputsHash: computeInputsHash({ service: 'prod-api' }),
              },
              result_json: { totalSteps: 1, successCount: 1, failedCount: 0 },
              lawbook_version: 'abcd1234',
              inputs_hash: computeInputsHash({ service: 'prod-api' }),
            },
          ],
        })
        // Mock get steps for existing run
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'step-uuid-1',
              remediation_run_id: 'run-uuid-existing',
              step_id: 'step1',
              action_type: 'RESTART_SERVICE',
              status: 'SUCCEEDED',
              started_at: new Date(),
              finished_at: new Date(),
              idempotency_key: 'RESTART_SERVICE:test:incident:1:' + computeInputsHash({ service: 'prod-api' }),
              input_json: { incidentId: 'incident-uuid-1', service: 'prod-api' },
              output_json: { stepId: 'step1', actionType: 'RESTART_SERVICE', executed: true },
              error_json: null,
            },
          ],
        });

      const result = await executor.executePlaybook(request, playbook);

      expect(result.status).toBe('SUCCEEDED');
      expect(result.runId).toBe('run-uuid-existing');
      expect(result.message).toContain('Existing run returned');
      expect(result.steps).toHaveLength(1);
    });
  });

  // ========================================
  // Test: Deterministic planning
  // ========================================

  describe('Deterministic Planning', () => {
    test('should generate same plan JSON and inputs_hash for same inputs', () => {
      const inputs1 = { service: 'prod-api', region: 'us-east-1' };
      const inputs2 = { region: 'us-east-1', service: 'prod-api' }; // Different order

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).toBe(hash2);
    });

    test('should generate different inputs_hash for different inputs', () => {
      const inputs1 = { service: 'prod-api' };
      const inputs2 = { service: 'stage-api' };

      const hash1 = computeInputsHash(inputs1);
      const hash2 = computeInputsHash(inputs2);

      expect(hash1).not.toBe(hash2);
    });
  });
});
