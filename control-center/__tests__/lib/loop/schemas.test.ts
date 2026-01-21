/**
 * Tests for Loop API Schemas
 * 
 * E9.1-CTRL-1: Verify Zod validation works correctly
 */

import {
  RunNextStepRequestSchema,
  RunNextStepResponseSchema,
  LoopErrorResponseSchema,
  createLoopError,
  getHttpStatusForErrorCode,
  LOOP_SCHEMA_VERSION,
} from '@/lib/loop/schemas';

describe('Loop API Schemas', () => {
  describe('RunNextStepRequestSchema', () => {
    it('should validate empty object with default mode', () => {
      const result = RunNextStepRequestSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('execute');
      }
    });

    it('should validate execute mode', () => {
      const result = RunNextStepRequestSchema.safeParse({ mode: 'execute' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('execute');
      }
    });

    it('should validate dryRun mode', () => {
      const result = RunNextStepRequestSchema.safeParse({ mode: 'dryRun' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('dryRun');
      }
    });

    it('should reject invalid mode enum value', () => {
      const result = RunNextStepRequestSchema.safeParse({ mode: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject extra fields (strict schema)', () => {
      const result = RunNextStepRequestSchema.safeParse({
        mode: 'execute',
        extraField: 'should fail',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RunNextStepResponseSchema', () => {
    it('should validate minimal response', () => {
      const response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        issueId: 'AFU9-123',
        loopStatus: 'active' as const,
      };
      const result = RunNextStepResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate response with step executed', () => {
      const response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        issueId: 'AFU9-123',
        stepExecuted: {
          stepNumber: 1,
          stepType: 'initialize',
          status: 'completed' as const,
          startedAt: '2026-01-21T07:00:00.000Z',
          completedAt: '2026-01-21T07:00:05.000Z',
          durationMs: 5000,
        },
        nextStep: {
          stepNumber: 2,
          stepType: 'process',
          estimatedDurationMs: 10000,
        },
        loopStatus: 'active' as const,
        message: 'Step completed successfully',
      };
      const result = RunNextStepResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject invalid schema version', () => {
      const response = {
        schemaVersion: 'wrong.version',
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        issueId: 'AFU9-123',
        loopStatus: 'active' as const,
      };
      const result = RunNextStepResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject invalid loop status', () => {
      const response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        issueId: 'AFU9-123',
        loopStatus: 'invalid-status',
      };
      const result = RunNextStepResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject negative step numbers', () => {
      const response = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        issueId: 'AFU9-123',
        stepExecuted: {
          stepNumber: -1,
          stepType: 'test',
          status: 'completed' as const,
          startedAt: '2026-01-21T07:00:00.000Z',
        },
        loopStatus: 'active' as const,
      };
      const result = RunNextStepResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });

  describe('LoopErrorResponseSchema', () => {
    it('should validate error response', () => {
      const error = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        error: {
          code: 'UNAUTHORIZED' as const,
          message: 'Authentication required',
        },
        timestamp: '2026-01-21T07:00:00.000Z',
      };
      const result = LoopErrorResponseSchema.safeParse(error);
      expect(result.success).toBe(true);
    });

    it('should validate error response with details', () => {
      const error = {
        schemaVersion: LOOP_SCHEMA_VERSION,
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        error: {
          code: 'INVALID_REQUEST' as const,
          message: 'Validation failed',
          details: {
            field: 'mode',
            issue: 'invalid enum value',
          },
        },
        timestamp: '2026-01-21T07:00:00.000Z',
      };
      const result = LoopErrorResponseSchema.safeParse(error);
      expect(result.success).toBe(true);
    });
  });

  describe('createLoopError helper', () => {
    it('should create error with correct structure', () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';
      const error = createLoopError(requestId, 'ISSUE_NOT_FOUND', 'Issue not found');
      
      expect(error.schemaVersion).toBe(LOOP_SCHEMA_VERSION);
      expect(error.requestId).toBe(requestId);
      expect(error.error.code).toBe('ISSUE_NOT_FOUND');
      expect(error.error.message).toBe('Issue not found');
      expect(error.timestamp).toBeDefined();
    });

    it('should create error with details', () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';
      const details = { issueId: 'AFU9-999' };
      const error = createLoopError(requestId, 'ISSUE_NOT_FOUND', 'Issue not found', details);
      
      expect(error.error.details).toEqual(details);
    });
  });

  describe('getHttpStatusForErrorCode', () => {
    it('should return 401 for UNAUTHORIZED', () => {
      expect(getHttpStatusForErrorCode('UNAUTHORIZED')).toBe(401);
    });

    it('should return 404 for ISSUE_NOT_FOUND', () => {
      expect(getHttpStatusForErrorCode('ISSUE_NOT_FOUND')).toBe(404);
    });

    it('should return 409 for LOOP_CONFLICT', () => {
      expect(getHttpStatusForErrorCode('LOOP_CONFLICT')).toBe(409);
    });

    it('should return 400 for INVALID_REQUEST', () => {
      expect(getHttpStatusForErrorCode('INVALID_REQUEST')).toBe(400);
    });

    it('should return 500 for INTERNAL_ERROR', () => {
      expect(getHttpStatusForErrorCode('INTERNAL_ERROR')).toBe(500);
    });
  });
});
