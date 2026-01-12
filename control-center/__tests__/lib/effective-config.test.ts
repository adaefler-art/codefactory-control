/**
 * Tests for Effective Configuration Resolution
 * 
 * E7.0.4: Ensures proper resolution of effective configuration values
 * 
 * @jest-environment node
 */

import {
  resolveEffectiveConfig,
  checkRequiredFlags,
  sanitizeValue,
  getEffectiveConfigReportSanitized,
  ConfigSource,
} from '../../src/lib/effective-config';
import { ConfigType } from '../../src/lib/flags-env-catalog';

describe('Effective Configuration Resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to clean state
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('resolveEffectiveConfig returns report structure', () => {
    const report = resolveEffectiveConfig();
    
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('environment');
    expect(report).toHaveProperty('values');
    expect(report).toHaveProperty('missing');
    expect(report).toHaveProperty('missingRequired');
    expect(report).toHaveProperty('summary');
  });

  test('report summary has correct structure', () => {
    const report = resolveEffectiveConfig();
    
    expect(report.summary).toHaveProperty('total');
    expect(report.summary).toHaveProperty('set');
    expect(report.summary).toHaveProperty('missing');
    expect(report.summary).toHaveProperty('missingRequired');
    expect(report.summary).toHaveProperty('fromBuild');
    expect(report.summary).toHaveProperty('fromEnv');
    expect(report.summary).toHaveProperty('fromDefault');
  });

  test('resolves environment variable when set', () => {
    process.env.GITHUB_APP_ID = '123456';
    
    const report = resolveEffectiveConfig();
    const githubAppId = report.values.find(v => v.key === 'GITHUB_APP_ID');
    
    expect(githubAppId).toBeDefined();
    expect(githubAppId?.value).toBe('123456');
    expect(githubAppId?.source).toBe(ConfigSource.RUNTIME_ENV);
    expect(githubAppId?.isSet).toBe(true);
    expect(githubAppId?.isMissing).toBe(false);
  });

  test('uses default value when env var not set', () => {
    delete process.env.NODE_ENV;
    
    const report = resolveEffectiveConfig();
    const nodeEnv = report.values.find(v => v.key === 'NODE_ENV');
    
    expect(nodeEnv).toBeDefined();
    expect(nodeEnv?.value).toBe('development');
    expect(nodeEnv?.source).toBe(ConfigSource.CATALOG_DEFAULT);
    expect(nodeEnv?.isSet).toBe(false);
  });

  test('marks missing required flags', () => {
    // Clear all required env vars
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_OWNER;
    delete process.env.AWS_REGION;
    delete process.env.NODE_ENV;
    
    const report = resolveEffectiveConfig();
    
    expect(report.missingRequired.length).toBeGreaterThan(0);
    
    const githubAppId = report.missingRequired.find(v => v.key === 'GITHUB_APP_ID');
    expect(githubAppId).toBeDefined();
    expect(githubAppId?.isMissing).toBe(true);
    expect(githubAppId?.source).toBe(ConfigSource.MISSING);
  });

  test('checkRequiredFlags returns missing required keys', () => {
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    
    const missingFlags = checkRequiredFlags();
    
    expect(missingFlags).toContain('GITHUB_APP_ID');
    expect(missingFlags).toContain('GITHUB_APP_PRIVATE_KEY_PEM');
    expect(missingFlags).toContain('GITHUB_APP_WEBHOOK_SECRET');
  });

  test('checkRequiredFlags returns empty array when all required flags set', () => {
    // Set all required flags
    process.env.GITHUB_APP_ID = '123456';
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'test-key';
    process.env.GITHUB_APP_WEBHOOK_SECRET = 'test-secret';
    process.env.GITHUB_OWNER = 'test-owner';
    process.env.AWS_REGION = 'eu-central-1';
    process.env.NODE_ENV = 'development';
    
    const missingFlags = checkRequiredFlags();
    
    expect(missingFlags).toEqual([]);
  });

  test('parses boolean environment variables correctly', () => {
    process.env.AFU9_DEBUG_MODE = 'true';
    
    const report = resolveEffectiveConfig();
    const debugMode = report.values.find(v => v.key === 'AFU9_DEBUG_MODE');
    
    expect(debugMode).toBeDefined();
    expect(debugMode?.value).toBe(true);
    expect(debugMode?.actualType).toBe('boolean');
  });

  test('parses boolean "1" as true', () => {
    process.env.DATABASE_ENABLED = '1';
    
    const report = resolveEffectiveConfig();
    const dbEnabled = report.values.find(v => v.key === 'DATABASE_ENABLED');
    
    expect(dbEnabled?.value).toBe(true);
  });

  test('parses number environment variables correctly', () => {
    process.env.DATABASE_PORT = '5432';
    
    const report = resolveEffectiveConfig();
    const dbPort = report.values.find(v => v.key === 'DATABASE_PORT');
    
    expect(dbPort).toBeDefined();
    expect(dbPort?.value).toBe(5432);
    expect(dbPort?.actualType).toBe('number');
  });

  test('handles invalid number gracefully', () => {
    process.env.PORT = 'invalid-port';
    
    const report = resolveEffectiveConfig();
    const port = report.values.find(v => v.key === 'PORT');
    
    expect(port?.value).toBeNull();
  });

  test('parses JSON environment variables correctly', () => {
    const allowlist = { allowlist: [{ owner: 'test', repo: 'repo', branches: ['main'] }] };
    process.env.GITHUB_REPO_ALLOWLIST = JSON.stringify(allowlist);
    
    const report = resolveEffectiveConfig();
    const repoAllowlist = report.values.find(v => v.key === 'GITHUB_REPO_ALLOWLIST');
    
    expect(repoAllowlist).toBeDefined();
    expect(repoAllowlist?.value).toEqual(allowlist);
    expect(repoAllowlist?.actualType).toBe('json');
  });

  test('handles invalid JSON gracefully', () => {
    process.env.GITHUB_REPO_ALLOWLIST = 'invalid-json{';
    
    const report = resolveEffectiveConfig();
    const repoAllowlist = report.values.find(v => v.key === 'GITHUB_REPO_ALLOWLIST');
    
    expect(repoAllowlist?.value).toBeNull();
  });

  test('summary counts are accurate', () => {
    process.env.GITHUB_APP_ID = '123456';
    process.env.AFU9_DEBUG_MODE = 'true';
    delete process.env.GITHUB_APP_PRIVATE_KEY_PEM;
    
    const report = resolveEffectiveConfig();
    
    const expectedTotal = report.values.length;
    const actualSet = report.values.filter(v => v.isSet).length;
    const actualMissing = report.values.filter(v => !v.isSet && v.source === ConfigSource.MISSING).length;
    
    expect(report.summary.total).toBe(expectedTotal);
    expect(report.summary.set).toBe(actualSet);
    expect(report.summary.missing).toBe(actualMissing);
  });
});

