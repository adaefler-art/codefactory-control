/**
 * Tests for Verdict Engine v1.1
 * 
 * Tests Issue 2.2: Confidence Score Normalisierung
 */

import { 
  normalizeConfidenceScore, 
  generateVerdict, 
  validateDeterminism,
  calculateConsistencyMetrics,
  auditVerdict
} from '../src/engine';
import { CfnFailureSignal } from '@codefactory/deploy-memory/src/types';
import { Verdict, PolicySnapshot } from '../src/types';

describe('Verdict Engine - Confidence Score Normalization', () => {
  describe('normalizeConfidenceScore', () => {
    test('normalizes 0.0 to 0', () => {
      expect(normalizeConfidenceScore(0.0)).toBe(0);
    });

    test('normalizes 1.0 to 100', () => {
      expect(normalizeConfidenceScore(1.0)).toBe(100);
    });

    test('normalizes 0.5 to 50', () => {
      expect(normalizeConfidenceScore(0.5)).toBe(50);
    });

    test('normalizes 0.85 to 85', () => {
      expect(normalizeConfidenceScore(0.85)).toBe(85);
    });

    test('normalizes 0.9 to 90', () => {
      expect(normalizeConfidenceScore(0.9)).toBe(90);
    });

    test('normalizes 0.95 to 95', () => {
      expect(normalizeConfidenceScore(0.95)).toBe(95);
    });

    test('rounds 0.855 to 86', () => {
      expect(normalizeConfidenceScore(0.855)).toBe(86);
    });

    test('rounds 0.854 to 85', () => {
      expect(normalizeConfidenceScore(0.854)).toBe(85);
    });

    test('throws error for negative confidence', () => {
      expect(() => normalizeConfidenceScore(-0.1)).toThrow('Invalid confidence');
    });

    test('throws error for confidence > 1', () => {
      expect(() => normalizeConfidenceScore(1.5)).toThrow('Invalid confidence');
    });
  });

  describe('generateVerdict', () => {
    test('generates verdict with normalized confidence for ACM DNS validation', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Certificate',
          statusReason: 'DNS validation is pending',
          timestamp: new Date(),
        },
      ];

      const verdict = generateVerdict({
        execution_id: 'exec-123',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      expect(verdict.execution_id).toBe('exec-123');
      expect(verdict.policy_snapshot_id).toBe('policy-v1');
      expect(verdict.error_class).toBe('ACM_DNS_VALIDATION_PENDING');
      expect(verdict.service).toBe('ACM');
      expect(verdict.confidence_score).toBe(90); // 0.9 * 100
      expect(verdict.confidence_score).toBeGreaterThanOrEqual(0);
      expect(verdict.confidence_score).toBeLessThanOrEqual(100);
      expect(verdict.proposed_action).toBe('WAIT_AND_RETRY');
      expect(verdict.fingerprint_id).toBeTruthy();
      expect(verdict.signals).toEqual(signals);
    });

    test('generates verdict with normalized confidence for missing secret', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'ResourceNotFoundException: Secrets Manager cannot find secret',
          timestamp: new Date(),
        },
      ];

      const verdict = generateVerdict({
        execution_id: 'exec-456',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      expect(verdict.error_class).toBe('MISSING_SECRET');
      expect(verdict.confidence_score).toBe(85); // 0.85 * 100
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');
    });

    test('generates verdict for CloudFormation rollback', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CloudFormation::Stack',
          logicalId: 'Stack',
          statusReason: 'Stack is in ROLLBACK_IN_PROGRESS',
          timestamp: new Date(),
        },
      ];

      const verdict = generateVerdict({
        execution_id: 'exec-789',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      expect(verdict.error_class).toBe('CFN_ROLLBACK_LOCK');
      expect(verdict.confidence_score).toBe(95); // 0.95 * 100
      expect(verdict.proposed_action).toBe('OPEN_ISSUE');
    });

    test('includes tokens extracted from signals', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Error: environment variable API_KEY is not set',
          timestamp: new Date(),
        },
      ];

      const verdict = generateVerdict({
        execution_id: 'exec-001',
        policy_snapshot_id: 'policy-v1',
        signals,
      });

      expect(verdict.tokens.length).toBeGreaterThan(0);
      expect(verdict.tokens).toContain('AWS::Lambda::Function');
    });
  });

  describe('validateDeterminism', () => {
    test('identical signals produce identical verdicts', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Cert',
          statusReason: 'DNS validation is pending',
          timestamp: new Date('2024-01-01'),
        },
      ];

      // Create duplicate with different timestamp
      const signalsDuplicate: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Cert',
          statusReason: 'DNS validation is pending',
          timestamp: new Date('2024-01-02'),
        },
      ];

      const isDeterministic = validateDeterminism(signals, signalsDuplicate);
      expect(isDeterministic).toBe(true);
    });

    test('different error classes produce different verdicts', () => {
      const signals1: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Cert',
          statusReason: 'DNS validation is pending',
          timestamp: new Date(),
        },
      ];

      const signals2: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Route53::HostedZone',
          logicalId: 'Zone',
          statusReason: 'NS records not configured',
          timestamp: new Date(),
        },
      ];

      const isDeterministic = validateDeterminism(signals1, signals2);
      expect(isDeterministic).toBe(false);
    });
  });

  describe('calculateConsistencyMetrics', () => {
    test('calculates metrics for empty array', () => {
      const metrics = calculateConsistencyMetrics([]);
      
      expect(metrics.total).toBe(0);
      expect(metrics.avg_confidence).toBe(0);
      expect(metrics.consistency_score).toBe(0);
    });

    test('calculates metrics for single verdict', () => {
      const verdicts: Verdict[] = [
        {
          id: 'v1',
          execution_id: 'exec-1',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1',
          error_class: 'ACM_DNS_VALIDATION_PENDING',
          service: 'ACM',
          confidence_score: 90,
          proposed_action: 'WAIT_AND_RETRY',
          tokens: ['ACM'],
          signals: [],
          created_at: new Date().toISOString(),
        },
      ];

      const metrics = calculateConsistencyMetrics(verdicts);
      
      expect(metrics.total).toBe(1);
      expect(metrics.avg_confidence).toBe(90);
      expect(metrics.consistency_score).toBe(100); // Single verdict is always consistent
      expect(metrics.by_error_class['ACM_DNS_VALIDATION_PENDING']).toEqual({
        count: 1,
        avg_confidence: 90,
      });
    });

    test('calculates metrics for consistent verdicts', () => {
      const verdicts: Verdict[] = [
        {
          id: 'v1',
          execution_id: 'exec-1',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1',
          error_class: 'ACM_DNS_VALIDATION_PENDING',
          service: 'ACM',
          confidence_score: 90,
          proposed_action: 'WAIT_AND_RETRY',
          tokens: ['ACM'],
          signals: [],
          created_at: new Date().toISOString(),
        },
        {
          id: 'v2',
          execution_id: 'exec-2',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1', // Same fingerprint
          error_class: 'ACM_DNS_VALIDATION_PENDING', // Same error class
          service: 'ACM',
          confidence_score: 90, // Same confidence
          proposed_action: 'WAIT_AND_RETRY',
          tokens: ['ACM'],
          signals: [],
          created_at: new Date().toISOString(),
        },
      ];

      const metrics = calculateConsistencyMetrics(verdicts);
      
      expect(metrics.total).toBe(2);
      expect(metrics.avg_confidence).toBe(90);
      expect(metrics.consistency_score).toBe(100); // Both verdicts consistent
    });

    test('detects inconsistent verdicts with same fingerprint', () => {
      const verdicts: Verdict[] = [
        {
          id: 'v1',
          execution_id: 'exec-1',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1',
          error_class: 'ACM_DNS_VALIDATION_PENDING',
          service: 'ACM',
          confidence_score: 90,
          proposed_action: 'WAIT_AND_RETRY',
          tokens: ['ACM'],
          signals: [],
          created_at: new Date().toISOString(),
        },
        {
          id: 'v2',
          execution_id: 'exec-2',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1', // Same fingerprint but...
          error_class: 'UNKNOWN', // Different error class (inconsistent!)
          service: 'ACM',
          confidence_score: 50,
          proposed_action: 'OPEN_ISSUE',
          tokens: ['ACM'],
          signals: [],
          created_at: new Date().toISOString(),
        },
      ];

      const metrics = calculateConsistencyMetrics(verdicts);
      
      expect(metrics.consistency_score).toBe(0); // Inconsistent
    });

    test('calculates average confidence by error class', () => {
      const verdicts: Verdict[] = [
        {
          id: 'v1',
          execution_id: 'exec-1',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp1',
          error_class: 'ACM_DNS_VALIDATION_PENDING',
          service: 'ACM',
          confidence_score: 90,
          proposed_action: 'WAIT_AND_RETRY',
          tokens: [],
          signals: [],
          created_at: new Date().toISOString(),
        },
        {
          id: 'v2',
          execution_id: 'exec-2',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp2',
          error_class: 'ACM_DNS_VALIDATION_PENDING',
          service: 'ACM',
          confidence_score: 80,
          proposed_action: 'WAIT_AND_RETRY',
          tokens: [],
          signals: [],
          created_at: new Date().toISOString(),
        },
        {
          id: 'v3',
          execution_id: 'exec-3',
          policy_snapshot_id: 'policy-1',
          fingerprint_id: 'fp3',
          error_class: 'MISSING_SECRET',
          service: 'SecretsManager',
          confidence_score: 85,
          proposed_action: 'OPEN_ISSUE',
          tokens: [],
          signals: [],
          created_at: new Date().toISOString(),
        },
      ];

      const metrics = calculateConsistencyMetrics(verdicts);
      
      expect(metrics.by_error_class['ACM_DNS_VALIDATION_PENDING']).toEqual({
        count: 2,
        avg_confidence: 85, // (90 + 80) / 2
      });
      expect(metrics.by_error_class['MISSING_SECRET']).toEqual({
        count: 1,
        avg_confidence: 85,
      });
    });
  });

  describe('auditVerdict', () => {
    const mockPolicySnapshot: PolicySnapshot = {
      id: 'policy-123',
      version: 'v1.0.0',
      policies: {
        classification_rules: [],
        playbooks: {
          ACM_DNS_VALIDATION_PENDING: 'WAIT_AND_RETRY',
          ROUTE53_DELEGATION_PENDING: 'HUMAN_REQUIRED',
          CFN_IN_PROGRESS_LOCK: 'WAIT_AND_RETRY',
          CFN_ROLLBACK_LOCK: 'OPEN_ISSUE',
          MISSING_SECRET: 'OPEN_ISSUE',
          MISSING_ENV_VAR: 'OPEN_ISSUE',
          DEPRECATED_CDK_API: 'OPEN_ISSUE',
          UNIT_MISMATCH: 'OPEN_ISSUE',
          UNKNOWN: 'OPEN_ISSUE',
        },
        confidence_normalization: {
          scale: '0-100',
          formula: 'raw * 100',
          deterministic: true,
        },
      },
      created_at: new Date().toISOString(),
    };

    test('passes audit for valid verdict', () => {
      const verdict: Verdict = {
        id: 'v1',
        execution_id: 'exec-1',
        policy_snapshot_id: 'policy-123',
        fingerprint_id: 'fp1',
        error_class: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        confidence_score: 90,
        proposed_action: 'WAIT_AND_RETRY',
        tokens: ['ACM'],
        signals: [
          {
            resourceType: 'AWS::CertificateManager::Certificate',
            logicalId: 'Cert',
            statusReason: 'DNS validation pending',
            timestamp: new Date(),
          },
        ],
        created_at: new Date().toISOString(),
      };

      const audit = auditVerdict(verdict, mockPolicySnapshot);
      
      expect(audit.compliant).toBe(true);
      expect(audit.issues).toHaveLength(0);
      expect(audit.policy_version).toBe('v1.0.0');
    });

    test('fails audit for mismatched policy snapshot', () => {
      const verdict: Verdict = {
        id: 'v1',
        execution_id: 'exec-1',
        policy_snapshot_id: 'different-policy',
        fingerprint_id: 'fp1',
        error_class: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        confidence_score: 90,
        proposed_action: 'WAIT_AND_RETRY',
        tokens: ['ACM'],
        signals: [
          {
            resourceType: 'AWS::CertificateManager::Certificate',
            logicalId: 'Cert',
            statusReason: 'DNS validation pending',
            timestamp: new Date(),
          },
        ],
        created_at: new Date().toISOString(),
      };

      const audit = auditVerdict(verdict, mockPolicySnapshot);
      
      expect(audit.compliant).toBe(false);
      expect(audit.issues).toContain('Verdict policy_snapshot_id does not match provided policy');
    });

    test('fails audit for invalid confidence score', () => {
      const verdict: Verdict = {
        id: 'v1',
        execution_id: 'exec-1',
        policy_snapshot_id: 'policy-123',
        fingerprint_id: 'fp1',
        error_class: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        confidence_score: 150, // Invalid!
        proposed_action: 'WAIT_AND_RETRY',
        tokens: ['ACM'],
        signals: [
          {
            resourceType: 'AWS::CertificateManager::Certificate',
            logicalId: 'Cert',
            statusReason: 'DNS validation pending',
            timestamp: new Date(),
          },
        ],
        created_at: new Date().toISOString(),
      };

      const audit = auditVerdict(verdict, mockPolicySnapshot);
      
      expect(audit.compliant).toBe(false);
      expect(audit.issues).toContain('Invalid confidence_score: 150. Must be 0-100.');
    });

    test('fails audit for missing signals', () => {
      const verdict: Verdict = {
        id: 'v1',
        execution_id: 'exec-1',
        policy_snapshot_id: 'policy-123',
        fingerprint_id: 'fp1',
        error_class: 'ACM_DNS_VALIDATION_PENDING',
        service: 'ACM',
        confidence_score: 90,
        proposed_action: 'WAIT_AND_RETRY',
        tokens: ['ACM'],
        signals: [], // No signals!
        created_at: new Date().toISOString(),
      };

      const audit = auditVerdict(verdict, mockPolicySnapshot);
      
      expect(audit.compliant).toBe(false);
      expect(audit.issues).toContain('Verdict has no signals');
    });
  });
});
