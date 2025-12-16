/**
 * AFU-9 Deploy Memory - Failure Classifier
 * 
 * Classifies deployment failures using pattern-based rules
 */

import * as crypto from 'crypto';
import { CfnFailureSignal, FailureClassification, ErrorClass } from './types';

interface ClassificationRule {
  errorClass: ErrorClass;
  service: string;
  patterns: RegExp[];
  confidence: number;
  tokens: string[];
}

/**
 * Pattern-based classification rules
 */
const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ACM DNS Validation
  {
    errorClass: 'ACM_DNS_VALIDATION_PENDING',
    service: 'ACM',
    patterns: [
      /DNS validation.*pending/i,
      /Certificate.*validation.*not complete/i,
      /waiting.*DNS.*validation/i,
      /CNAME.*record.*not.*found/i,
    ],
    confidence: 0.9,
    tokens: ['ACM', 'DNS', 'validation', 'pending'],
  },
  
  // Route53 Delegation
  {
    errorClass: 'ROUTE53_DELEGATION_PENDING',
    service: 'Route53',
    patterns: [
      /delegation.*pending/i,
      /NS.*records.*not.*configured/i,
      /name servers.*not.*updated/i,
      /zone.*delegation.*incomplete/i,
    ],
    confidence: 0.9,
    tokens: ['Route53', 'delegation', 'NS', 'pending'],
  },
  
  // CloudFormation Rollback Lock
  {
    errorClass: 'CFN_ROLLBACK_LOCK',
    service: 'CloudFormation',
    patterns: [
      /Stack.*is in.*ROLLBACK/i,
      /rollback.*in progress/i,
      /UPDATE_ROLLBACK_IN_PROGRESS/i,
      /ROLLBACK_IN_PROGRESS/i,
      /cannot.*update.*rolling back/i,
    ],
    confidence: 0.95,
    tokens: ['CloudFormation', 'ROLLBACK', 'locked'],
  },
  
  // CloudFormation In-Progress Lock (must come after ROLLBACK)
  {
    errorClass: 'CFN_IN_PROGRESS_LOCK',
    service: 'CloudFormation',
    patterns: [
      /Stack.*is in.*IN_PROGRESS/i,
      /Stack.*is in.*UPDATE_IN_PROGRESS/i,
      /Stack.*is in.*CREATE_IN_PROGRESS/i,
      /cannot.*update.*stack.*in progress/i,
      /another update is in progress/i,
    ],
    confidence: 0.95,
    tokens: ['CloudFormation', 'IN_PROGRESS', 'locked'],
  },
  
  // Missing Secret
  {
    errorClass: 'MISSING_SECRET',
    service: 'SecretsManager',
    patterns: [
      /ResourceNotFoundException.*Secrets Manager/i,
      /Secrets Manager can't find/i,
      /secret.*not found/i,
      /does not exist.*secret/i,
      /secret.*does not exist/i,
      /InvalidParameterException.*SecretId/i,
    ],
    confidence: 0.85,
    tokens: ['SecretsManager', 'secret', 'not found'],
  },
  
  // Missing Environment Variable
  {
    errorClass: 'MISSING_ENV_VAR',
    service: 'Configuration',
    patterns: [
      /missing required configuration/i,
      /environment variable.*not set/i,
      /required.*env.*not.*defined/i,
      /configuration.*not.*provided/i,
    ],
    confidence: 0.8,
    tokens: ['configuration', 'environment', 'missing'],
  },
  
  // Deprecated CDK API
  {
    errorClass: 'DEPRECATED_CDK_API',
    service: 'CDK',
    patterns: [
      /deprecated.*API/i,
      /method.*deprecated/i,
      /use.*instead of.*deprecated/i,
      /\[DEPRECATED\]/i,
    ],
    confidence: 0.75,
    tokens: ['CDK', 'deprecated', 'API'],
  },
  
  // Unit Mismatch
  {
    errorClass: 'UNIT_MISMATCH',
    service: 'Configuration',
    patterns: [
      /expected.*MB.*but got.*KB/i,
      /expected.*MiB.*but got.*MB/i,
      /expected.*seconds.*but got.*milliseconds/i,
      /unit mismatch/i,
      /invalid unit/i,
    ],
    confidence: 0.8,
    tokens: ['unit', 'mismatch', 'configuration'],
  },
];

