/**
 * Tests for deployment environment detection utility
 * 
 * @jest-environment node
 */

import { getDeploymentEnv, isProduction, isStaging } from '@/lib/utils/deployment-env';

describe('Deployment Environment Detection', () => {
  const originalEnv = process.env.ENVIRONMENT;

  afterEach(() => {
    // Restore original
    if (originalEnv !== undefined) {
      process.env.ENVIRONMENT = originalEnv;
    } else {
      delete process.env.ENVIRONMENT;
    }
  });

  describe('getDeploymentEnv', () => {
    test('returns "production" for ENVIRONMENT=production', () => {
      process.env.ENVIRONMENT = 'production';
      expect(getDeploymentEnv()).toBe('production');
    });

    test('returns "production" for ENVIRONMENT=prod', () => {
      process.env.ENVIRONMENT = 'prod';
      expect(getDeploymentEnv()).toBe('production');
    });

    test('returns "production" for ENVIRONMENT=PROD (uppercase)', () => {
      process.env.ENVIRONMENT = 'PROD';
      expect(getDeploymentEnv()).toBe('production');
    });

    test('returns "staging" for ENVIRONMENT=staging', () => {
      process.env.ENVIRONMENT = 'staging';
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for ENVIRONMENT=stage', () => {
      process.env.ENVIRONMENT = 'stage';
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for ENVIRONMENT=STAGE (uppercase)', () => {
      process.env.ENVIRONMENT = 'STAGE';
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for missing ENVIRONMENT (fail-safe)', () => {
      delete process.env.ENVIRONMENT;
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for empty ENVIRONMENT (fail-safe)', () => {
      process.env.ENVIRONMENT = '';
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for whitespace ENVIRONMENT (fail-safe)', () => {
      process.env.ENVIRONMENT = '   ';
      expect(getDeploymentEnv()).toBe('staging');
    });

    test('returns "staging" for invalid ENVIRONMENT (fail-safe)', () => {
      process.env.ENVIRONMENT = 'development';
      expect(getDeploymentEnv()).toBe('staging');
    });
  });

  describe('isProduction', () => {
    test('returns true when ENVIRONMENT=production', () => {
      process.env.ENVIRONMENT = 'production';
      expect(isProduction()).toBe(true);
    });

    test('returns true when ENVIRONMENT=prod', () => {
      process.env.ENVIRONMENT = 'prod';
      expect(isProduction()).toBe(true);
    });

    test('returns false when ENVIRONMENT=staging', () => {
      process.env.ENVIRONMENT = 'staging';
      expect(isProduction()).toBe(false);
    });

    test('returns false when ENVIRONMENT is missing', () => {
      delete process.env.ENVIRONMENT;
      expect(isProduction()).toBe(false);
    });
  });

  describe('isStaging', () => {
    test('returns true when ENVIRONMENT=staging', () => {
      process.env.ENVIRONMENT = 'staging';
      expect(isStaging()).toBe(true);
    });

    test('returns true when ENVIRONMENT=stage', () => {
      process.env.ENVIRONMENT = 'stage';
      expect(isStaging()).toBe(true);
    });

    test('returns false when ENVIRONMENT=production', () => {
      process.env.ENVIRONMENT = 'production';
      expect(isStaging()).toBe(false);
    });

    test('returns true when ENVIRONMENT is missing (fail-safe)', () => {
      delete process.env.ENVIRONMENT;
      expect(isStaging()).toBe(true);
    });
  });
});
