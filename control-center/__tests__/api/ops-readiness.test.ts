/**
 * Tests for Integration Readiness Checklist endpoint (E86.3)
 * 
 * GET /api/ops/readiness
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/ops/readiness/route';

// Mock dependencies
jest.mock('../../src/lib/github-app-auth', () => ({
  getGitHubAppConfig: jest.fn(),
}));

jest.mock('../../src/lib/mcp-catalog', () => ({
  getMCPServersFromCatalog: jest.fn(),
}));

import { getGitHubAppConfig } from '../../src/lib/github-app-auth';
import { getMCPServersFromCatalog } from '../../src/lib/mcp-catalog';

const mockGetGitHubAppConfig = getGitHubAppConfig as jest.MockedFunction<typeof getGitHubAppConfig>;
const mockGetMCPServersFromCatalog = getMCPServersFromCatalog as jest.MockedFunction<typeof getMCPServersFromCatalog>;

describe('Integration Readiness Checklist (E86.3)', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });
  
  afterAll(() => {
    process.env = originalEnv;
  });

  const createRequest = (userId?: string) => {
    const headers = new Headers();
    if (userId) {
      headers.set('x-afu9-sub', userId);
    }
    
    return new NextRequest('http://localhost:3000/api/ops/readiness', {
      method: 'GET',
      headers,
    });
  };

  describe('Authentication & Authorization', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = createRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 403 when user is not admin', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123';
      
      const request = createRequest('non-admin-user');
      const response = await GET(request);
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });

    it('should allow admin users', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123,other-admin';
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      process.env.DATABASE_HOST = 'localhost';
      process.env.AWS_REGION = 'eu-central-1';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
    });
  });

  describe('Readiness Checks', () => {
    beforeEach(() => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123';
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      process.env.DATABASE_HOST = 'localhost';
      process.env.AWS_REGION = 'eu-central-1';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
    });

    it('should return PASS when all checks pass', async () => {
      // Set AWS credentials for OIDC check to pass
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Debug output to see which check failed
      if (data.status === 'FAIL') {
        const failedChecks = data.checks.filter((c: any) => c.status === 'FAIL');
        console.log('Failed checks:', JSON.stringify(failedChecks, null, 2));
      }
      
      expect(data.status).toBe('PASS');
      expect(data.checks).toHaveLength(5);
      expect(data.checks.every((c: any) => c.status === 'PASS')).toBe(true);
      expect(data.timestamp).toBeDefined();
    });

    it('should return FAIL when GitHub App check fails', async () => {
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '',
        privateKeyPem: '',
        webhookSecret: '',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('FAIL');
      const githubAppCheck = data.checks.find((c: any) => c.id === 'github_app');
      expect(githubAppCheck.status).toBe('FAIL');
    });

    it('should return FAIL when environment variables are missing', async () => {
      delete process.env.DATABASE_HOST;
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('FAIL');
      const envCheck = data.checks.find((c: any) => c.id === 'environment_vars');
      expect(envCheck.status).toBe('FAIL');
      expect(envCheck.message).toContain('DATABASE_HOST');
    });

    it('should return FAIL when MCP servers are missing', async () => {
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      // Missing 'observability' server
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('FAIL');
      const toolsCheck = data.checks.find((c: any) => c.id === 'tools_registry');
      expect(toolsCheck.status).toBe('FAIL');
      expect(toolsCheck.message).toContain('observability');
    });

    it('should have stable check ordering', async () => {
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      const data = await response.json();
      
      // Verify check ordering is deterministic
      expect(data.checks[0].id).toBe('github_app');
      expect(data.checks[1].id).toBe('github_actions');
      expect(data.checks[2].id).toBe('oidc');
      expect(data.checks[3].id).toBe('environment_vars');
      expect(data.checks[4].id).toBe('tools_registry');
    });

    it('should include details in check results', async () => {
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1', 'tool2'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool3'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool4'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      const data = await response.json();
      
      // Check that details are included
      const githubAppCheck = data.checks.find((c: any) => c.id === 'github_app');
      expect(githubAppCheck.details).toBeDefined();
      expect(githubAppCheck.details.hasAppId).toBe(true);
      
      const toolsCheck = data.checks.find((c: any) => c.id === 'tools_registry');
      expect(toolsCheck.details).toBeDefined();
      expect(toolsCheck.details.serverCount).toBe(3);
      expect(toolsCheck.details.toolCount).toBe(4);
    });

    it('should handle GitHub App config errors gracefully', async () => {
      mockGetGitHubAppConfig.mockRejectedValue(new Error('Failed to load config'));
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('FAIL');
      const githubAppCheck = data.checks.find((c: any) => c.id === 'github_app');
      expect(githubAppCheck.status).toBe('FAIL');
      expect(githubAppCheck.message).toContain('configuration error');
    });
  });

  describe('OIDC Check', () => {
    beforeEach(() => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123';
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      process.env.DATABASE_HOST = 'localhost';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
    });

    it('should pass in ECS environment', async () => {
      process.env.AWS_REGION = 'eu-central-1';
      process.env.ECS_CONTAINER_METADATA_URI_V4 = 'http://169.254.170.2/v4/metadata';
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      const data = await response.json();
      const oidcCheck = data.checks.find((c: any) => c.id === 'oidc');
      
      expect(oidcCheck.status).toBe('PASS');
      expect(oidcCheck.details.environment).toBe('ecs');
    });

    it('should pass with AWS credentials in local dev', async () => {
      process.env.AWS_REGION = 'eu-central-1';
      process.env.AWS_ACCESS_KEY_ID = 'test-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      const data = await response.json();
      const oidcCheck = data.checks.find((c: any) => c.id === 'oidc');
      
      expect(oidcCheck.status).toBe('PASS');
      expect(oidcCheck.details.environment).toBe('local');
    });

    it('should fail when AWS_REGION is not set', async () => {
      delete process.env.AWS_REGION;
      delete process.env.AWS_DEFAULT_REGION;
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'], endpoint: 'http://localhost:3001', displayName: 'GitHub', port: 3001 },
        { name: 'deploy', tools: ['tool2'], endpoint: 'http://localhost:3002', displayName: 'Deploy', port: 3002 },
        { name: 'observability', tools: ['tool3'], endpoint: 'http://localhost:3003', displayName: 'Observability', port: 3003 },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      const data = await response.json();
      const oidcCheck = data.checks.find((c: any) => c.id === 'oidc');
      
      expect(oidcCheck.status).toBe('FAIL');
      expect(oidcCheck.message).toContain('AWS_REGION not configured');
    });
  });
});


describe('Integration Readiness Checklist (E86.3)', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });
  
  afterAll(() => {
    process.env = originalEnv;
  });

  const createRequest = (userId?: string) => {
    const headers = new Headers();
    if (userId) {
      headers.set('x-afu9-sub', userId);
    }
    
    return new NextRequest('http://localhost:3000/api/ops/readiness', {
      method: 'GET',
      headers,
    });
  };

  describe('Authentication & Authorization', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = createRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 403 when user is not admin', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123';
      
      const request = createRequest('non-admin-user');
      const response = await GET(request);
      
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe('Forbidden');
    });

    it('should allow admin users', async () => {
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123,other-admin';
      process.env.GITHUB_APP_ID = '12345';
      process.env.GITHUB_APP_PRIVATE_KEY_PEM = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----';
      process.env.DATABASE_HOST = 'localhost';
      process.env.AWS_REGION = 'eu-central-1';
      process.env.GITHUB_OWNER = 'test-owner';
      process.env.GITHUB_REPO = 'test-repo';
      
      mockGetGitHubAppConfig.mockResolvedValue({
        appId: '12345',
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
        webhookSecret: 'test-secret',
      });
      
      mockGetMCPServersFromCatalog.mockReturnValue([
        { name: 'github', tools: ['tool1'] },
        { name: 'deploy', tools: ['tool2'] },
        { name: 'observability', tools: ['tool3'] },
      ]);
      
      const request = createRequest('admin-user-123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
    });
  });
});

