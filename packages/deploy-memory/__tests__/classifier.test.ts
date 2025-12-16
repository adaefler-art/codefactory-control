/**
 * Tests for failure classifier
 */

import { classifyFailure, extractTokens } from '../src/classifier';
import { CfnFailureSignal } from '../src/types';

describe('Failure Classifier', () => {
  describe('ACM DNS Validation', () => {
    test('detects ACM DNS validation pending', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'SiteCertificate',
          statusReason: 'DNS validation is pending. Waiting for CNAME record to be created.',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('ACM_DNS_VALIDATION_PENDING');
      expect(result.service).toBe('ACM');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.tokens).toContain('ACM');
      expect(result.fingerprintId).toBeTruthy();
    });

    test('detects certificate validation not complete', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Certificate',
          statusReason: 'Certificate validation is not complete',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('ACM_DNS_VALIDATION_PENDING');
    });
  });

  describe('Route53 Delegation', () => {
    test('detects Route53 delegation pending', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Route53::HostedZone',
          logicalId: 'HostedZone',
          statusReason: 'NS records not configured. Delegation is pending.',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('ROUTE53_DELEGATION_PENDING');
      expect(result.service).toBe('Route53');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    test('detects name servers not updated', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Route53::HostedZone',
          logicalId: 'Zone',
          statusReason: 'The name servers have not been updated in the parent domain',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('ROUTE53_DELEGATION_PENDING');
    });
  });

  describe('CloudFormation Locks', () => {
    test('detects IN_PROGRESS lock', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CloudFormation::Stack',
          logicalId: 'MyStack',
          statusReason: 'Stack is in UPDATE_IN_PROGRESS state. Cannot update.',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('CFN_IN_PROGRESS_LOCK');
      expect(result.service).toBe('CloudFormation');
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    test('detects ROLLBACK lock', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CloudFormation::Stack',
          logicalId: 'MyStack',
          statusReason: 'Stack is in UPDATE_ROLLBACK_IN_PROGRESS state',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('CFN_ROLLBACK_LOCK');
      expect(result.service).toBe('CloudFormation');
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe('Missing Secrets', () => {
    test('detects missing secret - ResourceNotFoundException', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'MyFunction',
          statusReason: 'ResourceNotFoundException: Secrets Manager can\'t find the specified secret',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('MISSING_SECRET');
      expect(result.service).toBe('SecretsManager');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    test('detects secret not found', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::ECS::TaskDefinition',
          logicalId: 'TaskDef',
          statusReason: 'Secret arn:aws:secretsmanager:us-east-1:123456789:secret:mysecret does not exist',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('MISSING_SECRET');
    });
  });

  describe('Missing Environment Variables', () => {
    test('detects missing required configuration', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Deployment failed: missing required configuration DATABASE_URL',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('MISSING_ENV_VAR');
      expect(result.service).toBe('Configuration');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    test('detects environment variable not set', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'Custom::Resource',
          logicalId: 'CustomResource',
          statusReason: 'Error: environment variable API_KEY is not set',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('MISSING_ENV_VAR');
    });
  });

  describe('Deprecated CDK API', () => {
    test('detects deprecated API usage', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Warning: Using deprecated API. Use the new API instead of deprecated method.',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('DEPRECATED_CDK_API');
      expect(result.service).toBe('CDK');
      expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    });

    test('detects [DEPRECATED] marker', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'CDK::Construct',
          logicalId: 'Resource',
          statusReason: '[DEPRECATED] This construct is deprecated',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('DEPRECATED_CDK_API');
    });
  });

  describe('Unit Mismatch', () => {
    test('detects MB/KB mismatch', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Invalid configuration: expected value in MB but got KB',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('UNIT_MISMATCH');
      expect(result.service).toBe('Configuration');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    test('detects seconds/milliseconds mismatch', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Timeout configuration error: expected seconds but got milliseconds',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);
      expect(result.errorClass).toBe('UNIT_MISMATCH');
    });
  });

  describe('Unknown Errors', () => {
    test('classifies unknown errors with low confidence', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'Some random error that does not match any pattern',
          timestamp: new Date(),
        },
      ];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('UNKNOWN');
      expect(result.confidence).toBeLessThanOrEqual(0.5);
      expect(result.fingerprintId).toBeTruthy();
    });

    test('handles empty signals array', () => {
      const signals: CfnFailureSignal[] = [];

      const result = classifyFailure(signals);

      expect(result.errorClass).toBe('UNKNOWN');
      expect(result.confidence).toBe(0.0);
    });
  });

  describe('Fingerprint Stability', () => {
    test('generates same fingerprint for similar errors', () => {
      const signals1: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Cert1',
          statusReason: 'DNS validation is pending. Waiting for CNAME record to be created.',
          timestamp: new Date('2024-01-01'),
        },
      ];

      const signals2: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::CertificateManager::Certificate',
          logicalId: 'Cert2',
          statusReason: 'DNS validation is pending. Waiting for CNAME record to be created.',
          timestamp: new Date('2024-01-02'),
        },
      ];

      const result1 = classifyFailure(signals1);
      const result2 = classifyFailure(signals2);

      expect(result1.fingerprintId).toBe(result2.fingerprintId);
    });

    test('generates different fingerprints for different error classes', () => {
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
          statusReason: 'NS records not configured. Delegation is pending.',
          timestamp: new Date(),
        },
      ];

      const result1 = classifyFailure(signals1);
      const result2 = classifyFailure(signals2);

      expect(result1.fingerprintId).not.toBe(result2.fingerprintId);
    });
  });

  describe('Token Extraction', () => {
    test('extracts relevant tokens from signals', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::Lambda::Function',
          logicalId: 'Function',
          statusReason: 'ResourceNotFoundException: Secrets Manager cannot find secret',
          timestamp: new Date(),
        },
      ];

      const tokens = extractTokens(signals);

      expect(tokens).toContain('AWS::Lambda::Function');
      expect(tokens.length).toBeGreaterThan(0);
      // Should filter out common words
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('and');
    });

    test('filters out short words', () => {
      const signals: CfnFailureSignal[] = [
        {
          resourceType: 'AWS::S3::Bucket',
          logicalId: 'Bucket',
          statusReason: 'Error: the S3 bucket is not accessible',
          timestamp: new Date(),
        },
      ];

      const tokens = extractTokens(signals);

      // Short words should be filtered
      expect(tokens.every(t => t.length > 3)).toBe(true);
    });
  });
});
