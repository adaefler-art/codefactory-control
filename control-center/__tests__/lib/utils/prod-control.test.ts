/**
 * Tests for Issue 3: Production API write guard
 * 
 * Verifies that API endpoints block write operations when ENABLE_PROD=false
 */

import { isProdEnabled, isWriteAllowedInProd, getProdDisabledReason } from '@/lib/utils/prod-control';

describe('Production Control - Issue 3', () => {
  const originalEnv = process.env.ENABLE_PROD;

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.ENABLE_PROD = originalEnv;
    } else {
      delete process.env.ENABLE_PROD;
    }
  });

  describe('isProdEnabled', () => {
    it('should return false when ENABLE_PROD is not set (fail-closed)', () => {
      delete process.env.ENABLE_PROD;
      expect(isProdEnabled()).toBe(false);
    });

    it('should return false when ENABLE_PROD=false', () => {
      process.env.ENABLE_PROD = 'false';
      expect(isProdEnabled()).toBe(false);
    });

    it('should return true when ENABLE_PROD=true', () => {
      process.env.ENABLE_PROD = 'true';
      expect(isProdEnabled()).toBe(true);
    });
  });

  describe('isWriteAllowedInProd', () => {
    it('should block writes in production when ENABLE_PROD=false', () => {
      process.env.ENABLE_PROD = 'false';
      expect(isWriteAllowedInProd('production')).toBe(false);
    });

    it('should allow writes in production when ENABLE_PROD=true', () => {
      process.env.ENABLE_PROD = 'true';
      expect(isWriteAllowedInProd('production')).toBe(true);
    });

    it('should always allow writes in staging regardless of ENABLE_PROD', () => {
      process.env.ENABLE_PROD = 'false';
      expect(isWriteAllowedInProd('staging')).toBe(true);

      process.env.ENABLE_PROD = 'true';
      expect(isWriteAllowedInProd('staging')).toBe(true);
    });

    it('should always allow writes in development regardless of ENABLE_PROD', () => {
      process.env.ENABLE_PROD = 'false';
      expect(isWriteAllowedInProd('development')).toBe(true);

      process.env.ENABLE_PROD = 'true';
      expect(isWriteAllowedInProd('development')).toBe(true);
    });
  });

  describe('getProdDisabledReason', () => {
    it('should return a meaningful error message', () => {
      const reason = getProdDisabledReason();
      expect(reason).toContain('Production environment');
      expect(reason).toContain('cost-reduction');
      expect(reason).toContain('staging');
    });
  });
});
