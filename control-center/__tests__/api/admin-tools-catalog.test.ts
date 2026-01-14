/**
 * Admin Tools Catalog API Tests (E86.1)
 * 
 * Tests for the tools catalog endpoint:
 * - Admin-only access control
 * - Deterministic server and tool listing
 * - Health status mapping
 * - Schema hash generation
 * - Empty state handling
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getToolsCatalog } from '../../app/api/admin/tools/catalog/route';

// Mock MCP catalog module
jest.mock('../../src/lib/mcp-catalog', () => ({
  loadMCPCatalog: jest.fn(),
  getMCPServersFromCatalog: jest.fn(),
}));

// Mock MCP client module
jest.mock('../../src/lib/mcp-client', () => ({
  getMCPClient: jest.fn(),
}));

import { loadMCPCatalog, getMCPServersFromCatalog } from '../../src/lib/mcp-catalog';
import { getMCPClient } from '../../src/lib/mcp-client';

const MOCK_CATALOG = {
  catalogVersion: '0.6.0',
  generatedAt: '2025-12-29T20:34:53Z',
  notes: 'Test catalog',
  servers: [
    {
      name: 'github',
      displayName: 'GitHub',
      contractVersion: '0.6.0',
      port: 3001,
      endpoint: 'http://localhost:3001',
      tools: [
        {
          name: 'getIssue',
          description: 'Get details of a GitHub issue.',
          contractVersion: '0.6.0',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
              number: { type: 'integer' },
            },
            required: ['repo', 'number'],
          },
          outputSchema: {
            type: 'object',
            properties: {
              title: { type: 'string' },
            },
          },
        },
        {
          name: 'listIssues',
          description: 'List issues in a repository.',
          contractVersion: '0.6.0',
          inputSchema: {
            type: 'object',
            properties: {
              repo: { type: 'string' },
            },
            required: ['repo'],
          },
        },
      ],
    },
    {
      name: 'deploy',
      displayName: 'Deploy',
      contractVersion: '0.6.0',
      port: 3002,
      endpoint: 'http://localhost:3002',
      tools: [
        {
          name: 'getServiceStatus',
          description: 'Get comprehensive status of an ECS service.',
          contractVersion: '0.6.0',
          inputSchema: {
            type: 'object',
            properties: {
              cluster: { type: 'string' },
              service: { type: 'string' },
            },
            required: ['cluster', 'service'],
          },
        },
      ],
    },
  ],
};

function createMockRequest(userId?: string): NextRequest {
  const headers = new Headers();
  if (userId) {
    headers.set('x-afu9-sub', userId);
  }
  
  return new NextRequest('http://localhost:3000/api/admin/tools/catalog', {
    method: 'GET',
    headers,
  });
}

describe('GET /api/admin/tools/catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AFU9_ADMIN_SUBS = 'admin-user-123';
  });

  afterEach(() => {
    delete process.env.AFU9_ADMIN_SUBS;
  });

  test('returns 401 when no user authentication', async () => {
    const request = createMockRequest();
    const response = await getToolsCatalog(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.code).toBe('UNAUTHORIZED');
  });

  test('returns 403 when user is not admin', async () => {
    const request = createMockRequest('regular-user');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('FORBIDDEN');
  });

  test('returns catalog successfully for admin user', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map([
        ['github', { status: 'ok', timestamp: new Date().toISOString() }],
        ['deploy', { status: 'ok', timestamp: new Date().toISOString() }],
      ])),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.catalogVersion).toBe('0.6.0');
    expect(data.serverCount).toBe(2);
    expect(data.totalToolCount).toBe(3);
    expect(data.servers).toHaveLength(2);
  });

  test('returns servers in alphabetical order', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map()),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    expect(data.servers[0].name).toBe('deploy');
    expect(data.servers[1].name).toBe('github');
  });

  test('returns tools in alphabetical order within each server', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map()),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    const githubServer = data.servers.find((s: any) => s.name === 'github');
    expect(githubServer.tools[0].toolId).toBe('getIssue');
    expect(githubServer.tools[1].toolId).toBe('listIssues');
  });

  test('maps health status correctly', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map([
        ['github', { status: 'ok' }],
        ['deploy', { status: 'error' }],
      ])),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    const githubServer = data.servers.find((s: any) => s.name === 'github');
    const deployServer = data.servers.find((s: any) => s.name === 'deploy');

    expect(githubServer.health).toBe('OK');
    expect(deployServer.health).toBe('UNREACHABLE');
  });

  test('handles missing catalog gracefully', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(null);

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.code).toBe('CATALOG_NOT_FOUND');
  });

  test('generates schema hashes for tools', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map()),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    const githubServer = data.servers.find((s: any) => s.name === 'github');
    const getIssueTool = githubServer.tools.find((t: any) => t.toolId === 'getIssue');

    expect(getIssueTool.inputSchemaHash).toBeDefined();
    expect(getIssueTool.inputSchemaHash).not.toBe('none');
    expect(getIssueTool.outputSchemaHash).toBeDefined();
  });

  test('handles health check failure gracefully', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockRejectedValue(new Error('Health check failed')),
    });

    const request = createMockRequest('admin-user-123');
    const response = await getToolsCatalog(request);
    const data = await response.json();

    // Should still return 200 with UNREACHABLE status for all servers
    expect(response.status).toBe(200);
    expect(data.servers.every((s: any) => s.health === 'UNREACHABLE')).toBe(true);
  });

  test('response is deterministic across multiple calls', async () => {
    (loadMCPCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG);
    (getMCPServersFromCatalog as jest.Mock).mockReturnValue(MOCK_CATALOG.servers);
    (getMCPClient as jest.Mock).mockReturnValue({
      checkAllHealth: jest.fn().mockResolvedValue(new Map([
        ['github', { status: 'ok' }],
        ['deploy', { status: 'ok' }],
      ])),
    });

    const request1 = createMockRequest('admin-user-123');
    const response1 = await getToolsCatalog(request1);
    const data1 = await response1.json();

    const request2 = createMockRequest('admin-user-123');
    const response2 = await getToolsCatalog(request2);
    const data2 = await response2.json();

    // Remove timestamps which will differ
    delete data1.timestamp;
    delete data2.timestamp;

    // Server order and tool order should be identical
    expect(data1.servers.map((s: any) => s.name)).toEqual(
      data2.servers.map((s: any) => s.name)
    );
    
    expect(data1.servers[0].tools.map((t: any) => t.toolId)).toEqual(
      data2.servers[0].tools.map((t: any) => t.toolId)
    );
  });
});
