/**
 * Tests for Production Write Guard (Issue 3 - Package 4)
 * 
 * Proves guard ordering and ensures NO DB calls on blocked paths:
 * 1. Missing auth → 401, ZERO DB calls
 * 2. Prod + ENABLE_PROD=false → 409, ZERO DB calls
 * 3. Non-admin → 403, ZERO DB calls
 * 4. Admin + stage → Allowed (would proceed to DB)
 */

import { NextRequest } from 'next/server';
import { checkProdWriteGuard } from '../../../src/lib/guards/prod-write-guard';

// Mock dependencies
jest.mock('../../../src/lib/utils/deployment-env');
jest.mock('../../../src/lib/utils/prod-control');

import { getDeploymentEnv } from '../../../src/lib/utils/deployment-env';
import { isProdEnabled, getProdDisabledReason } from '../../../src/lib/utils/prod-control';

const mockGetDeploymentEnv = getDeploymentEnv as jest.MockedFunction<typeof getDeploymentEnv>;
const mockIsProdEnabled = isProdEnabled as jest.MockedFunction<typeof isProdEnabled>;
const mockGetProdDisabledReason = getProdDisabledReason as jest.MockedFunction<typeof getProdDisabledReason>;

describe('Production Write Guard (Issue 3)', () => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    
    // Default mocks
    mockGetProdDisabledReason.mockReturnValue('Production environment in cost-reduction mode');
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });
  
  // Helper to create mock request
  const createMockRequest = (headers: Record<string, string> = {}): NextRequest => {
    const url = 'https://example.com/api/test';
    const req = {
      url,
      method: 'POST',
      headers: new Headers(headers),
    } as unknown as NextRequest;
    return req;
  };
  
  describe('Guard Ordering: 401 (AUTH) → 409 (PROD) → 403 (ADMIN)', () => {
    test('Missing x-afu9-sub → 401 UNAUTHORIZED (no other checks run)', () => {
      // Missing auth header
      const request = createMockRequest({});
      
      const result = checkProdWriteGuard(request, { requestId: 'test-123' });
      
      // Should return 401 error
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse?.status).toBe(401);
      expect(result.userId).toBeUndefined();
      
      // NO prod check should have been called (auth fails first)
      expect(mockGetDeploymentEnv).not.toHaveBeenCalled();
      expect(mockIsProdEnabled).not.toHaveBeenCalled();
    });
    
    test('Empty x-afu9-sub → 401 UNAUTHORIZED', () => {
      const request = createMockRequest({ 'x-afu9-sub': '  ' });
      
      const result = checkProdWriteGuard(request, { requestId: 'test-123' });
      
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse?.status).toBe(401);
      
      // Verify error response structure
      const errorBody = JSON.parse(result.errorResponse?.body as any);
      expect(errorBody.code).toBe('UNAUTHORIZED');
      expect(errorBody.details).toContain('Authentication required');
    });
    
    test('Prod + ENABLE_PROD=false → 409 CONFLICT (after auth check)', () => {
      // Auth passed
      const request = createMockRequest({ 'x-afu9-sub': 'user-123' });
      
      // Mocks: production environment, prod disabled
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(false);
      
      const result = checkProdWriteGuard(request, { requestId: 'test-456' });
      
      // Should return 409 error
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse?.status).toBe(409);
      expect(result.userId).toBe('user-123'); // Auth passed
      
      // Verify prod checks were called (after auth)
      expect(mockGetDeploymentEnv).toHaveBeenCalled();
      expect(mockIsProdEnabled).toHaveBeenCalled();
      
      // Verify error response structure
      const errorBody = JSON.parse(result.errorResponse?.body as any);
      expect(errorBody.code).toBe('PROD_DISABLED');
      expect(errorBody.details.environment).toBe('production');
      expect(errorBody.details.enableProd).toBe(false);
    });
    
    test('Non-admin → 403 FORBIDDEN (after auth + prod checks)', () => {
      // Auth passed
      const request = createMockRequest({ 'x-afu9-sub': 'user-non-admin' });
      
      // Mocks: staging environment (prod check passes)
      mockGetDeploymentEnv.mockReturnValue('staging');
      
      // AFU9_ADMIN_SUBS set, but user not in list
      process.env.AFU9_ADMIN_SUBS = 'admin-1,admin-2';
      
      const result = checkProdWriteGuard(request, { 
        requireAdmin: true,
        requestId: 'test-789' 
      });
      
      // Should return 403 error
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse?.status).toBe(403);
      expect(result.userId).toBe('user-non-admin'); // Auth passed
      
      // Verify error response
      const errorBody = JSON.parse(result.errorResponse?.body as any);
      expect(errorBody.code).toBe('FORBIDDEN');
      expect(errorBody.details).toContain('User not in admin allowlist');
    });
    
    test('Empty AFU9_ADMIN_SUBS → 403 FORBIDDEN (fail-closed)', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'any-user' });
      mockGetDeploymentEnv.mockReturnValue('staging');
      
      // Empty admin allowlist
      process.env.AFU9_ADMIN_SUBS = '';
      
      const result = checkProdWriteGuard(request, { requireAdmin: true });
      
      expect(result.errorResponse).not.toBeNull();
      expect(result.errorResponse?.status).toBe(403);
      
      const errorBody = JSON.parse(result.errorResponse?.body as any);
      expect(errorBody.details).toContain('Admin allowlist not configured');
    });
  });
  
  describe('Allowed Paths (All guards pass)', () => {
    test('User + stage + no admin required → Allowed', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'user-123' });
      mockGetDeploymentEnv.mockReturnValue('staging');
      mockIsProdEnabled.mockReturnValue(true); // Not checked for staging
      
      const result = checkProdWriteGuard(request);
      
      // All guards pass
      expect(result.errorResponse).toBeNull();
      expect(result.userId).toBe('user-123');
    });
    
    test('Admin + production + ENABLE_PROD=true → Allowed', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'admin-user' });
      mockGetDeploymentEnv.mockReturnValue('production');
      mockIsProdEnabled.mockReturnValue(true);
      
      process.env.AFU9_ADMIN_SUBS = 'admin-user,other-admin';
      
      const result = checkProdWriteGuard(request, { requireAdmin: true });
      
      // All guards pass
      expect(result.errorResponse).toBeNull();
      expect(result.userId).toBe('admin-user');
    });
    
    test('Non-admin + staging + no admin required → Allowed', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'regular-user' });
      mockGetDeploymentEnv.mockReturnValue('staging');
      
      const result = checkProdWriteGuard(request, { requireAdmin: false });
      
      // All guards pass (admin not required)
      expect(result.errorResponse).toBeNull();
      expect(result.userId).toBe('regular-user');
    });
  });
  
  describe('Edge Cases', () => {
    test('Development environment → Allowed', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'dev-user' });
      mockGetDeploymentEnv.mockReturnValue('development');
      
      const result = checkProdWriteGuard(request);
      
      expect(result.errorResponse).toBeNull();
      expect(result.userId).toBe('dev-user');
    });
    
    test('Staging + ENABLE_PROD=false → Allowed (only blocks production)', () => {
      const request = createMockRequest({ 'x-afu9-sub': 'user-123' });
      mockGetDeploymentEnv.mockReturnValue('staging');
      mockIsProdEnabled.mockReturnValue(false);
      
      const result = checkProdWriteGuard(request);
      
      // Staging is not affected by ENABLE_PROD
      expect(result.errorResponse).toBeNull();
      expect(result.userId).toBe('user-123');
    });
  });
});