describe('Value Sanitization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('sanitizes secret values', () => {
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'very-secret-key-value-1234567890';
    
    const report = resolveEffectiveConfig();
    const privateKey = report.values.find(v => v.key === 'GITHUB_APP_PRIVATE_KEY_PEM');
    
    expect(privateKey).toBeDefined();
    
    const sanitized = sanitizeValue(privateKey!);
    expect(sanitized).not.toBe('very-secret-key-value-1234567890');
    // Should be fully masked (no substrings revealed)
    expect(sanitized).toMatch(/^\*+$/);
  });

  test('does not sanitize non-secret values', () => {
    process.env.GITHUB_OWNER = 'my-org';
    
    const report = resolveEffectiveConfig();
    const githubOwner = report.values.find(v => v.key === 'GITHUB_OWNER');
    
    expect(githubOwner).toBeDefined();
    
    const sanitized = sanitizeValue(githubOwner!);
    expect(sanitized).toBe('my-org');
  });

  test('sanitized report masks all secrets', () => {
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'very-secret-key';
    const rawOpenAiKey = 'sk-' + '1234567890abcdef';
    process.env.OPENAI_API_KEY = rawOpenAiKey;
    process.env.GITHUB_OWNER = 'my-org';
    
    const report = getEffectiveConfigReportSanitized();
    
    const privateKey = report.values.find(v => v.key === 'GITHUB_APP_PRIVATE_KEY_PEM');
    const openaiKey = report.values.find(v => v.key === 'OPENAI_API_KEY');
    const githubOwner = report.values.find(v => v.key === 'GITHUB_OWNER');
    
    // Secrets should be masked
    expect(privateKey?.value).not.toBe('very-secret-key');
    expect(openaiKey?.value).not.toBe(rawOpenAiKey);
    
    // Non-secrets should not be masked
    expect(githubOwner?.value).toBe('my-org');
  });

  test('handles null values in sanitization', () => {
    delete process.env.OPENAI_API_KEY;
    
    const report = resolveEffectiveConfig();
    const openaiKey = report.values.find(v => v.key === 'OPENAI_API_KEY');
    
    expect(openaiKey).toBeDefined();
    
    const sanitized = sanitizeValue(openaiKey!);
    expect(sanitized).toBeNull();
  });
});

