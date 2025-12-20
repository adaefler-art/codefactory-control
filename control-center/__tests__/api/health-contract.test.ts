/**
 * Health/Ready Contract Tests
 * 
 * These tests ensure health check endpoints maintain their contracts:
 * - /api/health: Always returns 200 (liveness probe)
 * - /api/ready: Returns 200/503 based on dependencies (readiness probe)
 * 
 * MUST pass in CI before deploy to prevent ECS rollbacks
 * 
 * @jest-environment node
 */

import { GET as healthHandler } from '../../app/api/health/route';
import { GET as readyHandler } from '../../app/api/ready/route';

describe('Health Endpoint Contract', () => {
  test('/api/health ALWAYS returns 200', async () => {
    const response = await healthHandler();
    expect(response.status).toBe(200);
    
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('afu9-control-center');
    expect(body.version).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  test('/api/health response structure is consistent', async () => {
    const response = await healthHandler();
    const body = await response.json();
    
    // Verify required fields
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('service');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');
    
    // Verify no error fields (health should never fail)
    expect(body).not.toHaveProperty('error');
    expect(body).not.toHaveProperty('errors');
  });

  test('/api/health never blocks deployments by always returning 200', async () => {
    // This test validates the critical guarantee: health NEVER blocks deploys
    // Even if internal errors occur, the endpoint returns 200
    
    const response = await healthHandler();
    
    // CRITICAL: Must be 200, never 500/503
    expect(response.status).toBe(200);
    
    // Status field should always be 'ok' for deployment safety
    const body = await response.json();
    expect(body.status).toBe('ok');
    
    // This guarantee ensures:
    // 1. ECS health checks don't kill healthy containers
    // 2. ALB doesn't remove healthy targets
    // 3. Deployments proceed even during transient issues
  });
});

describe('Ready Endpoint Contract', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to clean state before each test
    process.env = { ...originalEnv };
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USER;
    delete process.env.DATABASE_PASSWORD;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('/api/ready returns 200 when DATABASE_ENABLED=false', async () => {
    process.env.DATABASE_ENABLED = 'false';
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.database.status).toBe('not_configured');
    expect(body.checks.database.message).toBeDefined();
  });

  test('/api/ready returns 200 when DATABASE_ENABLED is not set (default)', async () => {
    // DATABASE_ENABLED not set - should default to disabled
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.database.status).toBe('not_configured');
  });

  test('/api/ready returns 503 when DATABASE_ENABLED=true but secrets missing', async () => {
    process.env.DATABASE_ENABLED = 'true';
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.database.status).toBe('error');
    expect(body.checks.database.message).toContain('Missing required environment variables');
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test('/api/ready returns 200 when DATABASE_ENABLED=true and all secrets present', async () => {
    process.env.DATABASE_ENABLED = 'true';
    process.env.DATABASE_HOST = 'localhost';
    process.env.DATABASE_PORT = '5432';
    process.env.DATABASE_NAME = 'testdb';
    process.env.DATABASE_USER = 'testuser';
    process.env.DATABASE_PASSWORD = 'testpass';
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.database.message).toBe('connection_configured');
  });

  test('/api/ready identifies missing database credentials correctly', async () => {
    process.env.DATABASE_ENABLED = 'true';
    process.env.DATABASE_HOST = 'localhost';
    // Missing PORT, NAME, USER, PASSWORD
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(503);
    expect(body.checks.database.status).toBe('error');
    expect(body.checks.database.message).toContain('DATABASE_PORT');
    expect(body.checks.database.message).toContain('DATABASE_NAME');
    expect(body.checks.database.message).toContain('DATABASE_USER');
    expect(body.checks.database.message).toContain('DATABASE_PASSWORD');
  });

  test('/api/ready validates database port is numeric', async () => {
    process.env.DATABASE_ENABLED = 'true';
    process.env.DATABASE_HOST = 'localhost';
    process.env.DATABASE_PORT = 'invalid-port';
    process.env.DATABASE_NAME = 'testdb';
    process.env.DATABASE_USER = 'testuser';
    process.env.DATABASE_PASSWORD = 'testpass';
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(503);
    expect(body.checks.database.status).toBe('error');
  });

  test('/api/ready response structure includes all required fields', async () => {
    process.env.DATABASE_ENABLED = 'false';
    
    const response = await readyHandler();
    const body = await response.json();
    
    // Core fields
    expect(body).toHaveProperty('ready');
    expect(body).toHaveProperty('service');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');
    
    // Checks
    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('service');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks).toHaveProperty('environment');
    
    // Dependencies declaration
    expect(body).toHaveProperty('dependencies');
    expect(body.dependencies).toHaveProperty('required');
    expect(body.dependencies).toHaveProperty('optional');
  });

  test('/api/ready does NOT fail on MCP server unavailability', async () => {
    // MCP servers should be optional dependencies
    process.env.DATABASE_ENABLED = 'false';
    process.env.NODE_ENV = 'production'; // Enable MCP checks
    
    // Even if MCP servers fail, ready should return 200
    // because MCP servers are optional dependencies
    const response = await readyHandler();
    const body = await response.json();
    
    // Should be ready even if MCP checks fail
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    
    // Verify MCP servers are listed as optional dependencies
    expect(body.dependencies.optional).toEqual(
      expect.arrayContaining(['mcp-github', 'mcp-deploy', 'mcp-observability'])
    );
  });

  test('/api/ready handles exceptions gracefully', async () => {
    // Test with extreme edge case
    process.env.DATABASE_ENABLED = 'true';
    process.env.DATABASE_PORT = '999999'; // Out of valid port range
    
    const response = await readyHandler();
    const body = await response.json();
    
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.database.status).toBe('error');
  });
});

describe('Health vs Ready Semantics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_HOST;
    delete process.env.DATABASE_PORT;
    delete process.env.DATABASE_NAME;
    delete process.env.DATABASE_USER;
    delete process.env.DATABASE_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('/api/health is always healthy, /api/ready can be not ready', async () => {
    // Configure a scenario where ready would fail
    process.env.DATABASE_ENABLED = 'true';
    // Missing DB credentials
    
    const healthResponse = await healthHandler();
    const readyResponse = await readyHandler();
    
    // Health should ALWAYS be 200
    expect(healthResponse.status).toBe(200);
    
    // Ready should be 503 due to missing DB credentials
    expect(readyResponse.status).toBe(503);
    
    // This demonstrates the key difference:
    // - /api/health: Liveness - is the process running?
    // - /api/ready: Readiness - is the service ready to accept traffic?
  });

  test('/api/health has no dependency checks, /api/ready has dependency checks', async () => {
    const healthResponse = await healthHandler();
    const healthBody = await healthResponse.json();
    
    const readyResponse = await readyHandler();
    const readyBody = await readyResponse.json();
    
    // Health should have no checks field
    expect(healthBody.checks).toBeUndefined();
    
    // Ready should have checks field
    expect(readyBody.checks).toBeDefined();
    expect(readyBody.checks.database).toBeDefined();
  });
});
