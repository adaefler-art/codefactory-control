/**
 * Tests for deployment environment detection utility
 * 
 * @jest-environment node
 */

import { getDeploymentEnv, isProduction, isStaging, isUnknown } from '@/lib/utils/deployment-env';

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

    test('returns "unknown" for missing ENVIRONMENT (fail-closed)', () => {
      delete process.env.ENVIRONMENT;
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for empty ENVIRONMENT (fail-closed)', () => {
      process.env.ENVIRONMENT = '';
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for whitespace ENVIRONMENT (fail-closed)', () => {
      process.env.ENVIRONMENT = '   ';
      expect(getDeploymentEnv()).toBe('unknown');
    });

    test('returns "unknown" for invalid ENVIRONMENT (fail-closed)', () => {
      process.env.ENVIRONMENT = 'development';
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

    test('returns false when ENVIRONMENT is missing (unknown)', () => {
      delete process.env.ENVIRONMENT;
      expect(isStaging()).toBe(false);
    });

    test('returns false when ENVIRONMENT is unknown', () => {
      process.env.ENVIRONMENT = 'development';
      expect(isStaging()).toBe(false);
    });
  });

  describe('isUnknown', () => {
    test('returns true when ENVIRONMENT is missing', () => {
      delete process.env.ENVIRONMENT;
      expect(isUnknown()).toBe(true);
    });

    test('returns true when ENVIRONMENT is empty', () => {
      process.env.ENVIRONMENT = '';
      expect(isUnknown()).toBe(true);
    });

    test('returns true when ENVIRONMENT is invalid', () => {
      process.env.ENVIRONMENT = 'development';
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
  });
});
