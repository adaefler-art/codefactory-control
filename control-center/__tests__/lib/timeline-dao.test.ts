/**
 * Timeline DAO Tests
 * 
 * Tests for Timeline/Linkage Model persistence layer:
 * - Natural key uniqueness
 * - Idempotent upsert behavior
 * - Deterministic event ordering
 * - Edge creation and retrieval
 * 
 * Reference: I721 (E72.1 - Timeline/Linkage Model)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { TimelineDAO } from '../../src/lib/db/timeline';
import {
  TimelineNodeInput,
  TimelineEdgeInput,
  TimelineEventInput,
  generateNaturalKey,
} from '../../src/lib/contracts/timeline';

// Mock the database pool
const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();

const mockPool = {
  query: mockQuery,
  connect: jest.fn(() => ({
    query: mockQuery,
    release: mockRelease,
  })),
} as unknown as Pool;

describe('TimelineDAO', () => {
  let dao: TimelineDAO;

  beforeEach(() => {
    dao = new TimelineDAO(mockPool);
    jest.clearAllMocks();
  });

  describe('upsertNode', () => {
    test('creates new node on first insert', async () => {
      const input: TimelineNodeInput = {
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
      };

      const mockRow = {
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {},
        lawbook_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertNode(input);

      expect(result.id).toBe('node-uuid-1');
      expect(result.source_system).toBe('github');
      expect(result.source_type).toBe('issue');
      expect(result.source_id).toBe('123');
      expect(result.node_type).toBe('ISSUE');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO timeline_nodes'),
        expect.arrayContaining(['github', 'issue', '123', 'ISSUE'])
      );
    });

    test('updates existing node on conflict (idempotent)', async () => {
      const input: TimelineNodeInput = {
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Updated Issue',
      };

      const mockRow = {
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Updated Issue',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-02T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertNode(input);

      expect(result.id).toBe('node-uuid-1');
      expect(result.title).toBe('Updated Issue');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (source_system, source_type, source_id)'),
        expect.any(Array)
      );
    });

    test('handles natural key uniqueness', async () => {
      const input1: TimelineNodeInput = {
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'First Insert',
      };

      const input2: TimelineNodeInput = {
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Second Insert (Should Update)',
      };

      const mockRow1 = {
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'First Insert',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
      };

      const mockRow2 = {
        ...mockRow1,
        title: 'Second Insert (Should Update)',
        updated_at: new Date('2024-01-02T00:00:00Z'),
      };

      mockQuery.mockResolvedValueOnce({ rows: [mockRow1] });
      mockQuery.mockResolvedValueOnce({ rows: [mockRow2] });

      const result1 = await dao.upsertNode(input1);
      const result2 = await dao.upsertNode(input2);

      // Same node ID (natural key collision handled by UPSERT)
      expect(result1.id).toBe(result2.id);
      expect(result2.title).toBe('Second Insert (Should Update)');
    });
  });

  describe('getNodeByNaturalKey', () => {
    test('retrieves node by natural key components', async () => {
      const mockRow = {
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'pull_request',
        source_id: '456',
        node_type: 'PR',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/456',
        payload_json: { number: 456 },
        lawbook_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.getNodeByNaturalKey('github', 'pull_request', '456');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('node-uuid-1');
      expect(result?.source_id).toBe('456');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE source_system = $1 AND source_type = $2 AND source_id = $3'),
        ['github', 'pull_request', '456']
      );
    });

    test('returns null for non-existent node', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await dao.getNodeByNaturalKey('github', 'issue', '999');

      expect(result).toBeNull();
    });
  });

  describe('createEdge', () => {
    test('creates new edge', async () => {
      const input: TimelineEdgeInput = {
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
      };

      const mockRow = {
        id: 'edge-uuid-1',
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
        payload_json: {},
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.createEdge(input);

      expect(result.id).toBe('edge-uuid-1');
      expect(result.from_node_id).toBe('node-uuid-1');
      expect(result.to_node_id).toBe('node-uuid-2');
      expect(result.edge_type).toBe('ISSUE_HAS_PR');
    });

    test('returns existing edge on conflict (idempotent)', async () => {
      const input: TimelineEdgeInput = {
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
      };

      const mockExistingRow = {
        id: 'edge-uuid-1',
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
        payload_json: {},
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      // First call returns empty (conflict occurred)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Second call fetches existing edge
      mockQuery.mockResolvedValueOnce({ rows: [mockExistingRow] });

      const result = await dao.createEdge(input);

      expect(result.id).toBe('edge-uuid-1');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('upsertEdge', () => {
    test('updates payload on conflict', async () => {
      const input: TimelineEdgeInput = {
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
        payload_json: { updated: true },
      };

      const mockRow = {
        id: 'edge-uuid-1',
        from_node_id: 'node-uuid-1',
        to_node_id: 'node-uuid-2',
        edge_type: 'ISSUE_HAS_PR',
        payload_json: { updated: true },
        created_at: new Date('2024-01-01T00:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.upsertEdge(input);

      expect(result.payload_json).toEqual({ updated: true });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (from_node_id, to_node_id, edge_type)'),
        expect.any(Array)
      );
    });
  });

  describe('createEvent', () => {
    test('creates event with occurred_at timestamp', async () => {
      const input: TimelineEventInput = {
        node_id: 'node-uuid-1',
        event_type: 'ISSUE_OPENED',
        occurred_at: '2024-01-01T10:00:00Z',
        payload_json: { action: 'opened' },
      };

      const mockRow = {
        id: 'event-uuid-1',
        node_id: 'node-uuid-1',
        event_type: 'ISSUE_OPENED',
        occurred_at: new Date('2024-01-01T10:00:00Z'),
        payload_json: { action: 'opened' },
        source_ref: null,
        created_at: new Date('2024-01-01T10:00:00Z'),
      };

      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const result = await dao.createEvent(input);

      expect(result.id).toBe('event-uuid-1');
      expect(result.event_type).toBe('ISSUE_OPENED');
      expect(result.occurred_at).toBe('2024-01-01T10:00:00.000Z');
    });
  });

  describe('getEventsForNode', () => {
    test('returns events in deterministic order', async () => {
      const mockRows = [
        {
          id: 'event-uuid-3',
          node_id: 'node-uuid-1',
          event_type: 'ISSUE_UPDATED',
          occurred_at: new Date('2024-01-03T10:00:00Z'),
          payload_json: {},
          source_ref: null,
          created_at: new Date('2024-01-03T10:00:00Z'),
        },
        {
          id: 'event-uuid-2',
          node_id: 'node-uuid-1',
          event_type: 'ISSUE_LABELED',
          occurred_at: new Date('2024-01-02T10:00:00Z'),
          payload_json: {},
          source_ref: null,
          created_at: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'event-uuid-1',
          node_id: 'node-uuid-1',
          event_type: 'ISSUE_OPENED',
          occurred_at: new Date('2024-01-01T10:00:00Z'),
          payload_json: {},
          source_ref: null,
          created_at: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      mockQuery.mockResolvedValue({ rows: mockRows });

      const result = await dao.getEventsForNode('node-uuid-1');

      expect(result).toHaveLength(3);
      // Verify deterministic ordering (occurred_at DESC, id DESC)
      expect(result[0].event_type).toBe('ISSUE_UPDATED');
      expect(result[1].event_type).toBe('ISSUE_LABELED');
      expect(result[2].event_type).toBe('ISSUE_OPENED');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY occurred_at DESC, id DESC'),
        expect.any(Array)
      );
    });
  });

  describe('listChainForIssue', () => {
    test('retrieves connected nodes and edges', async () => {
      const mockIssueNode = {
        id: 'node-uuid-issue',
        source_system: 'github',
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: new Date('2024-01-01T00:00:00Z'),
        updated_at: new Date('2024-01-01T00:00:00Z'),
      };

      const mockConnectedNodes = [
        mockIssueNode,
        {
          id: 'node-uuid-pr',
          source_system: 'github',
          source_type: 'pull_request',
          source_id: '456',
          node_type: 'PR',
          title: 'Test PR',
          url: null,
          payload_json: {},
          lawbook_version: null,
          created_at: new Date('2024-01-02T00:00:00Z'),
          updated_at: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      const mockEdges = [
        {
          id: 'edge-uuid-1',
          from_node_id: 'node-uuid-issue',
          to_node_id: 'node-uuid-pr',
          edge_type: 'ISSUE_HAS_PR',
          payload_json: {},
          created_at: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      // First query: get issue node by natural key
      mockQuery.mockResolvedValueOnce({ rows: [mockIssueNode] });
      // Second query: get connected nodes (recursive)
      mockQuery.mockResolvedValueOnce({ rows: mockConnectedNodes });
      // Third query: get edges
      mockQuery.mockResolvedValueOnce({ rows: mockEdges });

      const result = await dao.listChainForIssue('github', '123');

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.nodes[0].node_type).toBe('ISSUE');
      expect(result.nodes[1].node_type).toBe('PR');
      expect(result.edges[0].edge_type).toBe('ISSUE_HAS_PR');
    });

    test('returns empty for non-existent issue', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await dao.listChainForIssue('github', '999');

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('Natural Key Helper', () => {
    test('generateNaturalKey creates correct format', () => {
      const key = generateNaturalKey('github', 'issue', '123');
      expect(key).toBe('github:issue:123');
    });
  });
});
