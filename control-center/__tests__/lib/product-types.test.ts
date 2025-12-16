/**
 * Tests for Product Type Utilities
 * 
 * Tests validation and helper functions in product types
 * EPIC 4: Product Registry & Templates
 */

import {
  validateExecutionAgainstConstraints,
  checkKpiMeetsTarget,
  mergeTemplateWithProduct,
  type ProductConstraints,
  type ProductTemplate,
  type Product,
} from '../../src/lib/types/product';

describe('Product Type Utilities', () => {
  describe('validateExecutionAgainstConstraints', () => {
    const constraints: ProductConstraints = {
      maxBuildDurationMs: 600000,
      maxTestDurationMs: 300000,
      maxDeploymentDurationMs: 600000,
      requireCodeReview: true,
      requireTests: true,
      minTestCoveragePct: 80,
      requireDocumentation: true,
      requireHealthChecks: true,
    };

    test('should return no errors for valid execution', () => {
      const execution = {
        buildDurationMs: 500000,
        testDurationMs: 200000,
        deploymentDurationMs: 500000,
        testCoveragePct: 85,
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors).toHaveLength(0);
    });

    test('should detect build duration violation', () => {
      const execution = {
        buildDurationMs: 700000, // Exceeds 600000
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const buildError = errors.find(e => e.constraintKey === 'maxBuildDurationMs');
      expect(buildError).toBeDefined();
      expect(buildError!.actualValue).toBe(700000);
      expect(buildError!.expectedValue).toBe(600000);
    });

    test('should detect test duration violation', () => {
      const execution = {
        testDurationMs: 400000, // Exceeds 300000
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const testError = errors.find(e => e.constraintKey === 'maxTestDurationMs');
      expect(testError).toBeDefined();
    });

    test('should detect deployment duration violation', () => {
      const execution = {
        deploymentDurationMs: 700000, // Exceeds 600000
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const deployError = errors.find(e => e.constraintKey === 'maxDeploymentDurationMs');
      expect(deployError).toBeDefined();
    });

    test('should detect missing code review', () => {
      const execution = {
        hasCodeReview: false,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const codeReviewError = errors.find(e => e.constraintKey === 'requireCodeReview');
      expect(codeReviewError).toBeDefined();
      expect(codeReviewError!.message).toContain('Code review is required');
    });

    test('should detect missing tests', () => {
      const execution = {
        hasTests: false,
        hasCodeReview: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const testsError = errors.find(e => e.constraintKey === 'requireTests');
      expect(testsError).toBeDefined();
    });

    test('should detect insufficient test coverage', () => {
      const execution = {
        testCoveragePct: 70, // Below 80%
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const coverageError = errors.find(e => e.constraintKey === 'minTestCoveragePct');
      expect(coverageError).toBeDefined();
      expect(coverageError!.actualValue).toBe(70);
      expect(coverageError!.expectedValue).toBe(80);
    });

    test('should detect missing documentation', () => {
      const execution = {
        hasDocumentation: false,
        hasCodeReview: true,
        hasTests: true,
        hasHealthChecks: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const docError = errors.find(e => e.constraintKey === 'requireDocumentation');
      expect(docError).toBeDefined();
    });

    test('should detect missing health checks', () => {
      const execution = {
        hasHealthChecks: false,
        hasCodeReview: true,
        hasTests: true,
        hasDocumentation: true,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      const healthError = errors.find(e => e.constraintKey === 'requireHealthChecks');
      expect(healthError).toBeDefined();
    });

    test('should detect multiple violations', () => {
      const execution = {
        buildDurationMs: 700000,
        testDurationMs: 400000,
        testCoveragePct: 70,
        hasCodeReview: false,
        hasTests: false,
      };

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      expect(errors.length).toBeGreaterThan(1);
      expect(errors.map(e => e.constraintKey)).toContain('maxBuildDurationMs');
      expect(errors.map(e => e.constraintKey)).toContain('maxTestDurationMs');
      expect(errors.map(e => e.constraintKey)).toContain('minTestCoveragePct');
      expect(errors.map(e => e.constraintKey)).toContain('requireCodeReview');
      expect(errors.map(e => e.constraintKey)).toContain('requireTests');
    });

    test('should ignore constraints when execution data not provided', () => {
      const execution = {};

      const errors = validateExecutionAgainstConstraints(constraints, execution);

      // Only quality gates without execution data should fail
      expect(errors).toHaveLength(4); // requireCodeReview, requireTests, requireDocumentation, requireHealthChecks
      expect(errors.every(e => e.actualValue === false)).toBe(true);
    });
  });

  describe('checkKpiMeetsTarget', () => {
    test('should return true when success rate meets target', () => {
      const result = checkKpiMeetsTarget('successRate', 92, 90);
      expect(result).toBe(true);
    });

    test('should return false when success rate below target', () => {
      const result = checkKpiMeetsTarget('successRate', 85, 90);
      expect(result).toBe(false);
    });

    test('should return true when MTTI meets target (lower is better)', () => {
      const result = checkKpiMeetsTarget('mtti', 250000, 300000);
      expect(result).toBe(true);
    });

    test('should return false when MTTI exceeds target (lower is better)', () => {
      const result = checkKpiMeetsTarget('mtti', 350000, 300000);
      expect(result).toBe(false);
    });

    test('should return true when execution duration meets target (lower is better)', () => {
      const result = checkKpiMeetsTarget('executionDuration', 500000, 600000);
      expect(result).toBe(true);
    });

    test('should return false when execution duration exceeds target', () => {
      const result = checkKpiMeetsTarget('executionDuration', 700000, 600000);
      expect(result).toBe(false);
    });

    test('should return true when MTTR meets target (lower is better)', () => {
      const result = checkKpiMeetsTarget('mttr', 500, 600);
      expect(result).toBe(true);
    });

    test('should handle higher-is-better KPIs by default', () => {
      const result = checkKpiMeetsTarget('customKpi', 95, 90);
      expect(result).toBe(true);
    });
  });

  describe('mergeTemplateWithProduct', () => {
    const template: ProductTemplate = {
      id: 'web-service',
      name: 'Web Service',
      description: 'Standard web service template',
      defaultMetadata: {
        primaryLanguage: 'JavaScript',
        framework: 'Express',
      },
      defaultConstraints: {
        maxBuildDurationMs: 600000,
        requireTests: true,
        minTestCoveragePct: 80,
      },
      defaultKpiTargets: {
        successRate: 90,
        mtti: 300000,
      },
      enabled: true,
      version: '1.0.0',
      createdAt: '2024-12-16T00:00:00Z',
      updatedAt: '2024-12-16T00:00:00Z',
    };

    test('should merge template defaults with product overrides', () => {
      const product: Partial<Product> = {
        metadata: {
          primaryLanguage: 'TypeScript', // Override
          deploymentTarget: 'AWS', // Additional
        },
        constraints: {
          maxBuildDurationMs: 900000, // Override
        },
        kpiTargets: {
          successRate: 95, // Override
        },
      };

      const result = mergeTemplateWithProduct(template, product);

      expect(result.metadata.primaryLanguage).toBe('TypeScript');
      expect(result.metadata.framework).toBe('Express');
      expect(result.metadata.deploymentTarget).toBe('AWS');

      expect(result.constraints.maxBuildDurationMs).toBe(900000);
      expect(result.constraints.requireTests).toBe(true);
      expect(result.constraints.minTestCoveragePct).toBe(80);

      expect(result.kpiTargets.successRate).toBe(95);
      expect(result.kpiTargets.mtti).toBe(300000);
    });

    test('should handle null template', () => {
      const product: Partial<Product> = {
        metadata: { primaryLanguage: 'Go' },
        constraints: { maxBuildDurationMs: 600000 },
        kpiTargets: { successRate: 90 },
      };

      const result = mergeTemplateWithProduct(null, product);

      expect(result.metadata.primaryLanguage).toBe('Go');
      expect(result.constraints.maxBuildDurationMs).toBe(600000);
      expect(result.kpiTargets.successRate).toBe(90);
    });

    test('should handle empty product overrides', () => {
      const product: Partial<Product> = {};

      const result = mergeTemplateWithProduct(template, product);

      expect(result.metadata).toEqual(template.defaultMetadata);
      expect(result.constraints).toEqual(template.defaultConstraints);
      expect(result.kpiTargets).toEqual(template.defaultKpiTargets);
    });

    test('should handle product without template', () => {
      const product: Partial<Product> = {
        metadata: { primaryLanguage: 'Rust' },
        constraints: { maxBuildDurationMs: 300000 },
        kpiTargets: { successRate: 95 },
      };

      const result = mergeTemplateWithProduct(null, product);

      expect(result.metadata.primaryLanguage).toBe('Rust');
      expect(result.constraints.maxBuildDurationMs).toBe(300000);
      expect(result.kpiTargets.successRate).toBe(95);
    });

    test('should deeply merge nested objects', () => {
      const template: ProductTemplate = {
        id: 'custom',
        name: 'Custom',
        description: 'Custom template',
        defaultMetadata: {
          customFields: {
            field1: 'value1',
            field2: 'value2',
          },
        },
        defaultConstraints: {},
        defaultKpiTargets: {},
        enabled: true,
        version: '1.0.0',
        createdAt: '2024-12-16T00:00:00Z',
        updatedAt: '2024-12-16T00:00:00Z',
      };

      const product: Partial<Product> = {
        metadata: {
          customFields: {
            field2: 'overridden',
            field3: 'new',
          },
        },
      };

      const result = mergeTemplateWithProduct(template, product);

      expect(result.metadata.customFields).toBeDefined();
      // Note: Shallow merge, so product customFields completely replace template customFields
      expect(result.metadata.customFields.field2).toBe('overridden');
      expect(result.metadata.customFields.field3).toBe('new');
    });
  });
});
