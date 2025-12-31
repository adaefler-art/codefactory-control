/**
 * Tests for /api/timeline/chain endpoint
 * 
 * Validates:
 * - Query parameter validation
 * - Chain retrieval
 * - Deterministic ordering
 * - Response schema compliance
 * 
 * Reference: E72.4 (I724)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../../../app/api/timeline/chain/route';
import { getTimelineDAO } from '../../../../src/lib/db/timeline';
import { getPool } from '../../../../src/lib/db';

// Mock dependencies
jest.mock('../../../../src/lib/db/timeline');
jest.mock('../../../../src/lib/db');

const mockListChainForIssue = jest.fn();
const mockGetTimelineDAO = getTimelineDAO as jest.MockedFunction<typeof getTimelineDAO>;
const mockGetPool = getPool as jest.MockedFunction<typeof getPool>;

describe('GET /api/timeline/chain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    mockGetPool.mockReturnValue({} as never);
    mockGetTimelineDAO.mockReturnValue({
      listChainForIssue: mockListChainForIssue,
    } as never);
  });

  it('should return 400 if issueId is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/timeline/chain');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid query parameters');
  });

  it('should return 400 if issueId is empty', async () => {
    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Invalid query parameters');
  });

  it('should query chain with default sourceSystem', async () => {
    const mockNodes = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        source_system: 'afu9' as const,
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE' as const,
        title: 'Test Issue',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ];

    const mockEdges: never[] = [];

    mockListChainForIssue.mockResolvedValue({
      nodes: mockNodes,
      edges: mockEdges,
    });

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=123');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockListChainForIssue).toHaveBeenCalledWith('afu9', '123');
    expect(data.issueId).toBe('123');
    expect(data.sourceSystem).toBe('afu9');
    expect(data.nodes).toHaveLength(1);
    expect(data.edges).toHaveLength(0);
    expect(data.metadata.nodeCount).toBe(1);
    expect(data.metadata.edgeCount).toBe(0);
  });

  it('should query chain with specified sourceSystem', async () => {
    mockListChainForIssue.mockResolvedValue({
      nodes: [],
      edges: [],
    });

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=456&sourceSystem=github');
    
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockListChainForIssue).toHaveBeenCalledWith('github', '456');
  });

  it('should sort nodes deterministically by type, created_at, id', async () => {
    const mockNodes = [
      {
        id: '33333333-3333-3333-3333-333333333333',
        source_system: 'afu9' as const,
        source_type: 'run',
        source_id: '789',
        node_type: 'RUN' as const,
        title: 'Run',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-03T00:00:00.000Z',
        updated_at: '2024-01-03T00:00:00.000Z',
      },
      {
        id: '11111111-1111-1111-1111-111111111111',
        source_system: 'afu9' as const,
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE' as const,
        title: 'Issue',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        source_system: 'afu9' as const,
        source_type: 'pull_request',
        source_id: '456',
        node_type: 'PR' as const,
        title: 'PR',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-02T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
      },
    ];

    mockListChainForIssue.mockResolvedValue({
      nodes: mockNodes,
      edges: [],
    });

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=123');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.nodes).toHaveLength(3);
    // Should be sorted: ISSUE, PR, RUN
    expect(data.nodes[0].node_type).toBe('ISSUE');
    expect(data.nodes[1].node_type).toBe('PR');
    expect(data.nodes[2].node_type).toBe('RUN');
  });

  it('should include edges in response', async () => {
    const mockNodes = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        source_system: 'afu9' as const,
        source_type: 'issue',
        source_id: '123',
        node_type: 'ISSUE' as const,
        title: 'Issue',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        source_system: 'afu9' as const,
        source_type: 'pull_request',
        source_id: '456',
        node_type: 'PR' as const,
        title: 'PR',
        url: null,
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-02T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
      },
    ];

    const mockEdges = [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        from_node_id: '11111111-1111-1111-1111-111111111111',
        to_node_id: '22222222-2222-2222-2222-222222222222',
        edge_type: 'ISSUE_HAS_PR' as const,
        payload_json: {},
        created_at: '2024-01-02T00:00:00.000Z',
      },
    ];

    mockListChainForIssue.mockResolvedValue({
      nodes: mockNodes,
      edges: mockEdges,
    });

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=123');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0].edge_type).toBe('ISSUE_HAS_PR');
    expect(data.metadata.edgeCount).toBe(1);
  });

  it('should return 500 if dao.listChainForIssue throws', async () => {
    mockListChainForIssue.mockRejectedValue(new Error('Database error'));

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=123');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toContain('Failed to query timeline chain');
  });

  it('should include metadata with timestamp', async () => {
    mockListChainForIssue.mockResolvedValue({
      nodes: [],
      edges: [],
    });

    const request = new NextRequest('http://localhost:3000/api/timeline/chain?issueId=123');
    
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.metadata).toBeDefined();
    expect(data.metadata.timestamp).toBeDefined();
    expect(data.metadata.nodeCount).toBe(0);
    expect(data.metadata.edgeCount).toBe(0);
  });
});
