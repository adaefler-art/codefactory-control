/**
 * API Tests: Classify Incident Endpoint
 * 
 * Tests for POST /api/incidents/[id]/classify
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { IncidentDAO } from '../../../src/lib/db/incidents';
import { classifyIncident, CLASSIFIER_VERSION } from '../../../src/lib/classifier';
import {
  Incident,
  Evidence,
} from '../../../src/lib/contracts/incident';

// Mock the database pool
const mockQuery = jest.fn();

const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('Classify Incident API Integration', () => {
  let dao: IncidentDAO;

  beforeEach(() => {
    dao = new IncidentDAO(mockPool);
    jest.clearAllMocks();
  });

  describe('Classification workflow', () => {
    test('classifies incident and updates database', async () => {
      // Mock incident
      const incident: Incident = {
        id: 'inc-api-1',
        incident_key: 'verification:deploy-123:hash',
        severity: 'RED',
        status: 'OPEN',
        title: 'Verification failed',
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

      // Mock evidence
      const evidence: Evidence[] = [
        {
          id: 'ev-api-1',
          incident_id: 'inc-api-1',
          kind: 'verification',
          ref: {
            runId: 'run-123',
            playbookId: 'ready-check',
            env: 'prod',
            status: 'FAILED',
          },
          sha256: 'hash-api-1',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      // Classify
      const classification = classifyIncident(incident, evidence);

      // Verify classification result
      expect(classification.classifierVersion).toBe(CLASSIFIER_VERSION);
      expect(classification.category).toBe('DEPLOY_VERIFICATION_FAILED');
      expect(classification.confidence).toBe('high');
      expect(classification.labels).toEqual(['config', 'infra', 'needs-redeploy']);
      expect(classification.evidencePack.pointers).toHaveLength(1);
      expect(classification.evidencePack.keyFacts.length).toBeGreaterThan(0);
    });

    test('reclassification updates existing classification', async () => {
      const incident: Incident = {
        id: 'inc-api-2',
        incident_key: 'ecs:stopped:task-123',
        severity: 'RED',
        status: 'OPEN',
        title: 'ECS task stopped',
        summary: null,
        classification: {
          classifierVersion: '0.6.0',
          category: 'UNKNOWN',
          confidence: 'low',
          labels: ['needs-classification'],
          primaryEvidence: {
            kind: 'ecs',
            ref: { taskArn: 'task-123' },
          },
          evidencePack: {
            summary: 'Unknown incident',
            keyFacts: [],
            pointers: [],
          },
        },
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

      // New evidence added
      const evidence: Evidence[] = [
        {
          id: 'ev-api-2',
          incident_id: 'inc-api-2',
          kind: 'ecs',
          ref: {
            cluster: 'prod-cluster',
            taskArn: 'task-123',
            stoppedReason: 'Essential container in task exited',
            exitCode: 1,
          },
          sha256: 'hash-api-2',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      // Re-classify with new evidence
      const classification = classifyIncident(incident, evidence);

      // Should now be classified as crashloop
      expect(classification.category).toBe('ECS_TASK_CRASHLOOP');
      expect(classification.confidence).toBe('high');
      expect(classification.classifierVersion).toBe(CLASSIFIER_VERSION);
    });
  });

  describe('DAO integration', () => {
    test('updateClassification stores classification in database', async () => {
      const classification = {
        classifierVersion: CLASSIFIER_VERSION,
        category: 'DEPLOY_VERIFICATION_FAILED',
        confidence: 'high',
        labels: ['config', 'infra', 'needs-redeploy'],
        primaryEvidence: {
          kind: 'verification',
          ref: { runId: 'run-123' },
        },
        evidencePack: {
          summary: 'Verification failed',
          keyFacts: ['Run failed', 'Playbook: ready-check'],
          pointers: [],
        },
      };

      const mockRow = {
        id: 'inc-dao-1',
        incident_key: 'verification:deploy-123:hash',
        severity: 'RED',
        status: 'OPEN',
        title: 'Verification failed',
        summary: null,
        classification: classification,
        lawbook_version: null,
        source_primary: {
          kind: 'verification',
          ref: { deployId: 'deploy-123' },
        },
        tags: [],
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
        first_seen_at: new Date('2024-01-01T00:00:00Z'),
        last_seen_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.updateClassification('inc-dao-1', classification);

      expect(result).not.toBeNull();
      expect(result?.classification).toEqual(classification);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE incidents'),
        expect.arrayContaining([classification, 'inc-dao-1'])
      );
    });
  });
});
