/**
 * Tests for playbook module
 */

import { getPlaybook, getAllPlaybooks, determineFactoryAction } from '../src/playbook';

describe('Playbook Module', () => {
  describe('getPlaybook', () => {
    test('retrieves playbook for ACM DNS validation', () => {
      const playbook = getPlaybook('ACM_DNS_VALIDATION_PENDING');

      expect(playbook).toBeDefined();
      expect(playbook.errorClass).toBe('ACM_DNS_VALIDATION_PENDING');
      expect(playbook.proposedFactoryAction).toBe('WAIT_AND_RETRY');
      expect(playbook.steps).toContain('DNS');
      expect(playbook.guardrails.length).toBeGreaterThan(0);
    });

    test('retrieves playbook for Route53 delegation', () => {
      const playbook = getPlaybook('ROUTE53_DELEGATION_PENDING');

      expect(playbook.errorClass).toBe('ROUTE53_DELEGATION_PENDING');
      expect(playbook.proposedFactoryAction).toBe('HUMAN_REQUIRED');
      expect(playbook.steps).toContain('NS');
    });

    test('retrieves playbook for CFN in-progress lock', () => {
      const playbook = getPlaybook('CFN_IN_PROGRESS_LOCK');

      expect(playbook.errorClass).toBe('CFN_IN_PROGRESS_LOCK');
      expect(playbook.proposedFactoryAction).toBe('WAIT_AND_RETRY');
      expect(playbook.steps.toLowerCase()).toContain('in-progress');
    });

    test('retrieves playbook for CFN rollback', () => {
      const playbook = getPlaybook('CFN_ROLLBACK_LOCK');

      expect(playbook.errorClass).toBe('CFN_ROLLBACK_LOCK');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
      expect(playbook.steps).toContain('rollback');
    });

    test('retrieves playbook for missing secret', () => {
      const playbook = getPlaybook('MISSING_SECRET');

      expect(playbook.errorClass).toBe('MISSING_SECRET');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
      expect(playbook.steps).toContain('secret');
    });

    test('retrieves playbook for missing env var', () => {
      const playbook = getPlaybook('MISSING_ENV_VAR');

      expect(playbook.errorClass).toBe('MISSING_ENV_VAR');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
      expect(playbook.steps).toContain('environment');
    });

    test('retrieves playbook for deprecated CDK API', () => {
      const playbook = getPlaybook('DEPRECATED_CDK_API');

      expect(playbook.errorClass).toBe('DEPRECATED_CDK_API');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
      expect(playbook.steps).toContain('deprecated');
    });

    test('retrieves playbook for unit mismatch', () => {
      const playbook = getPlaybook('UNIT_MISMATCH');

      expect(playbook.errorClass).toBe('UNIT_MISMATCH');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
      expect(playbook.steps).toContain('unit');
    });

    test('returns UNKNOWN playbook for unknown fingerprint', () => {
      const playbook = getPlaybook('unknown-fingerprint-xyz');

      expect(playbook.errorClass).toBe('UNKNOWN');
      expect(playbook.proposedFactoryAction).toBe('OPEN_ISSUE');
    });

    test('retrieves playbook by fingerprint ID', () => {
      const playbook = getPlaybook('acm-dns-validation');

      expect(playbook.errorClass).toBe('ACM_DNS_VALIDATION_PENDING');
    });
  });

  describe('getAllPlaybooks', () => {
    test('returns all playbooks', () => {
      const playbooks = getAllPlaybooks();

      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.every(p => p.errorClass)).toBe(true);
      expect(playbooks.every(p => p.proposedFactoryAction)).toBe(true);
      expect(playbooks.every(p => p.steps)).toBe(true);
    });

    test('includes all error classes', () => {
      const playbooks = getAllPlaybooks();
      const errorClasses = playbooks.map(p => p.errorClass);

      expect(errorClasses).toContain('ACM_DNS_VALIDATION_PENDING');
      expect(errorClasses).toContain('ROUTE53_DELEGATION_PENDING');
      expect(errorClasses).toContain('CFN_IN_PROGRESS_LOCK');
      expect(errorClasses).toContain('CFN_ROLLBACK_LOCK');
      expect(errorClasses).toContain('MISSING_SECRET');
      expect(errorClasses).toContain('MISSING_ENV_VAR');
      expect(errorClasses).toContain('DEPRECATED_CDK_API');
      expect(errorClasses).toContain('UNIT_MISMATCH');
      expect(errorClasses).toContain('UNKNOWN');
    });
  });

  describe('determineFactoryAction', () => {
    test('returns OPEN_ISSUE for low confidence', () => {
      const action = determineFactoryAction('ACM_DNS_VALIDATION_PENDING', 0.5);

      expect(action).toBe('OPEN_ISSUE');
    });

    test('uses playbook action for high confidence', () => {
      const action = determineFactoryAction('ACM_DNS_VALIDATION_PENDING', 0.9);

      expect(action).toBe('WAIT_AND_RETRY');
    });

    test('returns HUMAN_REQUIRED for Route53 issues even with high confidence', () => {
      const action = determineFactoryAction('ROUTE53_DELEGATION_PENDING', 0.95);

      expect(action).toBe('HUMAN_REQUIRED');
    });

    test('returns WAIT_AND_RETRY for CFN in-progress with high confidence', () => {
      const action = determineFactoryAction('CFN_IN_PROGRESS_LOCK', 0.95);

      expect(action).toBe('WAIT_AND_RETRY');
    });

    test('returns OPEN_ISSUE for unknown errors', () => {
      const action = determineFactoryAction('UNKNOWN', 0.5);

      expect(action).toBe('OPEN_ISSUE');
    });
  });

  describe('Playbook Content Quality', () => {
    test('all playbooks have meaningful steps', () => {
      const playbooks = getAllPlaybooks();

      for (const playbook of playbooks) {
        expect(playbook.steps.length).toBeGreaterThan(100);
        expect(playbook.steps).toContain('#'); // Markdown headers
      }
    });

    test('all playbooks have guardrails', () => {
      const playbooks = getAllPlaybooks();

      for (const playbook of playbooks) {
        expect(playbook.guardrails.length).toBeGreaterThan(0);
        expect(playbook.guardrails.every(g => typeof g === 'string')).toBe(true);
      }
    });

    test('all playbooks have valid factory actions', () => {
      const playbooks = getAllPlaybooks();
      const validActions = ['WAIT_AND_RETRY', 'OPEN_ISSUE', 'HUMAN_REQUIRED'];

      for (const playbook of playbooks) {
        expect(validActions).toContain(playbook.proposedFactoryAction);
      }
    });
  });
});
