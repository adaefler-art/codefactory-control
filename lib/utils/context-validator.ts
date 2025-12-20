import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Context key definition
 */
interface ContextKeyDef {
  type: 'boolean' | 'string';
  description: string;
  default?: any;
  required?: boolean;
  deprecated?: readonly string[];
}

/**
 * Canonical context keys for AFU-9 infrastructure
 * These are the ONLY context keys that should be used
 */
export const CANONICAL_CONTEXT_KEYS: Record<string, ContextKeyDef> = {
  // Feature toggles
  'afu9-enable-database': {
    type: 'boolean',
    description: 'Enable database integration (RDS, secrets, IAM grants)',
    default: true,
    deprecated: ['enableDatabase'],
  },
  'afu9-enable-https': {
    type: 'boolean',
    description: 'Enable HTTPS and DNS stack deployment',
    default: true,
    deprecated: ['enableHttps'],
  },
  'afu9-multi-env': {
    type: 'boolean',
    description: 'Enable multi-environment deployment (stage + prod)',
    default: false,
    deprecated: ['multiEnv'],
  },

  // DNS and domain configuration
  'afu9-domain': {
    type: 'string',
    description: 'Base domain name (e.g., afu-9.com)',
    required: false,
    deprecated: ['domainName'],
  },
  'afu9-hosted-zone-id': {
    type: 'string',
    description: 'Existing Route53 hosted zone ID',
    required: false,
  },
  'afu9-hosted-zone-name': {
    type: 'string',
    description: 'Existing hosted zone name (required if ID provided)',
    required: false,
  },

  // Monitoring and alerts
  'afu9-alarm-email': {
    type: 'string',
    description: 'Email address for CloudWatch alarm notifications',
    required: false,
  },
  'afu9-webhook-url': {
    type: 'string',
    description: 'Webhook URL for alarm notifications',
    required: false,
  },

  // Authentication
  'afu9-cognito-domain-prefix': {
    type: 'string',
    description: 'Cognito user pool domain prefix',
    required: false,
  },

  // GitHub integration
  'github-org': {
    type: 'string',
    description: 'GitHub organization name',
    default: 'adaefler-art',
  },
  'github-repo': {
    type: 'string',
    description: 'GitHub repository name',
    default: 'codefactory-control',
  },

  // Database configuration (when afu9-enable-database=true)
  'dbSecretArn': {
    type: 'string',
    description: 'ARN of database connection secret',
    required: false,
  },
  'dbSecretName': {
    type: 'string',
    description: 'Name of database connection secret',
    required: false,
  },

  // Environment configuration
  'environment': {
    type: 'string',
    description: 'Environment name (staging, production)',
    required: false,
    deprecated: ['stage'],
  },
};

/**
 * Deprecated context keys that should no longer be used
 * Maps old key -> new key
 */
export const DEPRECATED_CONTEXT_KEYS: Record<string, string> = {
  'enableDatabase': 'afu9-enable-database',
  'enableHttps': 'afu9-enable-https',
  'multiEnv': 'afu9-multi-env',
  'domainName': 'afu9-domain',
  'stage': 'environment',
};

/**
 * Validates context keys used in CDK app
 * Checks for deprecated keys and unknown keys
 */
export function validateContextKeys(scope: Construct): void {
  const node = scope.node;
  const allContextKeys = Object.keys(node.tryGetContext('') || {});
  
  // Get all context keys from the node
  const contextKeys = new Set<string>();
  
  // Try to get all context keys by iterating through known keys
  for (const key of Object.keys(CANONICAL_CONTEXT_KEYS)) {
    if (node.tryGetContext(key) !== undefined) {
      contextKeys.add(key);
    }
  }
  
  for (const key of Object.keys(DEPRECATED_CONTEXT_KEYS)) {
    if (node.tryGetContext(key) !== undefined) {
      contextKeys.add(key);
    }
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for deprecated keys
  for (const [oldKey, newKey] of Object.entries(DEPRECATED_CONTEXT_KEYS)) {
    const oldValue = node.tryGetContext(oldKey);
    const newValue = node.tryGetContext(newKey);
    
    if (oldValue !== undefined) {
      if (newValue === undefined) {
        // Only old key is provided
        warnings.push(
          `DEPRECATION: Context key "${oldKey}" is deprecated. ` +
          `Please use "${newKey}" instead. ` +
          `Example: cdk deploy -c ${newKey}=${JSON.stringify(oldValue)}`
        );
      } else {
        // Both old and new keys are provided
        warnings.push(
          `Both "${oldKey}" (deprecated) and "${newKey}" context keys are provided. ` +
          `Using "${newKey}" value. Please remove the deprecated "${oldKey}" key.`
        );
      }
    }
  }

  // Report warnings
  for (const warning of warnings) {
    cdk.Annotations.of(scope).addWarning(warning);
  }

  // Report errors
  for (const error of errors) {
    cdk.Annotations.of(scope).addError(error);
  }
}

/**
 * Gets a context value with validation and deprecation handling
 * @param scope The construct to get context from
 * @param key The canonical context key
 * @returns The context value, or undefined if not set
 */
export function getValidatedContext<T = any>(
  scope: Construct,
  key: keyof typeof CANONICAL_CONTEXT_KEYS
): T | undefined {
  const node = scope.node;
  const contextDef = CANONICAL_CONTEXT_KEYS[key];
  
  if (!contextDef) {
    throw new Error(`Unknown context key: ${key}`);
  }

  // Check canonical key first
  const canonicalValue = node.tryGetContext(key);
  
  // Check deprecated keys
  let deprecatedValue: any = undefined;
  let deprecatedKey: string | undefined = undefined;
  
  if (contextDef.deprecated) {
    for (const oldKey of contextDef.deprecated) {
      const value = node.tryGetContext(oldKey);
      if (value !== undefined) {
        deprecatedValue = value;
        deprecatedKey = oldKey;
        break;
      }
    }
  }

  // Handle deprecation warnings
  if (deprecatedValue !== undefined) {
    if (canonicalValue === undefined) {
      cdk.Annotations.of(scope).addWarning(
        `DEPRECATION: Context key "${deprecatedKey}" is deprecated. ` +
        `Please use "${key}" instead. ` +
        `Example: cdk deploy -c ${key}=${JSON.stringify(deprecatedValue)}`
      );
      return deprecatedValue as T;
    } else {
      cdk.Annotations.of(scope).addWarning(
        `Both "${deprecatedKey}" (deprecated) and "${key}" context keys are provided. ` +
        `Using "${key}" value. Please remove the deprecated "${deprecatedKey}" key.`
      );
    }
  }

  // Return canonical value or default
  if (canonicalValue !== undefined) {
    return canonicalValue as T;
  }

  if ('default' in contextDef) {
    return contextDef.default as T;
  }

  return undefined;
}

/**
 * Validates that all required context keys are provided
 * @param scope The construct to validate
 * @param requiredKeys Array of required context keys
 */
export function validateRequiredContext(
  scope: Construct,
  requiredKeys: (keyof typeof CANONICAL_CONTEXT_KEYS)[]
): void {
  const errors: string[] = [];

  for (const key of requiredKeys) {
    const value = getValidatedContext(scope, key);
    if (value === undefined) {
      const contextDef = CANONICAL_CONTEXT_KEYS[key];
      errors.push(
        `Required context key "${key}" is not provided. ` +
        `${contextDef.description}. ` +
        `Example: cdk deploy -c ${key}=<value>`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Missing required context keys:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
}
