/**
 * V09-I04: Work Plan Schema Tests
 * 
 * Tests for WorkPlanV1 schema validation, helper functions, and hash generation
 * 
 * @jest-environment node
 */

import {
  WorkPlanContentV1Schema,
  WorkPlanResponseV1Schema,
  WorkPlanUpdateRequestSchema,
  WorkPlanGoalSchema,
  WorkPlanTodoSchema,
  WorkPlanOptionSchema,
  WORK_PLAN_VERSION,
  createEmptyWorkPlanResponse,
  createWorkPlanResponse,
  hashWorkPlanContent,
  validateNoSecrets,
  type WorkPlanContentV1,
} from '../../../src/lib/schemas/workPlan';

describe('WorkPlanV1 Schema', () => {
  describe('WorkPlanGoalSchema', () => {
    test('validates valid goal', () => {
      const goal = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Implement user authentication',
        priority: 'HIGH',
        completed: false,
      };
      
      const result = WorkPlanGoalSchema.safeParse(goal);
      expect(result.success).toBe(true);
    });
    
    test('validates goal without optional fields', () => {
      const goal = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Implement user authentication',
        completed: false,
      };
      
      const result = WorkPlanGoalSchema.safeParse(goal);
      expect(result.success).toBe(true);
    });
    
    test('rejects goal with invalid UUID', () => {
      const goal = {
        id: 'invalid-uuid',
        text: 'Implement user authentication',
        completed: false,
      };
      
      const result = WorkPlanGoalSchema.safeParse(goal);
      expect(result.success).toBe(false);
    });
    
    test('rejects goal with text exceeding 5000 chars', () => {
      const goal = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'x'.repeat(5001),
        completed: false,
      };
      
      const result = WorkPlanGoalSchema.safeParse(goal);
      expect(result.success).toBe(false);
    });
    
    test('rejects goal with extra fields (strict mode)', () => {
      const goal = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Implement user authentication',
        completed: false,
        extraField: 'not allowed',
      };
      
      const result = WorkPlanGoalSchema.safeParse(goal);
      expect(result.success).toBe(false);
    });
  });
  
  describe('WorkPlanTodoSchema', () => {
    test('validates valid todo', () => {
      const todo = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Write unit tests',
        completed: false,
        assignedGoalId: '550e8400-e29b-41d4-a716-446655440001',
      };
      
      const result = WorkPlanTodoSchema.safeParse(todo);
      expect(result.success).toBe(true);
    });
    
    test('validates todo without optional assignedGoalId', () => {
      const todo = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Write unit tests',
        completed: false,
      };
      
      const result = WorkPlanTodoSchema.safeParse(todo);
      expect(result.success).toBe(true);
    });
  });
  
  describe('WorkPlanOptionSchema', () => {
    test('validates valid option', () => {
      const option = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Use PostgreSQL',
        description: 'PostgreSQL is a robust relational database',
        pros: ['ACID compliant', 'Strong JSON support', 'Well documented'],
        cons: ['Higher resource usage', 'More complex setup'],
      };
      
      const result = WorkPlanOptionSchema.safeParse(option);
      expect(result.success).toBe(true);
    });
    
    test('validates option with empty arrays', () => {
      const option = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Use PostgreSQL',
        description: 'PostgreSQL is a robust relational database',
        pros: [],
        cons: [],
      };
      
      const result = WorkPlanOptionSchema.safeParse(option);
      expect(result.success).toBe(true);
    });
    
    test('rejects option with title exceeding 200 chars', () => {
      const option = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'x'.repeat(201),
        description: 'Description',
        pros: [],
        cons: [],
      };
      
      const result = WorkPlanOptionSchema.safeParse(option);
      expect(result.success).toBe(false);
    });
    
    test('rejects option with too many pros (>50)', () => {
      const option = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        title: 'Use PostgreSQL',
        description: 'Description',
        pros: Array(51).fill('pro'),
        cons: [],
      };
      
      const result = WorkPlanOptionSchema.safeParse(option);
      expect(result.success).toBe(false);
    });
  });
  
  describe('WorkPlanContentV1Schema', () => {
    test('validates valid complete plan', () => {
      const content: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Implement authentication',
            priority: 'HIGH',
            completed: false,
          },
        ],
        context: 'We need secure user authentication for the app',
        options: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            title: 'JWT tokens',
            description: 'Use JSON Web Tokens',
            pros: ['Stateless', 'Standard'],
            cons: ['Token size'],
          },
        ],
        todos: [
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            text: 'Research JWT libraries',
            completed: false,
          },
        ],
        notes: 'Consider refresh token rotation',
      };
      
      const result = WorkPlanContentV1Schema.safeParse(content);
      expect(result.success).toBe(true);
    });
    
    test('validates minimal plan (only defaults)', () => {
      const content = {
        goals: [],
        options: [],
        todos: [],
      };
      
      const result = WorkPlanContentV1Schema.safeParse(content);
      expect(result.success).toBe(true);
    });
    
    test('validates plan without optional fields', () => {
      const content = {
        goals: [],
        options: [],
        todos: [],
      };
      
      const result = WorkPlanContentV1Schema.safeParse(content);
      expect(result.success).toBe(true);
    });
    
    test('rejects plan with too many goals (>50)', () => {
      const content = {
        goals: Array(51).fill({
          id: '550e8400-e29b-41d4-a716-446655440000',
          text: 'Goal',
          completed: false,
        }),
        options: [],
        todos: [],
      };
      
      const result = WorkPlanContentV1Schema.safeParse(content);
      expect(result.success).toBe(false);
    });
    
    test('rejects plan with extra fields (strict mode)', () => {
      const content = {
        goals: [],
        options: [],
        todos: [],
        extraField: 'not allowed',
      };
      
      const result = WorkPlanContentV1Schema.safeParse(content);
      expect(result.success).toBe(false);
    });
  });
  
  describe('WorkPlanResponseV1Schema', () => {
    test('validates response with existing plan', () => {
      const response = {
        version: '1.0.0',
        exists: true,
        content: {
          goals: [],
          options: [],
          todos: [],
        },
        contentHash: 'abc123def456',
        updatedAt: '2026-01-16T12:00:00.000Z',
      };
      
      const result = WorkPlanResponseV1Schema.safeParse(response);
      expect(result.success).toBe(true);
    });
    
    test('validates response with no plan (empty state)', () => {
      const response = {
        version: '1.0.0',
        exists: false,
        reason: 'NO_PLAN',
      };
      
      const result = WorkPlanResponseV1Schema.safeParse(response);
      expect(result.success).toBe(true);
    });
    
    test('rejects response with invalid version', () => {
      const response = {
        version: '2.0.0',
        exists: false,
        reason: 'NO_PLAN',
      };
      
      const result = WorkPlanResponseV1Schema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });
  
  describe('WorkPlanUpdateRequestSchema', () => {
    test('validates valid update request', () => {
      const request = {
        content: {
          goals: [],
          options: [],
          todos: [],
        },
      };
      
      const result = WorkPlanUpdateRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
    
    test('rejects request without content', () => {
      const request = {};
      
      const result = WorkPlanUpdateRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });
    
    test('rejects request with extra fields', () => {
      const request = {
        content: {
          goals: [],
          options: [],
          todos: [],
        },
        extraField: 'not allowed',
      };
      
      const result = WorkPlanUpdateRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });
  });
  
  describe('createEmptyWorkPlanResponse', () => {
    test('creates deterministic empty response', () => {
      const response1 = createEmptyWorkPlanResponse();
      const response2 = createEmptyWorkPlanResponse();
      
      expect(response1).toEqual(response2);
      expect(response1.version).toBe(WORK_PLAN_VERSION);
      expect(response1.exists).toBe(false);
      expect(response1.reason).toBe('NO_PLAN');
    });
  });
  
  describe('createWorkPlanResponse', () => {
    test('creates response from database data', () => {
      const dbData = {
        content_json: {
          goals: [],
          options: [],
          todos: [],
        },
        content_hash: 'abcdef123456789',
        updated_at: '2026-01-16T12:00:00.000Z',
        schema_version: '1.0.0',
      };
      
      const response = createWorkPlanResponse(dbData);
      
      expect(response.version).toBe('1.0.0');
      expect(response.exists).toBe(true);
      expect(response.content).toEqual(dbData.content_json);
      expect(response.contentHash).toBe('abcdef123456'); // First 12 chars
      expect(response.updatedAt).toBe('2026-01-16T12:00:00.000Z');
    });
    
    test('returns empty state for invalid stored content', () => {
      const dbData = {
        content_json: { invalid: 'data' },
        content_hash: 'abcdef123456789',
        updated_at: '2026-01-16T12:00:00.000Z',
        schema_version: '1.0.0',
      };
      
      const response = createWorkPlanResponse(dbData);
      
      expect(response.exists).toBe(false);
      expect(response.reason).toBe('NO_PLAN');
    });
  });
  
  describe('hashWorkPlanContent', () => {
    test('generates deterministic hash for same content', () => {
      const content: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Goal 1',
            completed: false,
          },
        ],
        options: [],
        todos: [],
      };
      
      const hash1 = hashWorkPlanContent(content);
      const hash2 = hashWorkPlanContent(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex string
    });
    
    test('generates different hash for different content', () => {
      const content1: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Goal 1',
            completed: false,
          },
        ],
        options: [],
        todos: [],
      };
      
      const content2: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Goal 2',
            completed: false,
          },
        ],
        options: [],
        todos: [],
      };
      
      const hash1 = hashWorkPlanContent(content1);
      const hash2 = hashWorkPlanContent(content2);
      
      expect(hash1).not.toBe(hash2);
    });
  });
  
  describe('validateNoSecrets', () => {
    test('passes for clean content', () => {
      const content: WorkPlanContentV1 = {
        goals: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            text: 'Implement feature X',
            completed: false,
          },
        ],
        context: 'User needs authentication',
        options: [],
        todos: [],
      };
      
      const result = validateNoSecrets(content);
      expect(result).toBe(true);
    });
    
    test('detects api_key pattern', () => {
      const content: WorkPlanContentV1 = {
        goals: [],
        context: 'Use api_key: abc123',
        options: [],
        todos: [],
      };
      
      const result = validateNoSecrets(content);
      expect(result).not.toBe(true);
      expect(result).toContain('api[_-]?key');
    });
    
    test('detects password pattern', () => {
      const content: WorkPlanContentV1 = {
        goals: [],
        context: 'The password is secret123',
        options: [],
        todos: [],
      };
      
      const result = validateNoSecrets(content);
      expect(result).not.toBe(true);
      expect(result).toContain('password');
    });
    
    test('detects bearer token pattern', () => {
      const content: WorkPlanContentV1 = {
        goals: [],
        context: 'Authorization: Bearer abc123xyz',
        options: [],
        todos: [],
      };
      
      const result = validateNoSecrets(content);
      expect(result).not.toBe(true);
      expect(result).toContain('bearer');
    });
    
    test('detects secret_key pattern', () => {
      const content: WorkPlanContentV1 = {
        goals: [],
        notes: 'secret-key: mykey123',
        options: [],
        todos: [],
      };
      
      const result = validateNoSecrets(content);
      expect(result).not.toBe(true);
      expect(result).toContain('secret');
    });
  });
});
