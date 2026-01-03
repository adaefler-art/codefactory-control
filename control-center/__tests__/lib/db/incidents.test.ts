/**
 * Incident DAO Tests
 * 
 * Tests for Incident schema persistence layer:
 * - Idempotent upsert by incident_key
 * - Idempotent evidence addition
 * - Deterministic incident ordering
 * - Evidence deduplication via sha256
 * 
 * Reference: I761 (E76.1 - Incident Schema)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { IncidentDAO } from '../../../src/lib/db/incidents';
import {
  IncidentInput,
  EvidenceInput,
  LinkInput,
  EventInput,
  generateDeployStatusIncidentKey,
  generateVerificationIncidentKey,
  generateEcsStoppedIncidentKey,
  generateRunnerIncidentKey,
} from '../../../src/lib/contracts/incident';

// Mock the database pool
const mockQuery = jest.fn();

const mockPool = {
  query: mockQuery,
} as unknown as Pool;

describe('IncidentDAO', () => {
  let dao: IncidentDAO;

  beforeEach(() => {
    dao = new IncidentDAO(mockPool);
    jest.clearAllMocks();
  });

  describe('upsertIncidentByKey', () => {
    test('creates new incident on first insert', async () => {
      const input: IncidentInput = {
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy status RED in prod',
        summary: 'Deployment deploy-123 failed health checks',
        lawbook_version: 'v1.0.0',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod', deployId: 'deploy-123' },
        },
        tags: ['deploy', 'prod'],
      };

      const mockRow = {
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy status RED in prod',
        summary: 'Deployment deploy-123 failed health checks',
        classification: null,
        lawbook_version: 'v1.0.0',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod', deployId: 'deploy-123' },
        },
        tags: ['deploy', 'prod'],
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
        first_seen_at: new Date('2024-01-01T00:00:00Z'),
        last_seen_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertIncidentByKey(input);

      expect(result.id).toBe('incident-uuid-1');
      expect(result.incident_key).toBe('deploy_status:prod:deploy-123:2024-01-01T00:00:00Z');
      expect(result.severity).toBe('RED');
      expect(result.status).toBe('OPEN');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO incidents'),
        expect.arrayContaining(['deploy_status:prod:deploy-123:2024-01-01T00:00:00Z', 'RED', 'OPEN'])
      );
    });

    test('updates existing incident on conflict (idempotent)', async () => {
      const input: IncidentInput = {
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy status RED in prod (updated)',
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod', deployId: 'deploy-123' },
        },
        tags: ['deploy', 'prod'],
      };

      const mockRow = {
        id: 'incident-uuid-1',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-01T00:00:00Z',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy status RED in prod (updated)',
        summary: null,
        classification: null,
        lawbook_version: null,
        source_primary: {
          kind: 'deploy_status',
          ref: { env: 'prod', deployId: 'deploy-123' },
        },
        tags: ['deploy', 'prod'],
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:05:00Z'),
        first_seen_at: new Date('2024-01-01T00:00:00Z'),
        last_seen_at: new Date('2024-01-01T00:05:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertIncidentByKey(input);

      expect(result.id).toBe('incident-uuid-1');
      expect(result.title).toBe('Deploy status RED in prod (updated)');
      expect(result.first_seen_at).toBe('2024-01-01T00:00:00.000Z');
      expect(result.last_seen_at).toBe('2024-01-01T00:05:00.000Z');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (incident_key)'),
        expect.any(Array)
      );
    });
  });

  describe('addEvidence', () => {
    test('adds new evidence', async () => {
      const evidence: EvidenceInput[] = [
        {
          incident_id: 'incident-uuid-1',
          kind: 'runner',
          ref: { runId: 'run-123', step: 'deploy' },
          sha256: 'abc123',
        },
      ];

      const mockRow = {
        id: 'evidence-uuid-1',
        incident_id: 'incident-uuid-1',
        kind: 'runner',
        ref: { runId: 'run-123', step: 'deploy' },
        sha256: 'abc123',
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.addEvidence(evidence);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('runner');
      expect(result[0].sha256).toBe('abc123');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO incident_evidence'),
        expect.arrayContaining(['incident-uuid-1', 'runner', { runId: 'run-123', step: 'deploy' }, 'abc123'])
      );
    });

    test('deduplicates evidence with same sha256 (idempotent)', async () => {
      const evidence: EvidenceInput[] = [
        {
          incident_id: 'incident-uuid-1',
          kind: 'runner',
          ref: { runId: 'run-123', step: 'deploy' },
          sha256: 'abc123',
        },
      ];

      // First call: INSERT returns no rows (conflict)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Second call: SELECT existing evidence
      const existingRow = {
        id: 'evidence-uuid-existing',
        incident_id: 'incident-uuid-1',
        kind: 'runner',
        ref: { runId: 'run-123', step: 'deploy' },
        sha256: 'abc123',
        created_at: new Date('2024-01-01T00:00:00Z'),
      };
      mockQuery.mockResolvedValueOnce({ rows: [existingRow] });

      const result = await dao.addEvidence(evidence);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('evidence-uuid-existing');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array)
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT'),
        expect.arrayContaining(['incident-uuid-1', 'runner', 'abc123'])
      );
    });

    test('allows multiple evidence entries with null sha256', async () => {
      const evidence1: EvidenceInput[] = [
        {
          incident_id: 'incident-uuid-1',
          kind: 'log_pointer',
          ref: { logGroup: '/aws/ecs/prod', logStream: 'stream-1' },
          sha256: null,
        },
      ];

      const mockRow1 = {
        id: 'evidence-uuid-1',
        incident_id: 'incident-uuid-1',
        kind: 'log_pointer',
        ref: { logGroup: '/aws/ecs/prod', logStream: 'stream-1' },
        sha256: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRow1] });

      const result1 = await dao.addEvidence(evidence1);
      expect(result1).toHaveLength(1);

      // Second evidence with null sha256 should also succeed
      const evidence2: EvidenceInput[] = [
        {
          incident_id: 'incident-uuid-1',
          kind: 'log_pointer',
          ref: { logGroup: '/aws/ecs/prod', logStream: 'stream-2' },
          sha256: null,
        },
      ];

      const mockRow2 = {
        id: 'evidence-uuid-2',
        incident_id: 'incident-uuid-1',
        kind: 'log_pointer',
        ref: { logGroup: '/aws/ecs/prod', logStream: 'stream-2' },
        sha256: null,
        created_at: new Date('2024-01-01T00:01:00Z'),
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRow2] });

      const result2 = await dao.addEvidence(evidence2);
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('evidence-uuid-2');
    });
  });

  describe('listIncidents', () => {
    test('returns incidents in deterministic order (last_seen_at DESC, id ASC)', async () => {
      const mockRows = [
        {
          id: 'incident-uuid-2',
          incident_key: 'key-2',
          severity: 'YELLOW',
          status: 'OPEN',
          title: 'Incident 2',
          summary: null,
          classification: null,
          lawbook_version: null,
          source_primary: { kind: 'deploy_status', ref: {} },
          tags: [],
          created_at: new Date('2024-01-01T00:00:00Z'),
          updated_at: new Date('2024-01-01T00:00:00Z'),
          first_seen_at: new Date('2024-01-01T00:00:00Z'),
          last_seen_at: new Date('2024-01-01T00:05:00Z'),
        },
        {
          id: 'incident-uuid-1',
          incident_key: 'key-1',
          severity: 'RED',
          status: 'OPEN',
          title: 'Incident 1',
          summary: null,
          classification: null,
          lawbook_version: null,
          source_primary: { kind: 'deploy_status', ref: {} },
          tags: [],
          created_at: new Date('2024-01-01T00:00:00Z'),
          updated_at: new Date('2024-01-01T00:00:00Z'),
          first_seen_at: new Date('2024-01-01T00:00:00Z'),
          last_seen_at: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await dao.listIncidents();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('incident-uuid-2'); // More recent last_seen_at
      expect(result[1].id).toBe('incident-uuid-1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY last_seen_at DESC, id ASC'),
        expect.any(Array)
      );
    });

    test('filters by status', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await dao.listIncidents({ status: 'OPEN', limit: 100, offset: 0 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND status = $1'),
        expect.arrayContaining(['OPEN', 100])
      );
    });

    test('filters by severity', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await dao.listIncidents({ severity: 'RED', limit: 100, offset: 0 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('AND severity = $1'),
        expect.arrayContaining(['RED', 100])
      );
    });
  });

  describe('incident_key helpers', () => {
    test('generateDeployStatusIncidentKey', () => {
      const key = generateDeployStatusIncidentKey('prod', 'deploy-123', '2024-01-01T00:00:00Z');
      expect(key).toBe('deploy_status:prod:deploy-123:2024-01-01T00:00:00Z');
    });

    test('generateVerificationIncidentKey', () => {
      const key = generateVerificationIncidentKey('deploy-123', 'hash-abc');
      expect(key).toBe('verification:deploy-123:hash-abc');
    });

    test('generateEcsStoppedIncidentKey', () => {
      const key = generateEcsStoppedIncidentKey('prod-cluster', 'arn:task-123', '2024-01-01T00:00:00Z');
      expect(key).toBe('ecs_stopped:prod-cluster:arn:task-123:2024-01-01T00:00:00Z');
    });

    test('generateRunnerIncidentKey', () => {
      const key = generateRunnerIncidentKey('run-123', 'deploy', 'failure');
      expect(key).toBe('runner:run-123:deploy:failure');
    });
  });

  describe('createLink', () => {
    test('creates new link', async () => {
      const link: LinkInput = {
        incident_id: 'incident-uuid-1',
        timeline_node_id: 'node-uuid-1',
        link_type: 'TRIGGERED_BY',
      };

      const mockRow = {
        id: 'link-uuid-1',
        incident_id: 'incident-uuid-1',
        timeline_node_id: 'node-uuid-1',
        link_type: 'TRIGGERED_BY',
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.createLink(link);

      expect(result.id).toBe('link-uuid-1');
      expect(result.link_type).toBe('TRIGGERED_BY');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO incident_links'),
        expect.arrayContaining(['incident-uuid-1', 'node-uuid-1', 'TRIGGERED_BY'])
      );
    });

    test('returns existing link on conflict (idempotent)', async () => {
      const link: LinkInput = {
        incident_id: 'incident-uuid-1',
        timeline_node_id: 'node-uuid-1',
        link_type: 'TRIGGERED_BY',
      };

      // First call: INSERT returns no rows (conflict)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      // Second call: SELECT existing link
      const existingRow = {
        id: 'link-uuid-existing',
        incident_id: 'incident-uuid-1',
        timeline_node_id: 'node-uuid-1',
        link_type: 'TRIGGERED_BY',
        created_at: new Date('2024-01-01T00:00:00Z'),
      };
      mockQuery.mockResolvedValueOnce({ rows: [existingRow] });

      const result = await dao.createLink(link);

      expect(result.id).toBe('link-uuid-existing');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('createEvent', () => {
    test('creates incident event', async () => {
      const event: EventInput = {
        incident_id: 'incident-uuid-1',
        event_type: 'CREATED',
        payload: { source: 'deploy_monitor' },
      };

      const mockRow = {
        id: 'event-uuid-1',
        incident_id: 'incident-uuid-1',
        event_type: 'CREATED',
        payload: { source: 'deploy_monitor' },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.createEvent(event);

      expect(result.id).toBe('event-uuid-1');
      expect(result.event_type).toBe('CREATED');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO incident_events'),
        expect.arrayContaining(['incident-uuid-1', 'CREATED', { source: 'deploy_monitor' }])
      );
    });
  });

  describe('getEvents', () => {
    test('returns events in deterministic order (created_at DESC, id DESC)', async () => {
      const mockRows = [
        {
          id: 'event-uuid-2',
          incident_id: 'incident-uuid-1',
          event_type: 'UPDATED',
          payload: {},
          created_at: new Date('2024-01-01T00:05:00Z'),
        },
        {
          id: 'event-uuid-1',
          incident_id: 'incident-uuid-1',
          event_type: 'CREATED',
          payload: {},
          created_at: new Date('2024-01-01T00:00:00Z'),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await dao.getEvents('incident-uuid-1');

      expect(result).toHaveLength(2);
      expect(result[0].event_type).toBe('UPDATED');
      expect(result[1].event_type).toBe('CREATED');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC, id DESC'),
        expect.any(Array)
      );
    });
  });
});
