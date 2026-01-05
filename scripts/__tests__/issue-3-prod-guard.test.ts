/**
 * Tests for Issue 3: Production deployment guardrail
 * 
 * Verifies that ENABLE_PROD flag correctly blocks production deploys
 */

import { isProdEnabled } from '../deploy-context-guardrail';

describe('Deploy Context Guardrail - Issue 3 (Prod Disabled)', () => {
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

    it('should return false when ENABLE_PROD is empty string', () => {
      process.env.ENABLE_PROD = '';
      expect(isProdEnabled()).toBe(false);
    });

    it('should return false when ENABLE_PROD=0', () => {
      process.env.ENABLE_PROD = '0';
      expect(isProdEnabled()).toBe(false);
    });

    it('should return false when ENABLE_PROD=no', () => {
      process.env.ENABLE_PROD = 'no';
      expect(isProdEnabled()).toBe(false);
    });

    it('should return true when ENABLE_PROD=true', () => {
      process.env.ENABLE_PROD = 'true';
      expect(isProdEnabled()).toBe(true);
    });

    it('should return false for any value other than "true" (fail-closed)', () => {
      const testCases = ['True', 'TRUE', '1', 'yes', 'YES', 'enabled', 'on'];
      
      for (const testCase of testCases) {
        process.env.ENABLE_PROD = testCase;
        expect(isProdEnabled()).toBe(false);
      }
    });
  });
});
