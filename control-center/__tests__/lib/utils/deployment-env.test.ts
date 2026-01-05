/**
 * Tests for deployment environment detection utility
 * 
 * @jest-environment node
 */

import { getDeploymentEnv, isProduction, isStaging, isDevelopment, isUnknown } from '@/lib/utils/deployment-env';

describe('Deployment Environment Detection', () => {
  const originalEnv = process.env.ENVIRONMENT;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    // Restore original
    if (originalEnv !== undefined) {
      process.env.ENVIRONMENT = originalEnv;
    } else {
      delete process.env.ENVIRONMENT;
    }
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
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

    test('returns "development" for missing ENVIRONMENT + NODE_ENV=development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'development';
      expect(getDeploymentEnv()).toBe('development');
    });

    test('returns "unknown" for missing ENVIRONMENT + NODE_ENV=production (fail-closed)', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'production';
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for missing ENVIRONMENT + NODE_ENV=test (fail-closed)', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'test';
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for missing ENVIRONMENT + missing NODE_ENV (fail-closed)', () => {
      delete process.env.ENVIRONMENT;
      delete process.env.NODE_ENV;
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for empty ENVIRONMENT (fail-closed)', () => {
      process.env.ENVIRONMENT = '';
      process.env.NODE_ENV = 'development';
      expect(getDeploymentEnv()).toBe('development');
    });

    test('returns "unknown" for whitespace ENVIRONMENT (fail-closed)', () => {
      process.env.ENVIRONMENT = '   ';
      process.env.NODE_ENV = 'development';
      expect(getDeploymentEnv()).toBe('development');
    });

    test('returns "unknown" for invalid ENVIRONMENT string (fail-closed)', () => {
      process.env.ENVIRONMENT = 'testing';
      process.env.NODE_ENV = 'development';
      expect(getDeploymentEnv()).toBe('unknown');
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

    test('returns false when ENVIRONMENT is missing (unknown or development)', () => {
      delete process.env.ENVIRONMENT;
      delete process.env.NODE_ENV;
      expect(isStaging()).toBe(false);
    });

    test('returns false when in development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'development';
      expect(isStaging()).toBe(false);
    });

    test('returns false when ENVIRONMENT is unknown', () => {
      process.env.ENVIRONMENT = 'testing';
      expect(isStaging()).toBe(false);
    });
  });

  describe('isDevelopment', () => {
    test('returns true when ENVIRONMENT is missing and NODE_ENV=development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(true);
    });

    test('returns false when ENVIRONMENT=staging', () => {
      process.env.ENVIRONMENT = 'staging';
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(false);
    });

    test('returns false when ENVIRONMENT=production', () => {
      process.env.ENVIRONMENT = 'production';
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(false);
    });

    test('returns false when NODE_ENV is not development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'production';
      expect(isDevelopment()).toBe(false);
    });

    test('returns false when ENVIRONMENT is invalid (not development)', () => {
      process.env.ENVIRONMENT = 'testing';
      process.env.NODE_ENV = 'development';
      expect(isDevelopment()).toBe(false);
    });
  });

  describe('isUnknown', () => {
    test('returns true when ENVIRONMENT is missing and NODE_ENV is not development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'production';
      expect(isUnknown()).toBe(true);
    });

    test('returns true when ENVIRONMENT is missing and NODE_ENV is missing', () => {
      delete process.env.ENVIRONMENT;
      delete process.env.NODE_ENV;
      expect(isUnknown()).toBe(true);
    });

    test('returns true when ENVIRONMENT is empty and NODE_ENV is not development', () => {
      process.env.ENVIRONMENT = '';
      process.env.NODE_ENV = 'production';
      expect(isUnknown()).toBe(true);
    });

    test('returns true when ENVIRONMENT is invalid', () => {
      process.env.ENVIRONMENT = 'testing';
      expect(isUnknown()).toBe(true);
    });

    test('returns false when ENVIRONMENT=production', () => {
      process.env.ENVIRONMENT = 'production';
      expect(isUnknown()).toBe(false);
    });

    test('returns false when ENVIRONMENT=staging', () => {
      process.env.ENVIRONMENT = 'staging';
      expect(isUnknown()).toBe(false);
    });

    test('returns false when in development', () => {
      delete process.env.ENVIRONMENT;
      process.env.NODE_ENV = 'development';
      expect(isUnknown()).toBe(false);
    });
  });
});
