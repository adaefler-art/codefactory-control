/**
 * MCP Config and Verify API Tests
 * 
 * Tests for the MCP catalog verification endpoints:
 * - GET /api/mcp/config (effective configuration)
 * - GET /api/mcp/verify (catalog verification)
 * 
 * Reference: E7.0.3 (MCP Catalog Sync/Verify)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getConfig } from '../../app/api/mcp/config/route';
import { GET as verifyConfig } from '../../app/api/mcp/verify/route';

// Mock the MCP client
const mockMCPClient = {
  getServers: jest.fn(),
  checkHealth: jest.fn(),
  listTools: jest.fn(),
};

jest.mock('../../src/lib/mcp-client', () => ({
  getMCPClient: () => mockMCPClient,
}));

// Mock the catalog loader
const mockCatalog = {
  catalogVersion: '0.6.0',
  generatedAt: '2025-12-29T20:34:53Z',
  notes: 'Test catalog',
  servers: [
    {
      name: 'github',
      displayName: 'GitHub',
      contractVersion: '0.6.0',
      port: 3003,
      endpoint: 'http://localhost:3003',
      tools: [],
    },
    {
      name: 'deploy',
      displayName: 'Deploy',
      contractVersion: '0.6.0',
      port: 3002,
      endpoint: 'http://localhost:3002',
      tools: [],
    },
  ],
};

jest.mock('../../src/lib/mcp-catalog', () => ({
  loadMCPCatalog: jest.fn(() => mockCatalog),
  getMCPServersFromCatalog: jest.fn(() => mockCatalog.servers),
}));

describe('GET /api/mcp/config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return effective MCP configuration', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://localhost:3003',
        enabled: true,
        healthCheckUrl: 'http://localhost:3003/health',
        timeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      },
      {
        name: 'deploy',
        endpoint: 'http://localhost:3002',
        enabled: true,
        healthCheckUrl: 'http://localhost:3002/health',
        timeoutMs: 60000,
        maxRetries: 2,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      },
    ]);

    const response = await getConfig();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.effectiveConfig).toHaveLength(2);
    expect(data.hasDrift).toBe(false);
    expect(data.catalogVersion).toBe('0.6.0');
  });

  it('should detect endpoint mismatch drift', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://wrong-endpoint:9999', // Mismatched endpoint
        enabled: true,
        healthCheckUrl: 'http://wrong-endpoint:9999/health',
        timeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      },
    ]);

    const response = await getConfig();
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.hasDrift).toBe(true);
    expect(data.effectiveConfig[0].endpointMismatch).toBe(true);
  });

  it('should detect servers missing from catalog', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'unknown-server',
        endpoint: 'http://localhost:9999',
        enabled: true,
        healthCheckUrl: 'http://localhost:9999/health',
        timeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      },
    ]);

    const response = await getConfig();
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.hasDrift).toBe(true);
    expect(data.effectiveConfig[0].missingInCatalog).toBe(true);
  });

  it('should detect servers in catalog but missing from runtime', async () => {
    mockMCPClient.getServers.mockReturnValue([]);

    const response = await getConfig();
    const data = await response.json();

    expect(data.ok).toBe(true);
    expect(data.hasDrift).toBe(true);
    expect(data.catalogOnlyServers).toHaveLength(2);
  });
});

describe('GET /api/mcp/verify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should pass verification when all servers match and are healthy', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://localhost:3003',
        enabled: true,
      },
      {
        name: 'deploy',
        endpoint: 'http://localhost:3002',
        enabled: true,
      },
    ]);

    mockMCPClient.checkHealth.mockResolvedValue({
      status: 'ok',
      server: 'github',
      timestamp: new Date().toISOString(),
    });

    mockMCPClient.listTools.mockResolvedValue([
      { name: 'getIssue', description: 'Get issue', inputSchema: { type: 'object', properties: {} } },
    ]);

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.status).toBe('pass');
    expect(data.summary.total).toBe(2);
    expect(data.summary.passed).toBe(2);
    expect(data.summary.failed).toBe(0);
  });

  it('should fail verification when server endpoints mismatch', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://wrong-endpoint:9999',
        enabled: true,
      },
    ]);

    mockMCPClient.checkHealth.mockResolvedValue({
      status: 'ok',
      server: 'github',
      timestamp: new Date().toISOString(),
    });

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(data.status).toBe('fail');
    expect(data.results[0].errors.some((e: string) => e.includes('Endpoint mismatch'))).toBe(true);
  });

  it('should fail verification when server is unreachable', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://localhost:3003',
        enabled: true,
      },
    ]);

    mockMCPClient.checkHealth.mockResolvedValue({
      status: 'error',
      server: 'github',
      timestamp: new Date().toISOString(),
      error: 'Connection refused',
    });

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(data.status).toBe('fail');
    expect(data.results[0].reachable).toBe(false);
    expect(data.results[0].errors.some((e: string) => e.includes('Health check failed'))).toBe(true);
  });

  it('should fail verification when server is missing from runtime', async () => {
    mockMCPClient.getServers.mockReturnValue([]);

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(data.status).toBe('fail');
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].errors.some((e: string) => e.includes('exists in catalog but not in runtime'))).toBe(true);
  });

  it('should fail verification when runtime has server not in catalog', async () => {
    mockMCPClient.getServers.mockReturnValue([
      {
        name: 'github',
        endpoint: 'http://localhost:3003',
        enabled: true,
      },
      {
        name: 'unknown-server',
        endpoint: 'http://localhost:9999',
        enabled: true,
      },
    ]);

    mockMCPClient.checkHealth.mockResolvedValue({
      status: 'ok',
      server: 'github',
      timestamp: new Date().toISOString(),
    });

    mockMCPClient.listTools.mockResolvedValue([]);

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.ok).toBe(false);
    expect(data.status).toBe('fail');
    
    const unknownServerResult = data.results.find((r: any) => r.server === 'unknown-server');
    expect(unknownServerResult).toBeDefined();
    expect(unknownServerResult.errors.some((e: string) => e.includes('exists in runtime configuration but not in catalog'))).toBe(true);
  });

  it('should handle catalog loading failure', async () => {
    const { loadMCPCatalog } = require('../../src/lib/mcp-catalog');
    loadMCPCatalog.mockReturnValueOnce(null);

    const response = await verifyConfig();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('MCP catalog not found or invalid');
  });
});
