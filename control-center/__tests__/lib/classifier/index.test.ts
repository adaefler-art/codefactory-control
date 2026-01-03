/**
 * Incident Classifier Tests (E76.3 / I763)
 * 
 * Tests for rule-based deterministic classifier:
 * - Each classification rule
 * - Deterministic output (labels sorted, keyFacts sorted)
 * - Reclassification support
 * 
 * @jest-environment node
 */

import { classifyIncident, CLASSIFIER_VERSION } from '../../../src/lib/classifier';
import {
  Incident,
  Evidence,
  Classification,
} from '../../../src/lib/contracts/incident';

describe('Incident Classifier v1', () => {
  describe('Rule 1: DEPLOY_VERIFICATION_FAILED', () => {
    test('classifies verification failure with FAILED status', () => {
      const incident: Incident = {
        id: 'inc-1',
        incident_key: 'verification:deploy-123:hash-abc',
        severity: 'RED',
        status: 'OPEN',
        title: 'Verification failed for deploy-123',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'verification',
          ref: { deployId: 'deploy-123' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-1',
          incident_id: 'inc-1',
          kind: 'verification',
          ref: {
            runId: 'run-123',
            playbookId: 'ready-check',
            env: 'prod',
            status: 'FAILED',
            completedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-1',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.classifierVersion).toBe(CLASSIFIER_VERSION);
      expect(classification.category).toBe('DEPLOY_VERIFICATION_FAILED');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['config', 'infra', 'needs-redeploy']);
      expect(classification.primaryEvidence.kind).toBe('verification');
      expect(classification.evidencePack.summary).toContain('DEPLOY_VERIFICATION_FAILED');
    });

    test('classifies verification failure with TIMEOUT status', () => {
      const incident: Incident = {
        id: 'inc-2',
        incident_key: 'verification:deploy-456:hash-def',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'Verification timeout for deploy-456',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'verification',
          ref: { deployId: 'deploy-456' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-2',
          incident_id: 'inc-2',
          kind: 'verification',
          ref: {
            runId: 'run-456',
            playbookId: 'health-check',
            env: 'staging',
            status: 'TIMEOUT',
          },
          sha256: 'hash-2',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('DEPLOY_VERIFICATION_FAILED');
      expect(classification.confidence).toBe('high');
    });
  });

  describe('Rule 2: ALB_TARGET_UNHEALTHY', () => {
    test('classifies ALB target unhealthy', () => {
      const incident: Incident = {
        id: 'inc-3',
        incident_key: 'alb:unhealthy:target-123',
        severity: 'RED',
        status: 'OPEN',
        title: 'ALB target unhealthy',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'alb',
          ref: { targetId: 'target-123' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-3',
          incident_id: 'inc-3',
          kind: 'alb',
          ref: {
            targetId: 'target-123',
            targetHealth: 'unhealthy',
            reason: 'Connection timeout',
          },
          sha256: 'hash-3',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('ALB_TARGET_UNHEALTHY');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['alb', 'infra', 'needs-investigation']);
    });
  });

  describe('Rule 3: ECS_TASK_CRASHLOOP', () => {
    test('classifies ECS task crashloop', () => {
      const incident: Incident = {
        id: 'inc-4',
        incident_key: 'ecs:stopped:task-123',
        severity: 'RED',
        status: 'OPEN',
        title: 'ECS task stopped',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-123' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-4',
          incident_id: 'inc-4',
          kind: 'ecs',
          ref: {
            cluster: 'prod-cluster',
            taskArn: 'task-123',
            stoppedReason: 'Essential container in task exited',
            exitCode: 1,
            stoppedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-4',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('ECS_TASK_CRASHLOOP');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['code', 'crashloop', 'ecs', 'needs-investigation']);
    });

    test('does not match if exitCode is 0', () => {
      const incident: Incident = {
        id: 'inc-5',
        incident_key: 'ecs:stopped:task-456',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'ECS task stopped gracefully',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-456' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-5',
          incident_id: 'inc-5',
          kind: 'ecs',
          ref: {
            cluster: 'prod-cluster',
            taskArn: 'task-456',
            stoppedReason: 'Essential container in task exited',
            exitCode: 0,
          },
          sha256: 'hash-5',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      // Should fall through to UNKNOWN
      expect(classification.category).toBe('UNKNOWN');
    });
  });

  describe('Rule 4: ECS_IMAGE_PULL_FAILED', () => {
    test('classifies CannotPullContainerError', () => {
      const incident: Incident = {
        id: 'inc-6',
        incident_key: 'ecs:stopped:task-789',
        severity: 'RED',
        status: 'OPEN',
        title: 'ECS task image pull failed',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-789' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-6',
          incident_id: 'inc-6',
          kind: 'ecs',
          ref: {
            cluster: 'prod-cluster',
            taskArn: 'task-789',
            stoppedReason: 'CannotPullContainerError: Error response from daemon',
            stoppedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-6',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('ECS_IMAGE_PULL_FAILED');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['ecs', 'image', 'infra', 'needs-redeploy']);
    });

    test('classifies generic pull image error', () => {
      const incident: Incident = {
        id: 'inc-7',
        incident_key: 'ecs:stopped:task-abc',
        severity: 'RED',
        status: 'OPEN',
        title: 'ECS task pull image error',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-abc' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-7',
          incident_id: 'inc-7',
          kind: 'ecs',
          ref: {
            cluster: 'staging-cluster',
            taskArn: 'task-abc',
            stoppedReason: 'Failed to pull image from ECR',
          },
          sha256: 'hash-7',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('ECS_IMAGE_PULL_FAILED');
    });
  });

  describe('Rule 5: IAM_POLICY_VALIDATION_FAILED', () => {
    test('classifies IAM validation failure by step name', () => {
      const incident: Incident = {
        id: 'inc-8',
        incident_key: 'runner:run-123:validate-iam:failure',
        severity: 'RED',
        status: 'OPEN',
        title: 'IAM validation failed',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'runner',
          ref: { runId: 'run-123' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-8',
          incident_id: 'inc-8',
          kind: 'runner',
          ref: {
            runId: 'run-123',
            stepName: 'validate-iam-policies',
            conclusion: 'failure',
            completedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-8',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('IAM_POLICY_VALIDATION_FAILED');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['iam', 'infra', 'needs-fix', 'policy']);
    });

    test('classifies IAM validation failure by message', () => {
      const incident: Incident = {
        id: 'inc-9',
        incident_key: 'runner:run-456:deploy:failure',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy failed with IAM error',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'runner',
          ref: { runId: 'run-456' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-9',
          incident_id: 'inc-9',
          kind: 'github_run',
          ref: {
            runId: 'run-456',
            stepName: 'deploy',
            conclusion: 'failure',
            message: 'IAM policy validation failed: missing permissions',
          },
          sha256: 'hash-9',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('IAM_POLICY_VALIDATION_FAILED');
    });
  });

  describe('Rule 6: RUNNER_WORKFLOW_FAILED', () => {
    test('classifies runner workflow failure', () => {
      const incident: Incident = {
        id: 'inc-10',
        incident_key: 'runner:run-789:test:failure',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'Test workflow failed',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'runner',
          ref: { runId: 'run-789' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-10',
          incident_id: 'inc-10',
          kind: 'github_run',
          ref: {
            runId: 'run-789',
            runUrl: 'https://github.com/org/repo/actions/runs/789',
            stepName: 'run-tests',
            conclusion: 'failure',
            completedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-10',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('RUNNER_WORKFLOW_FAILED');
      expect(classification.confidence).toBe('medium');
      expect(classification.labels).toEqual(['ci', 'needs-investigation', 'runner']);
    });
  });

  describe('Rule 7: UNKNOWN (fallback)', () => {
    test('classifies as UNKNOWN when no rules match', () => {
      const incident: Incident = {
        id: 'inc-11',
        incident_key: 'custom:unknown:event',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'Unknown incident type',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod', deployId: 'deploy-999' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-11',
          incident_id: 'inc-11',
          kind: 'deploy_status',
          ref: {
            env: 'prod',
            status: 'YELLOW',
          },
          sha256: 'hash-11',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.category).toBe('UNKNOWN');
      expect(classification.confidence).toBe('low');
      expect(classification.labels).toEqual(['needs-classification']);
    });
  });

  describe('Deterministic output', () => {
    test('labels are sorted alphabetically', () => {
      const incident: Incident = {
        id: 'inc-12',
        incident_key: 'ecs:stopped:task-det',
        severity: 'RED',
        status: 'OPEN',
        title: 'ECS task crashloop',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-det' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-12',
          incident_id: 'inc-12',
          kind: 'ecs',
          ref: {
            cluster: 'prod',
            taskArn: 'task-det',
            stoppedReason: 'Essential container in task exited',
            exitCode: 1,
          },
          sha256: 'hash-12',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      // Expected labels: ["code", "ecs", "crashloop", "needs-investigation"]
      // Should be sorted alphabetically
      expect(classification.labels).toEqual(['code', 'crashloop', 'ecs', 'needs-investigation']);
    });

    test('keyFacts are sorted alphabetically', () => {
      const incident: Incident = {
        id: 'inc-13',
        incident_key: 'verification:deploy-det:hash',
        severity: 'RED',
        status: 'OPEN',
        title: 'Verification failed',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'verification',
          ref: { deployId: 'deploy-det' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-13',
          incident_id: 'inc-13',
          kind: 'verification',
          ref: {
            runId: 'run-det',
            playbookId: 'ready-check',
            env: 'prod',
            status: 'FAILED',
            completedAt: '2024-01-01T00:05:00Z',
          },
          sha256: 'hash-13',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      // keyFacts should be sorted alphabetically
      const sortedKeyFacts = [...classification.evidencePack.keyFacts].sort();
      expect(classification.evidencePack.keyFacts).toEqual(sortedKeyFacts);
    });

    test('same incident and evidence produces same classification', () => {
      const incident: Incident = {
        id: 'inc-14',
        incident_key: 'runner:run-det:test:failure',
        severity: 'YELLOW',
        status: 'OPEN',
        title: 'Test failed',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'runner',
          ref: { runId: 'run-det' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-14',
          incident_id: 'inc-14',
          kind: 'github_run',
          ref: {
            runId: 'run-det',
            stepName: 'test',
            conclusion: 'failure',
          },
          sha256: 'hash-14',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification1 = classifyIncident(incident, evidence);
      const classification2 = classifyIncident(incident, evidence);

      expect(classification1).toEqual(classification2);
    });
  });

  describe('Evidence pack', () => {
    test('includes all evidence pointers', () => {
      const incident: Incident = {
        id: 'inc-15',
        incident_key: 'ecs:stopped:task-multi',
        severity: 'RED',
        status: 'OPEN',
        title: 'Multiple evidence sources',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-multi' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-15a',
          incident_id: 'inc-15',
          kind: 'ecs',
          ref: {
            cluster: 'prod',
            taskArn: 'task-multi',
            stoppedReason: 'Essential container in task exited',
            exitCode: 1,
          },
          sha256: 'hash-15a',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'ev-15b',
          incident_id: 'inc-15',
          kind: 'alb',
          ref: {
            targetId: 'target-multi',
            targetHealth: 'unhealthy',
          },
          sha256: 'hash-15b',
          created_at: '2024-01-01T00:01:00Z',
        },
      ];

      const classification = classifyIncident(incident, evidence);

      expect(classification.evidencePack.pointers).toHaveLength(2);
      // Pointers should be sorted by kind (alb < ecs)
      expect(classification.evidencePack.pointers[0].kind).toBe('alb');
      expect(classification.evidencePack.pointers[1].kind).toBe('ecs');
    });
  });

  describe('Classification hash and idempotency', () => {
    test('computes classification hash deterministically', () => {
      const { computeClassificationHash } = require('../../../src/lib/classifier');
      
      const incident: Incident = {
        id: 'inc-hash-1',
        incident_key: 'test:hash',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test incident',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'verification',
          ref: { deployId: 'deploy-123' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence: Evidence[] = [
        {
          id: 'ev-hash-1',
          incident_id: 'inc-hash-1',
          kind: 'verification',
          ref: {
            runId: 'run-123',
            status: 'FAILED',
          },
          sha256: 'hash-1',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification1 = classifyIncident(incident, evidence);
      const classification2 = classifyIncident(incident, evidence);

      const hash1 = computeClassificationHash(classification1);
      const hash2 = computeClassificationHash(classification2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA256 hex digest
    });

    test('different classification produces different hash', () => {
      const { computeClassificationHash } = require('../../../src/lib/classifier');
      
      const incident1: Incident = {
        id: 'inc-hash-2',
        incident_key: 'test:hash:2',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test incident',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-1' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      const evidence1: Evidence[] = [
        {
          id: 'ev-hash-2a',
          incident_id: 'inc-hash-2',
          kind: 'ecs',
          ref: {
            cluster: 'prod',
            taskArn: 'task-1',
            stoppedReason: 'Essential container in task exited',
            exitCode: 1,
          },
          sha256: 'hash-2a',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const evidence2: Evidence[] = [
        {
          id: 'ev-hash-2b',
          incident_id: 'inc-hash-2',
          kind: 'ecs',
          ref: {
            cluster: 'prod',
            taskArn: 'task-1',
            stoppedReason: 'CannotPullContainerError',
          },
          sha256: 'hash-2b',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification1 = classifyIncident(incident1, evidence1);
      const classification2 = classifyIncident(incident1, evidence2);

      const hash1 = computeClassificationHash(classification1);
      const hash2 = computeClassificationHash(classification2);

      expect(hash1).not.toBe(hash2);
      expect(classification1.category).toBe('ECS_TASK_CRASHLOOP');
      expect(classification2.category).toBe('ECS_IMAGE_PULL_FAILED');
    });

    test('evidence order does not affect classification hash', () => {
      const { computeClassificationHash } = require('../../../src/lib/classifier');
      
      const incident: Incident = {
        id: 'inc-hash-3',
        incident_key: 'test:hash:3',
        severity: 'RED',
        status: 'OPEN',
        title: 'Test incident',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'ecs',
          ref: { taskArn: 'task-multi' },
        },
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-01T00:00:00Z',
      };

      // Evidence in different order
      const evidence1: Evidence[] = [
        {
          id: 'ev1',
          incident_id: 'inc-hash-3',
          kind: 'ecs',
          ref: { cluster: 'prod', taskArn: 'task-multi', exitCode: 1, stoppedReason: 'Essential container in task exited' },
          sha256: 'hash-ecs',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'ev2',
          incident_id: 'inc-hash-3',
          kind: 'alb',
          ref: { targetId: 'target-1' },
          sha256: 'hash-alb',
          created_at: '2024-01-01T00:01:00Z',
        },
      ];

      const evidence2: Evidence[] = [
        {
          id: 'ev2',
          incident_id: 'inc-hash-3',
          kind: 'alb',
          ref: { targetId: 'target-1' },
          sha256: 'hash-alb',
          created_at: '2024-01-01T00:01:00Z',
        },
        {
          id: 'ev1',
          incident_id: 'inc-hash-3',
          kind: 'ecs',
          ref: { cluster: 'prod', taskArn: 'task-multi', exitCode: 1, stoppedReason: 'Essential container in task exited' },
          sha256: 'hash-ecs',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      const classification1 = classifyIncident(incident, evidence1);
      const classification2 = classifyIncident(incident, evidence2);

      const hash1 = computeClassificationHash(classification1);
      const hash2 = computeClassificationHash(classification2);

      expect(hash1).toBe(hash2);
      // Verify pointers are sorted
      expect(classification1.evidencePack.pointers[0].kind).toBe('alb');
      expect(classification1.evidencePack.pointers[1].kind).toBe('ecs');
      expect(classification2.evidencePack.pointers[0].kind).toBe('alb');
      expect(classification2.evidencePack.pointers[1].kind).toBe('ecs');
    });
  });
});
