/**
 * Tests for context-validator.ts
 * 
 * This test file documents expected behavior for context key validation.
 * It serves as both documentation and validation of the context validation logic.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  CANONICAL_CONTEXT_KEYS,
  DEPRECATED_CONTEXT_KEYS,
  validateContextKeys,
  getValidatedContext,
  validateRequiredContext,
} from '../context-validator';

describe('Context Validator', () => {
  describe('CANONICAL_CONTEXT_KEYS', () => {
    it('should define all afu9-* context keys', () => {
      const afu9Keys = Object.keys(CANONICAL_CONTEXT_KEYS).filter(k => k.startsWith('afu9-'));
      
      expect(afu9Keys).toContain('afu9-enable-database');
      expect(afu9Keys).toContain('afu9-enable-https');
      expect(afu9Keys).toContain('afu9-manage-dns');
      expect(afu9Keys).toContain('afu9-multi-env');
      expect(afu9Keys).toContain('afu9-create-staging-service');
      expect(afu9Keys).toContain('afu9-domain');
      expect(afu9Keys).toContain('afu9-hosted-zone-id');
      expect(afu9Keys).toContain('afu9-hosted-zone-name');
      expect(afu9Keys).toContain('afu9-alarm-email');
      expect(afu9Keys).toContain('afu9-webhook-url');
      expect(afu9Keys).toContain('afu9-cognito-domain-prefix');
    });

    it('should define all required context keys', () => {
      expect(CANONICAL_CONTEXT_KEYS).toHaveProperty('github-org');
      expect(CANONICAL_CONTEXT_KEYS).toHaveProperty('github-repo');
      expect(CANONICAL_CONTEXT_KEYS).toHaveProperty('environment');
      expect(CANONICAL_CONTEXT_KEYS).toHaveProperty('dbSecretArn');
      expect(CANONICAL_CONTEXT_KEYS).toHaveProperty('dbSecretName');
    });

    it('should have descriptions for all keys', () => {
      for (const [key, def] of Object.entries(CANONICAL_CONTEXT_KEYS)) {
        expect(def).toHaveProperty('description');
        expect(typeof def.description).toBe('string');
        expect(def.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('DEPRECATED_CONTEXT_KEYS', () => {
    it('should map enableDatabase -> afu9-enable-database', () => {
      expect(DEPRECATED_CONTEXT_KEYS['enableDatabase']).toBe('afu9-enable-database');
    });

    it('should map enableHttps -> afu9-enable-https', () => {
      expect(DEPRECATED_CONTEXT_KEYS['enableHttps']).toBe('afu9-enable-https');
    });

    it('should map multiEnv -> afu9-multi-env', () => {
      expect(DEPRECATED_CONTEXT_KEYS['multiEnv']).toBe('afu9-multi-env');
    });

    it('should map domainName -> afu9-domain', () => {
      expect(DEPRECATED_CONTEXT_KEYS['domainName']).toBe('afu9-domain');
    });

    it('should map stage -> environment', () => {
      expect(DEPRECATED_CONTEXT_KEYS['stage']).toBe('environment');
    });
  });

  describe('getValidatedContext', () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      // Create a fresh app for each test to avoid context pollution
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
    });

    it('should return canonical context value when set', () => {
      app = new cdk.App({
        context: {
          'afu9-enable-database': true,
        },
      });
      stack = new cdk.Stack(app, 'TestStack');

      const value = getValidatedContext<boolean>(stack, 'afu9-enable-database');
      expect(value).toBe(true);
    });

    it('should return default value when context not set', () => {
      const value = getValidatedContext<boolean>(stack, 'afu9-enable-database');
      expect(value).toBe(true); // default is true
    });

    it('should default new flags to false when not set', () => {
      expect(getValidatedContext<boolean>(stack, 'afu9-manage-dns')).toBe(false);
      expect(getValidatedContext<boolean>(stack, 'afu9-create-staging-service')).toBe(false);
    });

    it('should return deprecated value with warning when only deprecated key is set', () => {
      app = new cdk.App({
        context: {
          'enableDatabase': false,
        },
      });
      stack = new cdk.Stack(app, 'TestStack');

      const value = getValidatedContext<boolean>(stack, 'afu9-enable-database');
      expect(value).toBe(false);

      // Note: Deprecation warning should be issued (can be seen in CDK output)
    });

    it('should prefer canonical value over deprecated when both are set', () => {
      app = new cdk.App({
        context: {
          'afu9-enable-database': true,
          'enableDatabase': false,
        },
      });
      stack = new cdk.Stack(app, 'TestStack');

      const value = getValidatedContext<boolean>(stack, 'afu9-enable-database');
      expect(value).toBe(true); // canonical value takes precedence

      // Note: Warning about both keys being set should be issued (can be seen in CDK output)
    });

    it('should return undefined for optional keys when not set and no default', () => {
      const value = getValidatedContext<string>(stack, 'afu9-domain');
      expect(value).toBeUndefined();
    });

    it('should throw error for unknown context key', () => {
      expect(() => {
        getValidatedContext(stack, 'unknown-key' as any);
      }).toThrow('Unknown context key');
    });
  });

  describe('validateRequiredContext', () => {
    let app: cdk.App;
    let stack: cdk.Stack;

    beforeEach(() => {
      app = new cdk.App();
      stack = new cdk.Stack(app, 'TestStack');
    });

    it('should not throw when all required keys are provided', () => {
      app = new cdk.App({
        context: {
          'github-org': 'test-org',
          'github-repo': 'test-repo',
        },
      });
      stack = new cdk.Stack(app, 'TestStack');

      expect(() => {
        validateRequiredContext(stack, ['github-org', 'github-repo']);
      }).not.toThrow();
    });

    it('should use defaults for required keys when not provided', () => {
      // github-org and github-repo have defaults
      expect(() => {
        validateRequiredContext(stack, ['github-org', 'github-repo']);
      }).not.toThrow();
    });

    it('should throw when required key without default is missing', () => {
      expect(() => {
        validateRequiredContext(stack, ['afu9-domain']);
      }).toThrow('Missing required context keys');
      expect(() => {
        validateRequiredContext(stack, ['afu9-domain']);
      }).toThrow('afu9-domain');
    });

    it('should throw with helpful error message listing all missing keys', () => {
      try {
        validateRequiredContext(stack, ['afu9-domain', 'afu9-alarm-email']);
        fail('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toContain('afu9-domain');
        expect(error.message).toContain('afu9-alarm-email');
        expect(error.message).toContain('Missing required context keys');
      }
    });
  });

  describe('Context Key Documentation', () => {
    it('should document feature toggles', () => {
      expect(CANONICAL_CONTEXT_KEYS['afu9-enable-database'].description).toContain('database');
      expect(CANONICAL_CONTEXT_KEYS['afu9-enable-https'].description).toContain('HTTPS');
      expect(CANONICAL_CONTEXT_KEYS['afu9-multi-env'].description).toContain('multi-environment');
    });

    it('should document DNS configuration', () => {
      expect(CANONICAL_CONTEXT_KEYS['afu9-domain'].description).toContain('domain');
      expect(CANONICAL_CONTEXT_KEYS['afu9-hosted-zone-id'].description).toContain('Route53');
      expect(CANONICAL_CONTEXT_KEYS['afu9-hosted-zone-name'].description).toContain('hosted zone');
    });

    it('should document monitoring configuration', () => {
      expect(CANONICAL_CONTEXT_KEYS['afu9-alarm-email'].description).toContain('alarm');
      expect(CANONICAL_CONTEXT_KEYS['afu9-webhook-url'].description).toContain('alarm');
    });

    it('should document authentication configuration', () => {
      expect(CANONICAL_CONTEXT_KEYS['afu9-cognito-domain-prefix'].description).toContain('Cognito');
    });

    it('should document GitHub integration', () => {
      expect(CANONICAL_CONTEXT_KEYS['github-org'].description).toContain('GitHub');
      expect(CANONICAL_CONTEXT_KEYS['github-repo'].description).toContain('GitHub');
    });

    it('should document database configuration', () => {
      expect(CANONICAL_CONTEXT_KEYS['dbSecretArn'].description).toContain('database');
      expect(CANONICAL_CONTEXT_KEYS['dbSecretName'].description).toContain('database');
    });
  });

  describe('Integration with CDK', () => {
    it('should work with CDK App context', () => {
      const app = new cdk.App({
        context: {
          'afu9-enable-database': false,
          'afu9-enable-https': true,
        },
      });
      const stack = new cdk.Stack(app, 'TestStack');

      expect(getValidatedContext<boolean>(stack, 'afu9-enable-database')).toBe(false);
      expect(getValidatedContext<boolean>(stack, 'afu9-enable-https')).toBe(true);
    });

    it('should work with command-line context (-c)', () => {
      // This simulates: cdk deploy -c afu9-enable-database=false
      const app = new cdk.App({
        context: {
          'afu9-enable-database': 'false', // CLI passes strings
        },
      });
      const stack = new cdk.Stack(app, 'TestStack');

      const value = getValidatedContext<string>(stack, 'afu9-enable-database');
      expect(value).toBe('false');
    });

    it('should accept string booleans for new flags', () => {
      const app = new cdk.App({
        context: {
          'afu9-manage-dns': 'true',
          'afu9-create-staging-service': 'true',
        },
      });
      const stack = new cdk.Stack(app, 'TestStack');

      expect(getValidatedContext<string>(stack, 'afu9-manage-dns')).toBe('true');
      expect(getValidatedContext<string>(stack, 'afu9-create-staging-service')).toBe('true');
    });
  });
});
