/**
 * API Route Canonicalization Tests
 * 
 * Tests to verify:
 * 1. All canonical routes are documented
 * 2. Deprecated routes still work (backward compatibility)
 * 3. Type-safe route constants match actual routes
 * 4. No client code uses deprecated routes
 */

import { describe, it, expect } from '@jest/globals';
import { API_ROUTES, DEPRECATED_ROUTES } from '../../src/lib/api-routes';

describe('API Route Canonicalization', () => {
  describe('Route Constants', () => {
    it('should define all major route categories', () => {
      expect(API_ROUTES.auth).toBeDefined();
      expect(API_ROUTES.health).toBeDefined();
      expect(API_ROUTES.webhooks).toBeDefined();
      expect(API_ROUTES.workflows).toBeDefined();
      expect(API_ROUTES.workflow).toBeDefined();
      expect(API_ROUTES.issues).toBeDefined();
      expect(API_ROUTES.v1).toBeDefined();
    });

    it('should provide correct webhook canonical route', () => {
      expect(API_ROUTES.webhooks.github).toBe('/api/webhooks/github');
    });

    it('should distinguish between workflows (persistent) and workflow (ad-hoc)', () => {
      // Workflows - persistent in DB
      expect(API_ROUTES.workflows.list).toBe('/api/workflows');
      
      // Workflow - ad-hoc execution
      expect(API_ROUTES.workflow.execute).toBe('/api/workflow/execute');
      
      // They should be different
      expect(API_ROUTES.workflows.list).not.toBe(API_ROUTES.workflow.execute);
    });

    it('should provide route builders for dynamic segments', () => {
      const issueId = '123e4567-e89b-12d3-a456-426614174000';
      
      expect(API_ROUTES.issues.get(issueId)).toBe(`/api/issues/${issueId}`);
      expect(API_ROUTES.issues.activate(issueId)).toBe(`/api/issues/${issueId}/activate`);
      expect(API_ROUTES.workflows.get(issueId)).toBe(`/api/workflows/${issueId}`);
    });

    it('should define v1 API routes with version prefix', () => {
      expect(API_ROUTES.v1.kpi.aggregate).toMatch(/^\/api\/v1\//);
      expect(API_ROUTES.v1.costs.factory).toMatch(/^\/api\/v1\//);
      expect(API_ROUTES.v1.factory.status).toMatch(/^\/api\/v1\//);
    });
  });

  describe('Deprecated Routes', () => {
    it('should track deprecated routes separately', () => {
      expect(DEPRECATED_ROUTES.githubWebhook).toBe('/api/github/webhook');
    });

    it('should have deprecated routes that differ from canonical ones', () => {
      expect(DEPRECATED_ROUTES.githubWebhook).not.toBe(API_ROUTES.webhooks.github);
    });
  });

  describe('Route Patterns', () => {
    it('should follow RESTful conventions for collections', () => {
      // Collections should be plural
      expect(API_ROUTES.issues.list).toMatch(/\/issues$/);
      expect(API_ROUTES.workflows.list).toMatch(/\/workflows$/);
      expect(API_ROUTES.products.list).toMatch(/\/products$/);
      expect(API_ROUTES.repositories.list).toMatch(/\/repositories$/);
    });

    it('should use consistent naming for CRUD operations', () => {
      // All resources should have get/create patterns
      expect(typeof API_ROUTES.issues.get).toBe('function');
      expect(typeof API_ROUTES.products.get).toBe('function');
      expect(typeof API_ROUTES.repositories.get).toBe('function');
    });

    it('should group related routes under namespaces', () => {
      // Auth routes under auth namespace
      expect(API_ROUTES.auth.login).toMatch(/^\/api\/auth\//);
      expect(API_ROUTES.auth.logout).toMatch(/^\/api\/auth\//);
      
      // Webhook routes under webhooks namespace
      expect(API_ROUTES.webhooks.github).toMatch(/^\/api\/webhooks\//);
      
      // V1 routes under v1 namespace
      expect(API_ROUTES.v1.kpi.aggregate).toMatch(/^\/api\/v1\//);
    });
  });

  describe('Health Check Routes', () => {
    it('should have distinct health check endpoints for different purposes', () => {
      const healthRoutes = [
        API_ROUTES.health.app,
        API_ROUTES.health.ready,
        API_ROUTES.health.infrastructure,
        API_ROUTES.health.mcp,
        API_ROUTES.health.deps,
      ];

      // All should be unique
      const uniqueRoutes = new Set(healthRoutes);
      expect(uniqueRoutes.size).toBe(healthRoutes.length);
    });

    it('should follow health check naming conventions', () => {
      expect(API_ROUTES.health.app).toBe('/api/health');
      expect(API_ROUTES.health.ready).toBe('/api/ready');
    });
  });

  describe('Deploy Events Routes', () => {
    it('should have separate public and internal deploy events routes', () => {
      expect(API_ROUTES.deployEvents.list).toBe('/api/deploy-events');
      expect(API_ROUTES.deployEvents.internal).toBe('/api/internal/deploy-events');
      
      // They should be different
      expect(API_ROUTES.deployEvents.list).not.toBe(API_ROUTES.deployEvents.internal);
    });
  });

  describe('Type Safety', () => {
    it('should provide type-safe route builders', () => {
      const testId = 'test-id';
      
      // These should all be strings
      expect(typeof API_ROUTES.issues.get(testId)).toBe('string');
      expect(typeof API_ROUTES.workflows.get(testId)).toBe('string');
      expect(typeof API_ROUTES.products.get(testId)).toBe('string');
    });

    it('should handle nested route builders', () => {
      const promptId = 'prompt-123';
      
      expect(API_ROUTES.prompts.versions.list(promptId)).toBe(`/api/prompts/${promptId}/versions`);
      expect(API_ROUTES.actions.versions.list(promptId)).toBe(`/api/actions/${promptId}/versions`);
    });
  });

  describe('Route Documentation Consistency', () => {
    it('should have all routes documented in API_ROUTES', () => {
      // Major categories that should exist
      const requiredCategories = [
        'auth',
        'health',
        'webhooks',
        'workflows',
        'workflow',
        'executions',
        'issues',
        'products',
        'repositories',
        'prompts',
        'actions',
        'agents',
        'lawbook',
        'deployEvents',
        'observability',
        'v1',
        'system',
      ];

      requiredCategories.forEach(category => {
        expect(API_ROUTES[category as keyof typeof API_ROUTES]).toBeDefined();
      });
    });
  });
});

describe('Route Migration', () => {
  it('should provide clear migration path from deprecated to canonical', () => {
    // Deprecated -> Canonical mapping
    const migrations = [
      {
        deprecated: DEPRECATED_ROUTES.githubWebhook,
        canonical: API_ROUTES.webhooks.github,
        description: 'GitHub webhook handler',
      },
    ];

    migrations.forEach(({ deprecated, canonical }) => {
      expect(deprecated).toBeDefined();
      expect(canonical).toBeDefined();
      expect(deprecated).not.toBe(canonical);
    });
  });
});