/**
 * Classifies a deployment failure based on collected signals
 * 
 * @param signals Array of failure signals from collectors
 * @returns Failure classification with fingerprint
 */
export function classifyFailure(signals: CfnFailureSignal[]): FailureClassification {
  if (signals.length === 0) {
    return {
      fingerprintId: generateFingerprint('UNKNOWN', 'Unknown', ''),
      errorClass: 'UNKNOWN',
      service: 'Unknown',
      confidence: 0.0,
      tokens: [],
    };
  }

  // Combine all status reasons for pattern matching
  const combinedReasons = signals
    .map(s => s.statusReason)
    .join(' | ')
    .toLowerCase();

  // Try to match against classification rules
  for (const rule of CLASSIFICATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(combinedReasons)) {
        const fingerprintId = generateFingerprint(
          rule.errorClass,
          rule.service,
          normalizeTemplate(combinedReasons)
        );

        return {
          fingerprintId,
          errorClass: rule.errorClass,
          service: rule.service,
          confidence: rule.confidence,
          tokens: rule.tokens,
        };
      }
    }
  }

  // Default classification for unknown errors
  const primarySignal = signals[0];
  const fingerprintId = generateFingerprint(
    'UNKNOWN',
    primarySignal.resourceType,
    normalizeTemplate(primarySignal.statusReason)
  );

  return {
    fingerprintId,
    errorClass: 'UNKNOWN',
    service: primarySignal.resourceType,
    confidence: 0.5,
    tokens: ['unknown', 'error'],
  };
}

/**
 * Generates a stable fingerprint ID for a failure pattern
 * 
 * @param errorClass Error classification
 * @param service AWS service name
 * @param normalizedTemplate Normalized error template
 * @returns SHA-256 hash of the pattern
 */
function generateFingerprint(
  errorClass: ErrorClass | string,
  service: string,
  normalizedTemplate: string
): string {
  const input = `${errorClass}:${service}:${normalizedTemplate}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Normalizes an error message to create a stable template
 * Removes timestamps, IDs, and variable content
 * 
 * @param message Error message to normalize
 * @returns Normalized template string
 */
function normalizeTemplate(message: string): string {
  let normalized = message.toLowerCase();

  // Remove timestamps (ISO 8601, Unix, etc.)
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}[.\d]*[Z]?/gi, '<TIMESTAMP>');
  normalized = normalized.replace(/\d{10,13}/g, '<TIMESTAMP>');

  // Remove AWS resource IDs
  normalized = normalized.replace(/[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}/gi, '<UUID>');
  normalized = normalized.replace(/arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s]+/gi, '<ARN>');
  normalized = normalized.replace(/\b[A-Z0-9]{20,}\b/g, '<ID>');

  // Remove stack names (preserve pattern)
  normalized = normalized.replace(/\b\w+Stack\b/gi, '<STACK>');

  // Remove numbers that might be variable
  normalized = normalized.replace(/\b\d+\s*(ms|seconds?|minutes?|hours?|MB|GB|KB|MiB|GiB|KiB)\b/gi, '<VALUE>');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Extracts error tokens from signals for search/filtering
 * 
 * @param signals Array of failure signals
 * @returns Array of extracted keywords
 */
export function extractTokens(signals: CfnFailureSignal[]): string[] {
  const tokens = new Set<string>();

  for (const signal of signals) {
    // Add resource type
    tokens.add(signal.resourceType);

    // Extract significant words from status reason
    const words = signal.statusReason
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3 && !isCommonWord(w));

    words.forEach(w => tokens.add(w));
  }

  return Array.from(tokens);
}

/**
 * Checks if a word is common and should be filtered out
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    'the', 'this', 'that', 'with', 'from', 'have', 'been',
    'were', 'was', 'are', 'and', 'for', 'not', 'but', 'can',
    'could', 'would', 'should', 'your', 'their', 'there',
  ]);
  return commonWords.has(word);
}
