/**
 * Tests for /api/ready with ENABLE_PROD=false (Issue 3 - Package 4)
 * 
 * Proves that /api/ready returns ready=true with explicit flags
 * when ENABLE_PROD=false to prevent unhealthy churn
 */

import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/ready/route';

// Mock dependencies
jest.mock('../../../src/lib/utils/deployment-env');
jest.mock('../../../src/lib/utils/prod-control');
jest.mock('../../../src/lib/build/build-info');

import { getDeploymentEnv } from '../../../src/lib/utils/deployment-env';
import { isProdEnabled, getProdDisabledReason } from '../../../src/lib/utils/prod-control';
import { getBuildInfo } from '../../../src/lib/build/build-info';

const mockGetDeploymentEnv = getDeploymentEnv as jest.MockedFunction<typeof getDeploymentEnv>;
const mockIsProdEnabled = isProdEnabled as jest.MockedFunction<typeof isProdEnabled>;
const mockGetProdDisabledReason = getProdDisabledReason as jest.MockedFunction<typeof getProdDisabledReason>;
const mockGetBuildInfo = getBuildInfo as jest.MockedFunction<typeof getBuildInfo>;

describe('/api/ready with ENABLE_PROD=false (Issue 3)', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();

    process.env.AFU9_STAGE = 'staging';
    process.env.SERVICE_READ_TOKEN = 'test-service-token';
    
    // Default mocks
    mockGetProdDisabledReason.mockReturnValue('Production environment in cost-reduction mode');
    mockGetBuildInfo.mockReturnValue({
      appVersion: '0.5.0-test',
      timestamp: '2026-01-05T23:00:00.000Z',
      commitHash: 'abc123',
      environment: 'test',
    });
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  const createMockRequest = (): NextRequest => {
    return {
      url: 'https://example.com/api/ready',
      method: 'GET',
      headers: new Headers(),
    } as unknown as NextRequest;
  };
  
  describe('Production environment with ENABLE_PROD=false', () => {
    test('Should return ready=true with prodControl flags', async () => {
      // Setup: production environment, prod disabled
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(false);
      process.env.DATABASE_ENABLED = 'false'; // Simplify test
      
      const request = createMockRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(200); // ✅ ready=true → 200, not 503
      
      const body = await response.json();
      
      // Verify ready=true despite prod being disabled
      expect(body.ready).toBe(true);
      
      // Verify explicit prodControl flags
      expect(body.prodControl).toBeDefined();
      expect(body.prodControl.prodEnabled).toBe(false);
      expect(body.prodControl.prodWritesBlocked).toBe(true);
      expect(body.prodControl.reason).toContain('cost-reduction');
      
      // Verify prod_enabled check is info, not error
      expect(body.checks.prod_enabled).toBeDefined();
      expect(body.checks.prod_enabled.status).toBe('info'); // ✅ info, not error
      expect(body.checks.prod_enabled.message).toContain('write operations disabled');
    });
    
    test('Should NOT include prodControl for staging', async () => {
      mockGetDeploymentEnv.mockReturnValue('staging');
      process.env.DATABASE_ENABLED = 'false';
      
      const request = createMockRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      
      expect(body.ready).toBe(true);
      expect(body.prodControl).toBeUndefined(); // Not production
      expect(body.checks.prod_enabled).toBeUndefined(); // Not production
    });
    
    test('Production with ENABLE_PROD=true should show prodEnabled=true', async () => {
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(true);
      process.env.DATABASE_ENABLED = 'false';
      
      const request = createMockRequest();
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      
      const body = await response.json();
      
      expect(body.ready).toBe(true);
      expect(body.prodControl.prodEnabled).toBe(true);
      expect(body.prodControl.prodWritesBlocked).toBe(false);
      expect(body.prodControl.reason).toBeUndefined(); // No reason when enabled
      
      expect(body.checks.prod_enabled.status).toBe('ok');
    });
  });
  
  describe('Prevents unhealthy churn', () => {
    test('prod_enabled status=info should not block readiness', async () => {
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(false);
      process.env.DATABASE_ENABLED = 'false';
      
      const request = createMockRequest();
      const response = await GET(request);
      
      const body = await response.json();
      
      // Even with prod_enabled showing info status, ready should be true
      expect(body.checks.prod_enabled.status).toBe('info');
      expect(body.ready).toBe(true);
      expect(response.status).toBe(200); // Not 503
    });
    
    test('Error in other checks should still fail readiness', async () => {
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(false);
      
      // Database enabled but not configured (will cause error)
      process.env.DATABASE_ENABLED = 'true';
      delete process.env.DATABASE_HOST;
      
      const request = createMockRequest();
      const response = await GET(request);
      
      const body = await response.json();
      
      // Database error should block readiness
      expect(body.checks.database.status).toBe('error');
      expect(body.ready).toBe(false);
      expect(response.status).toBe(503);
      
      // But prod_enabled should still be info, not error
      expect(body.checks.prod_enabled.status).toBe('info');
    });
  });
});
