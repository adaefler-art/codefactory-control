/**
 * V09-I01: Session Conversation Mode API Tests
 * 
 * Tests for /api/intent/sessions/[id]/mode endpoints
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getMode, PUT as updateMode } from '../../app/api/intent/sessions/[id]/mode/route';
import { CONVERSATION_MODE_VERSION } from '../../src/lib/schemas/conversationMode';

// Enable INTENT agent for tests
process.env.AFU9_INTENT_ENABLED = 'true';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/intentSessions', () => ({
  getIntentSession: jest.fn(),
  updateSessionMode: jest.fn(),
}));

const TEST_USER_ID = 'user-123';
const TEST_USER_ID_2 = 'user-456';
const TEST_SESSION_ID = 'session-abc-123';

describe('GET /api/intent/sessions/[id]/mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 200 and current mode with deterministic schema (DISCUSS)', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        status: 'active',
        conversation_mode: 'DISCUSS',
        messages: [],
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      headers: {
        'x-request-id': 'test-req-get-mode-1',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-get-mode-1');
    expect(body.version).toBe(CONVERSATION_MODE_VERSION);
    expect(body.mode).toBe('DISCUSS');
    expect(body.updatedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(getIntentSession).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID
    );
  });

  test('returns 200 for DRAFTING mode', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T01:00:00.000Z',
        status: 'active',
        conversation_mode: 'DRAFTING',
        messages: [],
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      headers: {
        'x-request-id': 'test-req-get-mode-drafting',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('DRAFTING');
    expect(body.updatedAt).toBe('2025-01-01T01:00:00.000Z');
  });

  test('returns 200 for ACT mode', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T02:00:00.000Z',
        status: 'active',
        conversation_mode: 'ACT',
        messages: [],
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      headers: {
        'x-request-id': 'test-req-get-mode-act',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('ACT');
    expect(body.updatedAt).toBe('2025-01-01T02:00:00.000Z');
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      headers: {
        'x-request-id': 'test-req-get-mode-unauth',
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  test('returns 404 when session not found', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/nonexistent/mode', {
      headers: {
        'x-request-id': 'test-req-get-mode-not-found',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: 'nonexistent' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  test('returns 400 when session ID is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions//mode', {
      headers: {
        'x-request-id': 'test-req-get-mode-no-id',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: '' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session ID required');
  });

  test('user cannot access another user\'s session mode', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      headers: {
        'x-request-id': 'test-req-get-mode-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
      },
    });

    const response = await getMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(getIntentSession).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID_2
    );
  });
});

describe('PUT /api/intent/sessions/[id]/mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates mode to DRAFTING and returns deterministic schema', async () => {
    const { updateSessionMode } = require('../../src/lib/db/intentSessions');

    updateSessionMode.mockResolvedValue({
      success: true,
      data: {
        mode: 'DRAFTING',
        updated_at: '2025-01-01T02:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-1',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'DRAFTING' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-update-mode-1');
    expect(body.version).toBe(CONVERSATION_MODE_VERSION);
    expect(body.mode).toBe('DRAFTING');
    expect(body.updatedAt).toBe('2025-01-01T02:00:00.000Z');
    expect(updateSessionMode).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID,
      'DRAFTING'
    );
  });

  test('updates mode to DISCUSS and returns deterministic schema', async () => {
    const { updateSessionMode } = require('../../src/lib/db/intentSessions');

    updateSessionMode.mockResolvedValue({
      success: true,
      data: {
        mode: 'DISCUSS',
        updated_at: '2025-01-01T03:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-discuss',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'DISCUSS' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-update-mode-discuss');
    expect(body.version).toBe(CONVERSATION_MODE_VERSION);
    expect(body.mode).toBe('DISCUSS');
    expect(body.updatedAt).toBe('2025-01-01T03:00:00.000Z');
    expect(updateSessionMode).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID,
      'DISCUSS'
    );
  });

  test('updates mode to ACT and returns deterministic schema', async () => {
    const { updateSessionMode } = require('../../src/lib/db/intentSessions');

    updateSessionMode.mockResolvedValue({
      success: true,
      data: {
        mode: 'ACT',
        updated_at: '2025-01-01T04:00:00.000Z',
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-act',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'ACT' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-update-mode-act');
    expect(body.version).toBe(CONVERSATION_MODE_VERSION);
    expect(body.mode).toBe('ACT');
    expect(body.updatedAt).toBe('2025-01-01T04:00:00.000Z');
    expect(updateSessionMode).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID,
      'ACT'
    );
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-unauth',
      },
      body: JSON.stringify({ mode: 'DISCUSS' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  test('returns 400 when mode is invalid', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-invalid',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'INVALID_MODE' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  test('returns 400 when mode is missing', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-missing',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({}),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  test('returns 400 when JSON is invalid', async () => {
    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-bad-json',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: 'invalid json{',
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON');
  });

  test('returns 404 when session not found', async () => {
    const { updateSessionMode } = require('../../src/lib/db/intentSessions');

    updateSessionMode.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/nonexistent/mode', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-not-found',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'DISCUSS' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: 'nonexistent' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  test('user cannot update another user\'s session mode', async () => {
    const { updateSessionMode } = require('../../src/lib/db/intentSessions');

    updateSessionMode.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/mode`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
      },
      body: JSON.stringify({ mode: 'DRAFTING' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: TEST_SESSION_ID }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(updateSessionMode).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID_2,
      'DRAFTING'
    );
  });

  test('returns 400 when session ID is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions//mode', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-update-mode-no-id',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ mode: 'DISCUSS' }),
    });

    const response = await updateMode(request, { params: Promise.resolve({ id: '' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session ID required');
  });
});