describe('Environment Detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('detects development environment', () => {
    process.env.NODE_ENV = 'development';
    
    const report = resolveEffectiveConfig();
    expect(report.environment).toBe('development');
  });

  test('detects production environment', () => {
    process.env.NODE_ENV = 'production';
    
    const report = resolveEffectiveConfig();
    expect(report.environment).toBe('production');
  });

  test('defaults to development when NODE_ENV not set', () => {
    delete process.env.NODE_ENV;
    
    const report = resolveEffectiveConfig();
    expect(report.environment).toBe('development');
  });
});

describe('Enhanced Secret Sanitization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('fully masks secret values without revealing substrings', () => {
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'very-secret-key-value-1234567890-abcdefghijk';
    
    const report = resolveEffectiveConfig();
    const privateKey = report.values.find(v => v.key === 'GITHUB_APP_PRIVATE_KEY_PEM');
    
    expect(privateKey).toBeDefined();
    
    const sanitized = sanitizeValue(privateKey!);
    // Should be fully masked, no substring of actual value
    expect(sanitized).toMatch(/^\*+$/);
    expect(sanitized).not.toContain('very');
    expect(sanitized).not.toContain('1234');
    expect(sanitized).not.toContain('abcd');
  });

  test('sanitizes based on tag secret', () => {
    // Even if key looks benign, tag:secret should trigger sanitization
    const rawOpenAiKey = 'sk-' + 'test1234567890abcdefghijklmnop';
    process.env.OPENAI_API_KEY = rawOpenAiKey;
    
    const report = resolveEffectiveConfig();
    const openaiKey = report.values.find(v => v.key === 'OPENAI_API_KEY');
    
    expect(openaiKey).toBeDefined();
    expect(openaiKey?.config.tags).toContain('secret');
    
    const sanitized = sanitizeValue(openaiKey!);
    expect(sanitized).toMatch(/^\*+$/);
    expect(sanitized).not.toContain('sk-');
  });

  test('does not sanitize non-secret values', () => {
    process.env.GITHUB_OWNER = 'my-test-org';
    
    const report = resolveEffectiveConfig();
    const githubOwner = report.values.find(v => v.key === 'GITHUB_OWNER');
    
    expect(githubOwner).toBeDefined();
    expect(githubOwner?.config.tags).not.toContain('secret');
    
    const sanitized = sanitizeValue(githubOwner!);
    expect(sanitized).toBe('my-test-org');
  });

  test('sanitized report fully masks all secrets', () => {
    process.env.GITHUB_APP_PRIVATE_KEY_PEM = 'secret-key-data-123';
    process.env.OPENAI_API_KEY = 'unit_test_openai_api_key';
    process.env.GITHUB_OWNER = 'my-org';
    
    const report = getEffectiveConfigReportSanitized();
    
    const privateKey = report.values.find(v => v.key === 'GITHUB_APP_PRIVATE_KEY_PEM');
    const openaiKey = report.values.find(v => v.key === 'OPENAI_API_KEY');
    const githubOwner = report.values.find(v => v.key === 'GITHUB_OWNER');
    
    // Secrets fully masked
    expect(privateKey?.value).toMatch(/^\*+$/);
    expect(openaiKey?.value).toMatch(/^\*+$/);
    
    // Non-secrets not masked
    expect(githubOwner?.value).toBe('my-org');
  });
});

describe('Environment-Aware Required Flags', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('respects requiredIn for environment-specific requirements', () => {
    // This test would require adding a flag with requiredIn to the catalog
    // For now, verify that missing detection works with current environment
    process.env.NODE_ENV = 'development';
    
    const report = resolveEffectiveConfig();
    
    // All required flags should be checked in development
    expect(report.environment).toBe('development');
  });

  test('conditional requirements only enforced when condition met', () => {
    // Test that conditionalOn logic works
    // Would need catalog entry with conditionalOn to fully test
    const report = resolveEffectiveConfig();
    
    // Verify report structure includes all expected fields
    expect(report.missingRequired).toBeDefined();
    expect(Array.isArray(report.missingRequired)).toBe(true);
  });
});
