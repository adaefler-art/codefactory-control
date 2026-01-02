/**
 * Effective Configuration Resolution
 * 
 * Merges build-time and runtime environment values to compute effective configuration.
 * Detects missing expected flags and provides source attribution.
 * 
 * E7.0.4: Prevents "latent features" by ensuring code-expected flags are actually set
 */

import { FLAGS_CATALOG, FlagConfig, ConfigType } from './flags-env-catalog';

/**
 * Source of a configuration value
 */
export enum ConfigSource {
  BUILD = 'build',
  ENV = 'environment',
  DEFAULT = 'default',
  MISSING = 'missing',
}

/**
 * Effective configuration value with source tracking
 */
export interface EffectiveConfigValue {
  key: string;
  value: string | number | boolean | null;
  source: ConfigSource;
  expectedType: ConfigType;
  actualType: string;
  isSet: boolean;
  isMissing: boolean;
  config: FlagConfig;
}

/**
 * Report of effective configuration
 */
export interface EffectiveConfigReport {
  timestamp: string;
  environment: string;
  values: EffectiveConfigValue[];
  missing: EffectiveConfigValue[];
  missingRequired: EffectiveConfigValue[];
  summary: {
    total: number;
    set: number;
    missing: number;
    missingRequired: number;
    fromBuild: number;
    fromEnv: number;
    fromDefault: number;
  };
}

/**
 * Parse environment value based on expected type
 */
function parseEnvValue(value: string | undefined, type: ConfigType): any {
  if (value === undefined || value === '') {
    return null;
  }

  switch (type) {
    case ConfigType.BOOLEAN:
      return value.toLowerCase() === 'true' || value === '1';
    case ConfigType.NUMBER:
      const num = Number(value);
      return isNaN(num) ? null : num;
    case ConfigType.JSON:
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    case ConfigType.STRING:
    default:
      return value;
  }
}

/**
 * Get actual type of a value
 */
function getActualType(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return 'json';
  }
  return typeof value;
}

/**
 * Resolve effective value for a single flag
 */
function resolveEffectiveValue(flagConfig: FlagConfig): EffectiveConfigValue {
  const { key, type, defaultValue, source: configSource } = flagConfig;
  
  let value: any = null;
  let source: ConfigSource = ConfigSource.MISSING;
  let isSet = false;

  // Check environment variable
  const envValue = process.env[key];
  
  if (envValue !== undefined && envValue !== '') {
    value = parseEnvValue(envValue, type);
    source = ConfigSource.ENV;
    isSet = true;
  } else if (defaultValue !== undefined && defaultValue !== null) {
    // Use default value if no env var is set
    value = defaultValue;
    source = ConfigSource.DEFAULT;
    isSet = false; // Defaults don't count as "set"
  }

  // For build-time configs, also check build-specific env vars
  if (configSource === 'build' && !isSet) {
    // Build-time values might also be in NEXT_PUBLIC_ or VERCEL_ prefixed vars
    const alternativeKeys = [
      `NEXT_PUBLIC_${key}`,
      `VERCEL_${key}`,
    ];
    
    for (const altKey of alternativeKeys) {
      const altValue = process.env[altKey];
      if (altValue !== undefined && altValue !== '') {
        value = parseEnvValue(altValue, type);
        source = ConfigSource.BUILD;
        isSet = true;
        break;
      }
    }
  }

  const actualType = getActualType(value);
  const isMissing = !isSet && flagConfig.required;

  return {
    key,
    value,
    source,
    expectedType: type,
    actualType,
    isSet,
    isMissing,
    config: flagConfig,
  };
}

/**
 * Resolve effective configuration for all flags
 */
export function resolveEffectiveConfig(): EffectiveConfigReport {
  const values: EffectiveConfigValue[] = [];
  const missing: EffectiveConfigValue[] = [];
  const missingRequired: EffectiveConfigValue[] = [];

  let fromBuild = 0;
  let fromEnv = 0;
  let fromDefault = 0;
  let set = 0;

  for (const flagConfig of FLAGS_CATALOG.flags) {
    const effectiveValue = resolveEffectiveValue(flagConfig);
    values.push(effectiveValue);

    if (effectiveValue.isSet) {
      set++;
      if (effectiveValue.source === ConfigSource.BUILD) fromBuild++;
      if (effectiveValue.source === ConfigSource.ENV) fromEnv++;
    } else if (effectiveValue.source === ConfigSource.DEFAULT) {
      fromDefault++;
    }

    if (!effectiveValue.isSet && effectiveValue.source === ConfigSource.MISSING) {
      missing.push(effectiveValue);
      if (flagConfig.required) {
        missingRequired.push(effectiveValue);
      }
    }
  }

  const environment = process.env.NODE_ENV || 'development';

  return {
    timestamp: new Date().toISOString(),
    environment,
    values,
    missing,
    missingRequired,
    summary: {
      total: values.length,
      set,
      missing: missing.length,
      missingRequired: missingRequired.length,
      fromBuild,
      fromEnv,
      fromDefault,
    },
  };
}

/**
 * Check if all required flags are set
 * Returns list of missing required flags or empty array if all set
 */
export function checkRequiredFlags(): string[] {
  const report = resolveEffectiveConfig();
  return report.missingRequired.map(v => v.key);
}

/**
 * Sanitize sensitive values for display
 * Returns masked value for secrets, full value for non-secrets
 */
export function sanitizeValue(effectiveValue: EffectiveConfigValue): any {
  const { value, config } = effectiveValue;
  
  // Check if this is a secret (tagged as 'secret')
  const isSecret = config.tags.includes('secret');
  
  if (isSecret && value !== null && value !== undefined) {
    // Mask secrets
    if (typeof value === 'string') {
      if (value.length <= 4) {
        return '***';
      }
      return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
    }
    return '***';
  }
  
  return value;
}

/**
 * Get effective config report with sanitized values
 */
export function getEffectiveConfigReportSanitized(): EffectiveConfigReport {
  const report = resolveEffectiveConfig();
  
  // Sanitize values
  const sanitizedValues = report.values.map(v => ({
    ...v,
    value: sanitizeValue(v),
  }));
  
  return {
    ...report,
    values: sanitizedValues,
  };
}
