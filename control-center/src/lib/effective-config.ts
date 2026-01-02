/**
 * Effective Configuration Resolution
 * 
 * Merges build-time and runtime environment values to compute effective configuration.
 * Detects missing expected flags and provides source attribution.
 * 
 * E7.0.4: Prevents "latent features" by ensuring code-expected flags are actually set
 */

import { FLAGS_CATALOG, FlagConfig, ConfigType, RiskClass } from './flags-env-catalog';

/**
 * Source of a configuration value
 */
export enum ConfigSource {
  BUILD_ARTIFACT = 'buildArtifact',
  RUNTIME_ENV = 'runtimeEnv',
  CATALOG_DEFAULT = 'catalogDefault',
  SECRET_MANAGER = 'secretManager',
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
 * Check if a flag is required in the given environment
 * Considers both global required flag and environment-specific requirements
 */
function isRequiredInEnvironment(flagConfig: FlagConfig, environment: string, currentValue: any): boolean {
  // If not marked as required at all, it's not required
  if (!flagConfig.required) {
    return false;
  }

  // Check conditional requirement
  if (flagConfig.conditionalOn) {
    const conditionKey = flagConfig.conditionalOn.key;
    const conditionValue = process.env[conditionKey];
    
    // If condition key is not set, requirement is not enforced
    if (conditionValue === undefined) {
      return false;
    }
    
    // If equals is specified, check if it matches
    if (flagConfig.conditionalOn.equals !== undefined) {
      const parsedConditionValue = parseEnvValue(conditionValue, ConfigType.STRING);
      // Convert for comparison
      const expectedValue = flagConfig.conditionalOn.equals;
      if (typeof expectedValue === 'boolean') {
        const boolCondition = parsedConditionValue === 'true' || parsedConditionValue === '1';
        if (boolCondition !== expectedValue) {
          return false;
        }
      } else if (parsedConditionValue != expectedValue) {
        return false;
      }
    }
  }

  // Check environment-specific requirement
  if (flagConfig.requiredIn && flagConfig.requiredIn.length > 0) {
    return flagConfig.requiredIn.includes(environment as any);
  }

  // Required globally
  return true;
}

/**
 * Resolve effective value for a single flag
 */
function resolveEffectiveValue(flagConfig: FlagConfig, currentEnvironment: string): EffectiveConfigValue {
  const { key, type, defaultValue, source: configSource } = flagConfig;
  
  let value: any = null;
  let source: ConfigSource = ConfigSource.MISSING;
  let isSet = false;

  // Check environment variable
  const envValue = process.env[key];
  
  if (envValue !== undefined && envValue !== '') {
    value = parseEnvValue(envValue, type);
    // Determine if this is from build artifact or runtime env
    // For now, build-time configs checked via NEXT_PUBLIC_ or VERCEL_ are buildArtifact
    // All others are runtimeEnv
    if (configSource === 'build') {
      source = ConfigSource.BUILD_ARTIFACT;
    } else {
      source = ConfigSource.RUNTIME_ENV;
    }
    isSet = true;
  } else if (defaultValue !== undefined && defaultValue !== null) {
    // Use default value if no env var is set
    value = defaultValue;
    source = ConfigSource.CATALOG_DEFAULT;
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
        source = ConfigSource.BUILD_ARTIFACT;
        isSet = true;
        break;
      }
    }
  }

  const actualType = getActualType(value);
  
  // Check if this flag is required in the current environment
  const isRequiredInThisEnv = isRequiredInEnvironment(flagConfig, currentEnvironment, value);
  const isMissing = !isSet && isRequiredInThisEnv;

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

  const environment = process.env.NODE_ENV || 'development';

  for (const flagConfig of FLAGS_CATALOG.flags) {
    const effectiveValue = resolveEffectiveValue(flagConfig, environment);
    values.push(effectiveValue);

    if (effectiveValue.isSet) {
      set++;
      if (effectiveValue.source === ConfigSource.BUILD_ARTIFACT) fromBuild++;
      if (effectiveValue.source === ConfigSource.RUNTIME_ENV) fromEnv++;
    } else if (effectiveValue.source === ConfigSource.CATALOG_DEFAULT) {
      fromDefault++;
    }

    if (!effectiveValue.isSet && effectiveValue.source === ConfigSource.MISSING) {
      missing.push(effectiveValue);
      if (effectiveValue.isMissing) {
        missingRequired.push(effectiveValue);
      }
    }
  }

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
 * Returns fully masked value for secrets, full value for non-secrets
 * 
 * Secrets are identified by:
 * - tag: 'secret' OR
 * - riskClass: HIGH/CRITICAL + certain tags (auth, credential, etc.)
 */
export function sanitizeValue(effectiveValue: EffectiveConfigValue): any {
  const { value, config } = effectiveValue;
  
  // Determine if this is a secret based on metadata
  const hasSecretTag = config.tags.includes('secret');
  const isHighRiskAuth = (config.riskClass === RiskClass.HIGH || config.riskClass === RiskClass.CRITICAL) &&
    (config.tags.includes('auth') || config.tags.includes('credential') || config.tags.includes('key'));
  
  const isSecret = hasSecretTag || isHighRiskAuth;
  
  if (isSecret && value !== null && value !== undefined) {
    // Fully mask secrets - never reveal any part of the actual value
    if (typeof value === 'string') {
      // Return masked indicator with length hint
      const length = value.length;
      if (length <= 8) {
        return '******';
      } else if (length <= 32) {
        return '************';
      } else {
        return '********************';
      }
    }
    return '******';
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
