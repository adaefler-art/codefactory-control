/**
 * Tests for Config Manager
 */

import { ConfigManager } from '../config/config-manager';

describe('ConfigManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getConfig', () => {
    it('should load configuration from environment variables', () => {
      process.env.GITHUB_APP_ID = 'test-app-id';
      process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
      process.env.GITHUB_PRIVATE_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
      process.env.AWS_REGION = 'us-west-2';
      process.env.STEP_FUNCTION_ARN = 'arn:aws:states:us-west-2:123456789012:stateMachine:test';

      const manager = new ConfigManager('us-west-2');
      const config = manager.getConfig();

      expect(config.github.appId).toBe('test-app-id');
      expect(config.github.webhookSecret).toBe('test-webhook-secret');
      expect(config.aws.region).toBe('us-west-2');
    });

    it('should throw error for missing required variables', () => {
      process.env.GITHUB_APP_ID = '';
      
      const manager = new ConfigManager();
      
      expect(() => manager.getConfig()).toThrow('Missing required environment variable');
    });

    it('should use default region if not specified', () => {
      process.env.GITHUB_APP_ID = 'test-app-id';
      process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret';
      process.env.GITHUB_PRIVATE_KEY_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test';
      process.env.STEP_FUNCTION_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test';

      const manager = new ConfigManager();
      const config = manager.getConfig();

      expect(config.aws.region).toBe('us-east-1');
    });
  });
});
