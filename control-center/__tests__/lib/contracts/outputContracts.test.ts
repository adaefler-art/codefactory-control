/**
 * Output Contract Tests
 * 
 * Validates type guard functions for DB read output contracts.
 * Ensures proper validation of all required fields.
 * 
 * @jest-environment node
 */

import {
  isWorkflowOutput,
  isWorkflowExecutionOutput,
  isDeployEventOutput,
  isProductOutput,
  WorkflowOutput,
  WorkflowExecutionOutput,
  DeployEventOutput,
  ProductOutput,
} from '../../../src/lib/contracts/outputContracts';

describe('Output Contract Type Guards', () => {
  describe('isWorkflowOutput', () => {
    test('accepts valid workflow output', () => {
      const valid: WorkflowOutput = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-workflow',
        description: 'Test workflow',
        definition: { steps: [] },
        version: 1,
        enabled: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowOutput(valid)).toBe(true);
    });

    test('accepts workflow with null description', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-workflow',
        description: null,
        definition: { steps: [] },
        version: 1,
        enabled: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowOutput(valid)).toBe(true);
    });

    test('rejects workflow with missing id', () => {
      const invalid = {
        name: 'test-workflow',
        description: 'Test',
        definition: { steps: [] },
        version: 1,
        enabled: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowOutput(invalid)).toBe(false);
    });

    test('rejects workflow with wrong type for enabled', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'test-workflow',
        description: 'Test',
        definition: { steps: [] },
        version: 1,
        enabled: 'true', // Should be boolean
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowOutput(invalid)).toBe(false);
    });

    test('rejects non-object input', () => {
      expect(isWorkflowOutput(null)).toBe(false);
      expect(isWorkflowOutput(undefined)).toBe(false);
      expect(isWorkflowOutput('string')).toBe(false);
      expect(isWorkflowOutput(123)).toBe(false);
    });
  });

  describe('isWorkflowExecutionOutput', () => {
    test('accepts valid workflow execution output', () => {
      const valid: WorkflowExecutionOutput = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflow_id: '223e4567-e89b-12d3-a456-426614174000',
        status: 'completed',
        input: { data: 'test' },
        output: { result: 'success' },
        context: { env: 'prod' },
        started_at: '2025-01-01T00:00:00Z',
        completed_at: '2025-01-01T00:05:00Z',
        error: null,
        triggered_by: 'user@example.com',
        github_run_id: '12345',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:05:00Z',
      };

      expect(isWorkflowExecutionOutput(valid)).toBe(true);
    });

    test('accepts execution with null workflow_id', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflow_id: null,
        status: 'pending',
        input: null,
        output: null,
        context: null,
        started_at: '2025-01-01T00:00:00Z',
        completed_at: null,
        error: null,
        triggered_by: null,
        github_run_id: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowExecutionOutput(valid)).toBe(true);
    });

    test('rejects execution with invalid status', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflow_id: '223e4567-e89b-12d3-a456-426614174000',
        status: 'invalid-status',
        input: null,
        output: null,
        context: null,
        started_at: '2025-01-01T00:00:00Z',
        completed_at: null,
        error: null,
        triggered_by: null,
        github_run_id: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(isWorkflowExecutionOutput(invalid)).toBe(false);
    });

    test('accepts all valid status values', () => {
      const statuses: Array<WorkflowExecutionOutput['status']> = [
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ];

      for (const status of statuses) {
        const valid = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          workflow_id: null,
          status,
          input: null,
          output: null,
          context: null,
          started_at: '2025-01-01T00:00:00Z',
          completed_at: null,
          error: null,
          triggered_by: null,
          github_run_id: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        };

        expect(isWorkflowExecutionOutput(valid)).toBe(true);
      }
    });
  });

  describe('isDeployEventOutput', () => {
    test('accepts valid deploy event output', () => {
      const valid: DeployEventOutput = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2025-01-01T00:00:00Z',
        env: 'production',
        service: 'control-center',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 'Deployment successful',
      };

      expect(isDeployEventOutput(valid)).toBe(true);
    });

    test('accepts deploy event with null message', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2025-01-01T00:00:00Z',
        env: 'production',
        service: 'control-center',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: null,
      };

      expect(isDeployEventOutput(valid)).toBe(true);
    });

    test('rejects deploy event with missing required field', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2025-01-01T00:00:00Z',
        env: 'production',
        service: 'control-center',
        version: 'v1.2.3',
        // commit_hash is missing
        status: 'success',
        message: null,
      };

      expect(isDeployEventOutput(invalid)).toBe(false);
    });

    test('rejects deploy event with wrong type for status', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        created_at: '2025-01-01T00:00:00Z',
        env: 'production',
        service: 'control-center',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 123, // Should be string
        message: null,
      };

      expect(isDeployEventOutput(invalid)).toBe(false);
    });
  });

  describe('isProductOutput', () => {
    test('accepts valid product output', () => {
      const valid: ProductOutput = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        repository_id: '223e4567-e89b-12d3-a456-426614174000',
        product_key: 'owner/repo',
        display_name: 'My Product',
        description: 'Product description',
        metadata: { key: 'value' },
        tags: ['tag1', 'tag2'],
        constraints: { max_instances: 10 },
        kpi_targets: { uptime: 99.9 },
        template_id: 'web-service',
        template_config: { port: 3000 },
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: 'platform',
        contact_email: 'team@example.com',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        created_by: 'admin',
        updated_by: 'admin',
      };

      expect(isProductOutput(valid)).toBe(true);
    });

    test('accepts product with null optional fields', () => {
      const valid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        repository_id: '223e4567-e89b-12d3-a456-426614174000',
        product_key: 'owner/repo',
        display_name: 'My Product',
        description: null,
        metadata: {},
        tags: null,
        constraints: {},
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        created_by: null,
        updated_by: null,
      };

      expect(isProductOutput(valid)).toBe(true);
    });

    test('rejects product with missing required field', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        repository_id: '223e4567-e89b-12d3-a456-426614174000',
        // product_key is missing
        display_name: 'My Product',
        description: null,
        metadata: {},
        tags: null,
        constraints: {},
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        created_by: null,
        updated_by: null,
      };

      expect(isProductOutput(invalid)).toBe(false);
    });

    test('rejects product with wrong type for metadata', () => {
      const invalid = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        repository_id: '223e4567-e89b-12d3-a456-426614174000',
        product_key: 'owner/repo',
        display_name: 'My Product',
        description: null,
        metadata: 'not an object', // Should be object
        tags: null,
        constraints: {},
        kpi_targets: {},
        template_id: null,
        template_config: null,
        enabled: true,
        archived: false,
        archived_at: null,
        archived_reason: null,
        isolation_level: 'standard',
        owner_team: null,
        contact_email: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        created_by: null,
        updated_by: null,
      };

      expect(isProductOutput(invalid)).toBe(false);
    });
  });

  describe('validateOutputContract', () => {
    // These tests would go here if we were testing the validateOutputContract function
    // For now, we're focusing on the type guards which are the primary validation mechanism
  });
});
