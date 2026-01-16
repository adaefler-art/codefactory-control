/**
 * V09-I04: Work Plan API Tests
 * 
 * Tests for /api/intent/sessions/[id]/work-plan endpoints
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getWorkPlan, PUT as updateWorkPlan } from '../../app/api/intent/sessions/[id]/work-plan/route';
import { WORK_PLAN_VERSION } from '../../src/lib/schemas/workPlan';
import type { WorkPlanContentV1 } from '../../src/lib/schemas/workPlan';

// Enable INTENT agent for tests
process.env.AFU9_INTENT_ENABLED = 'true';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/intentWorkPlans', () => ({
  getWorkPlan: jest.fn(),
  saveWorkPlan: jest.fn(),
}));

const TEST_USER_ID = 'user-123';
const TEST_USER_ID_2 = 'user-456';
const TEST_SESSION_ID = 'session-abc-123';

const TEST_WORK_PLAN_CONTENT: WorkPlanContentV1 = {
  goals: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      text: 'Implement user authentication',
      priority: 'HIGH',
      completed: false,
    },
  ],
  context: 'Need secure login for the application',
  options: [
    {
      id: '550e8400-e29b-41d4-a716-446655440001',
      title: 'JWT tokens',
      description: 'Use JSON Web Tokens for stateless auth',
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

describe('GET /api/intent/sessions/[id]/work-plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 and work plan when plan exists', async () => {
    const { getWorkPlan: getWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    getWorkPlanMock.mockResolvedValue({
      success: true,
      data: {
        session_id: TEST_SESSION_ID,
        schema_version: '1.0.0',
        content_json: TEST_WORK_PLAN_CONTENT,
        content_hash: 'abc123def456789',
        updated_at: '2026-01-16T12:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-1',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-get-plan-1');
    expect(body.version).toBe(WORK_PLAN_VERSION);
    expect(body.exists).toBe(true);
    expect(body.content).toEqual(TEST_WORK_PLAN_CONTENT);
    expect(body.contentHash).toBe('abc123def456'); // First 12 chars
    expect(body.updatedAt).toBe('2026-01-16T12:00:00.000Z');
    expect(getWorkPlanMock).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID
    );
  });

  test('returns 200 and empty state when no plan exists', async () => {
    const { getWorkPlan: getWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    getWorkPlanMock.mockResolvedValue({
      success: true,
      data: null,
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-empty',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(WORK_PLAN_VERSION);
    expect(body.exists).toBe(false);
    expect(body.reason).toBe('NO_PLAN');
    expect(body.content).toBeUndefined();
    expect(body.contentHash).toBeUndefined();
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-unauth',
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(401);
  });

  test('returns 404 when session not found', async () => {
    const { getWorkPlan: getWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    getWorkPlanMock.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-notfound',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(404);
  });

  test('returns 400 when session ID is missing', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions//work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-no-id',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: '' }) });

    expect(response.status).toBe(400);
  });

  test('denies access to other users sessions', async () => {
    const { getWorkPlan: getWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    getWorkPlanMock.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      headers: {
        'x-request-id': 'test-req-get-plan-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
      },
    });

    const response = await getWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/intent/sessions/[id]/work-plan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 and saves work plan with deterministic schema', async () => {
    const { saveWorkPlan: saveWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    saveWorkPlanMock.mockResolvedValue({
      success: true,
      data: {
        session_id: TEST_SESSION_ID,
        schema_version: '1.0.0',
        content_json: TEST_WORK_PLAN_CONTENT,
        content_hash: 'abc123def456789',
        updated_at: '2026-01-16T12:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-1',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: TEST_WORK_PLAN_CONTENT,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe(WORK_PLAN_VERSION);
    expect(body.exists).toBe(true);
    expect(body.content).toEqual(TEST_WORK_PLAN_CONTENT);
    expect(body.contentHash).toBe('abc123def456');
    expect(body.updatedAt).toBe('2026-01-16T12:00:00.000Z');
    expect(saveWorkPlanMock).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID,
      TEST_WORK_PLAN_CONTENT,
      WORK_PLAN_VERSION
    );
  });

  test('returns 200 and saves minimal work plan', async () => {
    const { saveWorkPlan: saveWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    const minimalContent: WorkPlanContentV1 = {
      goals: [],
      options: [],
      todos: [],
    };

    saveWorkPlanMock.mockResolvedValue({
      success: true,
      data: {
        session_id: TEST_SESSION_ID,
        schema_version: '1.0.0',
        content_json: minimalContent,
        content_hash: 'xyz789',
        updated_at: '2026-01-16T12:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-minimal',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: minimalContent,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.content).toEqual(minimalContent);
  });

  test('returns 401 when not authenticated', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-unauth',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: TEST_WORK_PLAN_CONTENT,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(401);
  });

  test('returns 400 for invalid JSON', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-bad-json',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: 'invalid json',
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(400);
  });

  test('returns 400 for invalid content schema', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-invalid-schema',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          goals: 'not an array', // Invalid
          options: [],
          todos: [],
        },
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(400);
  });

  test('returns 400 for missing content field', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-no-content',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(400);
  });

  test('returns 400 when content contains secrets', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-secrets',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: {
          goals: [],
          context: 'Use api_key: abc123',
          options: [],
          todos: [],
        },
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('secrets');
  });

  test('returns 404 when session not found', async () => {
    const { saveWorkPlan: saveWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    saveWorkPlanMock.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-notfound',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: TEST_WORK_PLAN_CONTENT,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(404);
  });

  test('returns 400 when session ID is missing', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions//work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-no-id',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: TEST_WORK_PLAN_CONTENT,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: '' }) });

    expect(response.status).toBe(400);
  });

  test('denies update to other users sessions', async () => {
    const { saveWorkPlan: saveWorkPlanMock } = require('../../src/lib/db/intentWorkPlans');

    saveWorkPlanMock.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: TEST_WORK_PLAN_CONTENT,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(404);
  });

  test('rejects content with too many goals (>50)', async () => {
    const oversizedContent = {
      goals: Array(51).fill({
        id: '550e8400-e29b-41d4-a716-446655440000',
        text: 'Goal',
        completed: false,
      }),
      options: [],
      todos: [],
    };

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/work-plan`, {
      method: 'PUT',
      headers: {
        'x-request-id': 'test-req-put-plan-too-many-goals',
        'x-afu9-sub': TEST_USER_ID,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        content: oversizedContent,
      }),
    });

    const response = await updateWorkPlan(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });

    expect(response.status).toBe(400);
  });
});
