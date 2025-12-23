/**
 * Deploy Event Contract Tests
 * 
 * Validates the contract schema for deploy_events table.
 * Ensures proper validation of required fields and length constraints.
 * 
 * @jest-environment node
 */

import {
  validateDeployEventInput,
  sanitizeDeployEventInput,
  DEPLOY_EVENT_CONSTRAINTS,
  DeployEventInput,
} from '../../../src/lib/contracts/deployEvent';

describe('Deploy Event Contract Validation', () => {
  describe('validateDeployEventInput', () => {
    test('accepts valid input with all required fields', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts valid input with optional message field', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 'Deployment completed successfully',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('accepts null message field', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: null,
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects non-object input', () => {
      const result = validateDeployEventInput('not an object');

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('input');
      expect(result.errors[0].message).toContain('must be an object');
    });

    test('rejects null input', () => {
      const result = validateDeployEventInput(null);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe('input');
    });

    test('rejects missing required field: env', () => {
      const input = {
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'env')).toBe(true);
    });

    test('rejects missing required field: service', () => {
      const input = {
        env: 'production',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'service')).toBe(true);
    });

    test('rejects missing required field: version', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'version')).toBe(true);
    });

    test('rejects missing required field: commit_hash', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'commit_hash')).toBe(true);
    });

    test('rejects missing required field: status', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'status')).toBe(true);
    });

    test('rejects empty string for required field', () => {
      const input = {
        env: '',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'env')).toBe(true);
    });

    test('rejects whitespace-only string for required field', () => {
      const input = {
        env: '   ',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'env')).toBe(true);
    });

    test('rejects env exceeding max length', () => {
      const input = {
        env: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.env + 1),
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'env' && e.message.includes('exceeds'))).toBe(
        true
      );
    });

    test('rejects service exceeding max length', () => {
      const input = {
        env: 'production',
        service: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.service + 1),
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'service' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('rejects version exceeding max length', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.version + 1),
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'version' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('rejects commit_hash exceeding max length', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.commit_hash + 1),
        status: 'success',
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'commit_hash' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('rejects status exceeding max length', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.status + 1),
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'status' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('rejects message exceeding max length', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.message + 1),
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'message' && e.message.includes('exceeds'))
      ).toBe(true);
    });

    test('rejects non-string message', () => {
      const input = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 123 as any,
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.field === 'message' && e.message.includes('must be a string'))
      ).toBe(true);
    });

    test('validates at exact max lengths (boundary test)', () => {
      const input = {
        env: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.env),
        service: 'b'.repeat(DEPLOY_EVENT_CONSTRAINTS.service),
        version: 'c'.repeat(DEPLOY_EVENT_CONSTRAINTS.version),
        commit_hash: 'd'.repeat(DEPLOY_EVENT_CONSTRAINTS.commit_hash),
        status: 'e'.repeat(DEPLOY_EVENT_CONSTRAINTS.status),
        message: 'f'.repeat(DEPLOY_EVENT_CONSTRAINTS.message),
      };

      const result = validateDeployEventInput(input);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('sanitizeDeployEventInput', () => {
    test('trims whitespace from all fields', () => {
      const input: DeployEventInput = {
        env: '  production  ',
        service: '  api-gateway  ',
        version: '  v1.2.3  ',
        commit_hash: '  abc123def456  ',
        status: '  success  ',
        message: '  Deployment completed  ',
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.env).toBe('production');
      expect(result.service).toBe('api-gateway');
      expect(result.version).toBe('v1.2.3');
      expect(result.commit_hash).toBe('abc123def456');
      expect(result.status).toBe('success');
      expect(result.message).toBe('Deployment completed');
    });

    test('clamps env to max length', () => {
      const input: DeployEventInput = {
        env: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.env + 10),
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.env).toHaveLength(DEPLOY_EVENT_CONSTRAINTS.env);
    });

    test('clamps service to max length', () => {
      const input: DeployEventInput = {
        env: 'production',
        service: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.service + 10),
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.service).toHaveLength(DEPLOY_EVENT_CONSTRAINTS.service);
    });

    test('clamps message to max length', () => {
      const input: DeployEventInput = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 'a'.repeat(DEPLOY_EVENT_CONSTRAINTS.message + 10),
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.message).toHaveLength(DEPLOY_EVENT_CONSTRAINTS.message);
    });

    test('handles undefined message', () => {
      const input: DeployEventInput = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.message).toBeNull();
    });

    test('handles null message', () => {
      const input: DeployEventInput = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: null,
      };

      const result = sanitizeDeployEventInput(input);

      expect(result.message).toBeNull();
    });

    test('preserves valid input unchanged (except whitespace)', () => {
      const input: DeployEventInput = {
        env: 'production',
        service: 'api-gateway',
        version: 'v1.2.3',
        commit_hash: 'abc123def456',
        status: 'success',
        message: 'All systems go',
      };

      const result = sanitizeDeployEventInput(input);

      expect(result).toEqual(input);
    });
  });
});
