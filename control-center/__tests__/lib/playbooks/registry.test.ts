/**
 * Playbook Registry Tests (I772 / E77.2)
 * 
 * Tests for the playbook registry:
 * - Playbook lookup by ID
 * - Playbook lookup by category
 * - Executable playbooks have step executors and idempotency functions
 * 
 * @jest-environment node
 */

import {
  getPlaybookById,
  getPlaybooksByCategory,
  getAllPlaybooks,
  hasPlaybook,
} from '@/lib/playbooks/registry';

describe('Playbook Registry Tests', () => {
  describe('Playbook Lookup', () => {
    it('should find safe-retry-runner playbook by ID', () => {
      const playbook = getPlaybookById('safe-retry-runner');
      
      expect(playbook).toBeDefined();
      expect(playbook!.definition.id).toBe('safe-retry-runner');
      expect(playbook!.definition.version).toBe('1.0.0');
      expect(playbook!.stepExecutors.size).toBeGreaterThan(0);
      expect(playbook!.idempotencyKeyFns.size).toBeGreaterThan(0);
    });

    it('should find rerun-post-deploy-verification playbook by ID', () => {
      const playbook = getPlaybookById('rerun-post-deploy-verification');
      
      expect(playbook).toBeDefined();
      expect(playbook!.definition.id).toBe('rerun-post-deploy-verification');
      expect(playbook!.definition.version).toBe('1.0.0');
      expect(playbook!.stepExecutors.size).toBeGreaterThan(0);
      expect(playbook!.idempotencyKeyFns.size).toBeGreaterThan(0);
    });

    it('should return undefined for non-existent playbook', () => {
      const playbook = getPlaybookById('non-existent');
      expect(playbook).toBeUndefined();
    });
  });

  describe('Playbook Lookup by Category', () => {
    it('should find safe-retry-runner for RUNNER_WORKFLOW_FAILED category', () => {
      const playbooks = getPlaybooksByCategory('RUNNER_WORKFLOW_FAILED');
      
      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.some(p => p.definition.id === 'safe-retry-runner')).toBe(true);
    });

    it('should find rerun-post-deploy-verification for DEPLOY_VERIFICATION_FAILED', () => {
      const playbooks = getPlaybooksByCategory('DEPLOY_VERIFICATION_FAILED');
      
      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.some(p => p.definition.id === 'rerun-post-deploy-verification')).toBe(true);
    });

    it('should find rerun-post-deploy-verification for ALB_TARGET_UNHEALTHY', () => {
      const playbooks = getPlaybooksByCategory('ALB_TARGET_UNHEALTHY');
      
      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.some(p => p.definition.id === 'rerun-post-deploy-verification')).toBe(true);
      expect(playbooks.some(p => p.definition.id === 'service-health-reset')).toBe(true);
    });

    it('should find service-health-reset for ECS_TASK_CRASHLOOP', () => {
      const playbooks = getPlaybooksByCategory('ECS_TASK_CRASHLOOP');
      
      expect(playbooks.length).toBeGreaterThan(0);
      expect(playbooks.some(p => p.definition.id === 'service-health-reset')).toBe(true);
    });

    it('should return empty array for category with no playbooks', () => {
      const playbooks = getPlaybooksByCategory('UNKNOWN');
      expect(playbooks).toEqual([]);
    });
  });

  describe('All Playbooks', () => {
    it('should return all registered playbooks', () => {
      const playbooks = getAllPlaybooks();
      
      expect(playbooks.length).toBe(4);
      expect(playbooks.some(p => p.definition.id === 'safe-retry-runner')).toBe(true);
      expect(playbooks.some(p => p.definition.id === 'rerun-post-deploy-verification')).toBe(true);
      expect(playbooks.some(p => p.definition.id === 'redeploy-lkg')).toBe(true);
      expect(playbooks.some(p => p.definition.id === 'service-health-reset')).toBe(true);
    });
  });

  describe('Has Playbook', () => {
    it('should return true for existing playbook', () => {
      expect(hasPlaybook('safe-retry-runner')).toBe(true);
      expect(hasPlaybook('rerun-post-deploy-verification')).toBe(true);
      expect(hasPlaybook('service-health-reset')).toBe(true);
    });

    it('should return false for non-existent playbook', () => {
      expect(hasPlaybook('non-existent')).toBe(false);
    });
  });

  describe('Step Executors', () => {
    it('should have executors for all steps in safe-retry-runner', () => {
      const playbook = getPlaybookById('safe-retry-runner');
      
      expect(playbook).toBeDefined();
      expect(playbook!.stepExecutors.has('dispatch-runner')).toBe(true);
      expect(playbook!.stepExecutors.has('poll-runner')).toBe(true);
      expect(playbook!.stepExecutors.has('ingest-runner')).toBe(true);
    });

    it('should have executors for all steps in rerun-post-deploy-verification', () => {
      const playbook = getPlaybookById('rerun-post-deploy-verification');
      
      expect(playbook).toBeDefined();
      expect(playbook!.stepExecutors.has('run-verification')).toBe(true);
      expect(playbook!.stepExecutors.has('ingest-incident-update')).toBe(true);
    });
  });

  describe('Idempotency Key Functions', () => {
    it('should have idempotency key functions for all steps in safe-retry-runner', () => {
      const playbook = getPlaybookById('safe-retry-runner');
      
      expect(playbook).toBeDefined();
      expect(playbook!.idempotencyKeyFns.has('dispatch-runner')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('poll-runner')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('ingest-runner')).toBe(true);
    });

    it('should have idempotency key functions for all steps in rerun-post-deploy-verification', () => {
      const playbook = getPlaybookById('rerun-post-deploy-verification');
      
      expect(playbook).toBeDefined();
      expect(playbook!.idempotencyKeyFns.has('run-verification')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('ingest-incident-update')).toBe(true);
    });

    it('should have idempotency key functions for all steps in service-health-reset', () => {
      const playbook = getPlaybookById('service-health-reset');
      
      expect(playbook).toBeDefined();
      expect(playbook!.idempotencyKeyFns.has('snapshot-state')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('apply-reset')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('wait-observe')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('post-verification')).toBe(true);
      expect(playbook!.idempotencyKeyFns.has('update-status')).toBe(true);
    });
  });
});
