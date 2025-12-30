/**
 * Playbook Contract Tests
 * 
 * Tests schema validation for playbook definitions and results.
 * Ensures type safety and deterministic validation.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 * 
 * @jest-environment node
 */

import {
  validatePlaybookDefinition,
  validatePlaybookRunResult,
  PlaybookDefinitionSchema,
  PlaybookStepSchema,
  HttpCheckStepSchema,
  PlaybookRunResultSchema,
} from '../../src/lib/contracts/playbook';

describe('Playbook Contract Validation', () => {
  describe('HttpCheckStepSchema', () => {
    test('validates valid HTTP check step', () => {
      const validStep = {
        type: 'http_check',
        url: 'https://example.com/api/health',
        method: 'GET',
        expectedStatus: 200,
        timeoutSeconds: 30,
      };

      const result = HttpCheckStepSchema.safeParse(validStep);
      expect(result.success).toBe(true);
    });

    test('rejects invalid URL', () => {
      const invalidStep = {
        type: 'http_check',
        url: 'not-a-url',
        method: 'GET',
      };

      const result = HttpCheckStepSchema.safeParse(invalidStep);
      expect(result.success).toBe(false);
    });

    test('applies default values', () => {
      const step = {
        type: 'http_check',
        url: 'https://example.com',
      };

      const result = HttpCheckStepSchema.safeParse(step);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.method).toBe('GET');
        expect(result.data.expectedStatus).toBe(200);
        expect(result.data.timeoutSeconds).toBe(30);
      }
    });
  });

  describe('PlaybookDefinitionSchema', () => {
    test('validates valid playbook definition', () => {
      const validPlaybook = {
        metadata: {
          id: 'post-deploy-verify',
          name: 'Post-Deploy Verification',
          version: '1.0.0',
          environments: ['stage', 'prod'],
          description: 'Test playbook',
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 2,
            input: {
              type: 'http_check',
              url: 'https://example.com/api/health',
              method: 'GET',
              expectedStatus: 200,
            },
          },
        ],
      };

      const result = validatePlaybookDefinition(validPlaybook);
      expect(result.valid).toBe(true);
      expect(result.playbook).toBeDefined();
    });

    test('rejects invalid version format', () => {
      const invalidPlaybook = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: 'v1.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com',
            },
          },
        ],
      };

      const result = validatePlaybookDefinition(invalidPlaybook);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  describe('Deterministic Validation', () => {
    test('same input produces same validation result', () => {
      const playbook = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            retries: 1,
            input: {
              type: 'http_check',
              url: 'https://example.com',
            },
          },
        ],
      };

      const result1 = validatePlaybookDefinition(playbook);
      const result2 = validatePlaybookDefinition(playbook);

      expect(result1.valid).toBe(result2.valid);
      expect(result1.valid).toBe(true);
    });
  });
});
