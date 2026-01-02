/**
 * Tests for Feature Flags & Environment Variables Catalog
 * 
 * E7.0.4: Ensures catalog schema validation and integrity
 * 
 * @jest-environment node
 */

import {
  FLAGS_CATALOG,
  FlagsCatalogSchema,
  FlagConfigSchema,
  RiskClass,
  AllowedEnvironment,
  ConfigType,
  getFlagConfig,
  getFlagsByTag,
  getRequiredFlags,
  getFlagsByRiskClass,
} from '../../src/lib/flags-env-catalog';

describe('Feature Flags Catalog Schema', () => {
  test('catalog validates against schema', () => {
    const result = FlagsCatalogSchema.safeParse(FLAGS_CATALOG);
    expect(result.success).toBe(true);
  });

  test('catalog has required metadata', () => {
    expect(FLAGS_CATALOG.version).toBeDefined();
    expect(FLAGS_CATALOG.lastUpdated).toBeDefined();
    expect(FLAGS_CATALOG.flags).toBeDefined();
    expect(Array.isArray(FLAGS_CATALOG.flags)).toBe(true);
  });

  test('all flags have unique keys', () => {
    const keys = FLAGS_CATALOG.flags.map(f => f.key);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  test('all flags validate against FlagConfigSchema', () => {
    FLAGS_CATALOG.flags.forEach(flag => {
      const result = FlagConfigSchema.safeParse(flag);
      expect(result.success).toBe(true);
    });
  });

  test('all flags have valid risk classifications', () => {
    const validRiskClasses = Object.values(RiskClass);
    FLAGS_CATALOG.flags.forEach(flag => {
      expect(validRiskClasses).toContain(flag.riskClass);
    });
  });

  test('all flags have valid allowed environments', () => {
    const validEnvironments = Object.values(AllowedEnvironment);
    FLAGS_CATALOG.flags.forEach(flag => {
      flag.allowedEnvironments.forEach(env => {
        expect(validEnvironments).toContain(env);
      });
    });
  });

  test('all flags have valid config types', () => {
    const validTypes = Object.values(ConfigType);
    FLAGS_CATALOG.flags.forEach(flag => {
      expect(validTypes).toContain(flag.type);
    });
  });

  test('all flags have non-empty descriptions', () => {
    FLAGS_CATALOG.flags.forEach(flag => {
      expect(flag.description.length).toBeGreaterThan(0);
    });
  });
});

describe('Flag Catalog Helper Functions', () => {
  test('getFlagConfig returns flag by key', () => {
    const flag = getFlagConfig('GITHUB_APP_ID');
    expect(flag).toBeDefined();
    expect(flag?.key).toBe('GITHUB_APP_ID');
  });

  test('getFlagConfig returns undefined for unknown key', () => {
    const flag = getFlagConfig('UNKNOWN_FLAG_KEY');
    expect(flag).toBeUndefined();
  });

  test('getFlagsByTag returns flags with specific tag', () => {
    const githubFlags = getFlagsByTag('github');
    expect(githubFlags.length).toBeGreaterThan(0);
    githubFlags.forEach(flag => {
      expect(flag.tags).toContain('github');
    });
  });

  test('getFlagsByTag returns empty array for non-existent tag', () => {
    const flags = getFlagsByTag('nonexistent-tag-xyz');
    expect(flags).toEqual([]);
  });

  test('getRequiredFlags returns only required flags', () => {
    const requiredFlags = getRequiredFlags();
    expect(requiredFlags.length).toBeGreaterThan(0);
    requiredFlags.forEach(flag => {
      expect(flag.required).toBe(true);
    });
  });

  test('getFlagsByRiskClass returns flags with specific risk class', () => {
    const criticalFlags = getFlagsByRiskClass(RiskClass.CRITICAL);
    expect(criticalFlags.length).toBeGreaterThan(0);
    criticalFlags.forEach(flag => {
      expect(flag.riskClass).toBe(RiskClass.CRITICAL);
    });
  });
});

describe('Catalog Critical Flags', () => {
  test('catalog includes critical GitHub configuration', () => {
    const githubAppId = getFlagConfig('GITHUB_APP_ID');
    expect(githubAppId).toBeDefined();
    expect(githubAppId?.required).toBe(true);
    expect(githubAppId?.riskClass).toBe(RiskClass.CRITICAL);
  });

  test('catalog includes database configuration', () => {
    const dbHost = getFlagConfig('DATABASE_HOST');
    expect(dbHost).toBeDefined();
    expect(dbHost?.tags).toContain('database');
  });

  test('catalog includes LLM provider configuration', () => {
    const openaiKey = getFlagConfig('OPENAI_API_KEY');
    expect(openaiKey).toBeDefined();
    expect(openaiKey?.tags).toContain('llm');
    expect(openaiKey?.tags).toContain('secret');
  });

  test('catalog includes debug mode flag', () => {
    const debugMode = getFlagConfig('AFU9_DEBUG_MODE');
    expect(debugMode).toBeDefined();
    expect(debugMode?.type).toBe(ConfigType.BOOLEAN);
    expect(debugMode?.tags).toContain('feature-flag');
  });

  test('catalog includes build metadata', () => {
    const gitSha = getFlagConfig('GIT_SHA');
    expect(gitSha).toBeDefined();
    expect(gitSha?.source).toBe('build');
    expect(gitSha?.tags).toContain('build');
  });
});

describe('Secret Tagging', () => {
  test('all secret flags are properly tagged', () => {
    const secretKeys = [
      'GITHUB_APP_PRIVATE_KEY_PEM',
      'GITHUB_APP_WEBHOOK_SECRET',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'DEEPSEEK_API_KEY',
      'DATABASE_USER',
      'DATABASE_PASSWORD',
    ];

    secretKeys.forEach(key => {
      const flag = getFlagConfig(key);
      expect(flag).toBeDefined();
      expect(flag?.tags).toContain('secret');
    });
  });

  test('secret flags have appropriate risk classifications', () => {
    const secrets = getFlagsByTag('secret');
    secrets.forEach(secret => {
      // Secrets should be at least HIGH risk
      expect([RiskClass.HIGH, RiskClass.CRITICAL]).toContain(secret.riskClass);
    });
  });
});

describe('Build vs Runtime Configuration', () => {
  test('build-time flags are properly marked', () => {
    const buildFlags = FLAGS_CATALOG.flags.filter(f => f.source === 'build');
    expect(buildFlags.length).toBeGreaterThan(0);
    buildFlags.forEach(flag => {
      expect(flag.tags).toContain('build');
    });
  });

  test('runtime flags are properly marked', () => {
    const runtimeFlags = FLAGS_CATALOG.flags.filter(f => f.source === 'runtime');
    expect(runtimeFlags.length).toBeGreaterThan(0);
  });
});
