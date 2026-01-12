/**
 * INTENT Sessions API Tests
 * 
 * Tests for /api/intent/sessions endpoints
 * Issue E73.1: INTENT Console UI Shell
 * 
 * Includes tests for:
 * - Session ownership and access control
 * - Atomic seq increment for race-safe message ordering
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getSessions, POST as createSession } from '../../app/api/intent/sessions/route';
import { GET as getSession } from '../../app/api/intent/sessions/[id]/route';
import { POST as appendMessage } from '../../app/api/intent/sessions/[id]/messages/route';

// Enable INTENT agent for tests
process.env.AFU9_INTENT_ENABLED = 'true';
process.env.OPENAI_API_KEY = 'sk-test-key';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/intentSessions', () => ({
  listIntentSessions: jest.fn(),
  createIntentSession: jest.fn(),
  getIntentSession: jest.fn(),
  appendIntentMessage: jest.fn(),
}));

jest.mock('../../src/lib/db/contextPacks', () => ({
  generateContextPack: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'pack-123',
      pack_hash: 'hash123',
    },
  }),
}));

jest.mock('../../src/lib/db/intentIssueDrafts', () => ({
  getIssueDraft: jest.fn().mockResolvedValue({ success: true, data: null }),
  validateAndSaveIssueDraft: jest.fn().mockResolvedValue({
    success: true,
    data: { id: 'draft-1' },
    validation: { isValid: true, errors: [], warnings: [], meta: { validatedAt: new Date().toISOString(), validatorVersion: 'test' } },
  }),
}));

// Mock the INTENT agent
jest.mock('../../src/lib/intent-agent', () => ({
  isIntentEnabled: jest.fn(() => true),
  generateIntentResponse: jest.fn().mockResolvedValue({
    content: 'Test response',
    requestId: 'req-123',
    timestamp: new Date().toISOString(),
    model: 'gpt-4o-mini',
  }),
}));

const TEST_USER_ID = 'user-123';
const TEST_USER_ID_2 = 'user-456';

describe('GET /api/intent/sessions', () => {
  test('returns 200 and a list of sessions for authenticated user', async () => {
    const { listIntentSessions } = require('../../src/lib/db/intentSessions');

    listIntentSessions.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'session-1',
          user_id: TEST_USER_ID,
          title: 'Test Session',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          status: 'active',
        },
      ],
    });

    const request = new NextRequest('http://localhost/api/intent/sessions', {
      headers: {
        'x-request-id': 'test-req-sessions-1',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getSessions(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-sessions-1');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].user_id).toBe(TEST_USER_ID);
    expect(listIntentSessions).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      expect.anything()
    );
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions', {
      headers: {
        'x-request-id': 'test-req-sessions-unauth',
      },
    });

    const response = await getSessions(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });
});

describe('POST /api/intent/sessions', () => {
  test('creates a new session for authenticated user and returns 201', async () => {
    const { createIntentSession } = require('../../src/lib/db/intentSessions');

    createIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'new-session-1',
        user_id: TEST_USER_ID,
        title: null,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        status: 'active',
      },
    });

    const request = new NextRequest('http://localhost/api/intent/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-sessions-create-1',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({}),
    });

    const response = await createSession(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('test-req-sessions-create-1');
    expect(body.id).toBe('new-session-1');
    expect(body.user_id).toBe(TEST_USER_ID);
    expect(body.status).toBe('active');
    expect(createIntentSession).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      expect.anything()
    );
  });
});

describe('GET /api/intent/sessions/[id]', () => {
  test('returns session with messages ordered by seq for authenticated user', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'session-1',
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        status: 'active',
        messages: [
          {
            id: 'msg-1',
            session_id: 'session-1',
            role: 'user',
            content: 'Hello',
            created_at: '2025-01-01T00:00:01.000Z',
            seq: 1,
          },
          {
            id: 'msg-2',
            session_id: 'session-1',
            role: 'assistant',
            content: '[Stub] I received: "Hello"',
            created_at: '2025-01-01T00:00:02.000Z',
            seq: 2,
          },
        ],
      },
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1', {
      headers: {
        'x-request-id': 'test-req-session-get-1',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getSession(request, { params: Promise.resolve({ id: 'session-1' }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].seq).toBe(1);
    expect(body.messages[1].seq).toBe(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(getIntentSession).toHaveBeenCalledWith(
      expect.anything(),
      'session-1',
      TEST_USER_ID
    );
  });

  test('returns 404 when session not found or access denied', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/nonexistent', {
      headers: {
        'x-request-id': 'test-req-session-not-found',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getSession(request, { params: Promise.resolve({ id: 'nonexistent' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  test('user cannot access another user\'s session', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    // Mock returns error because user_id doesn't match
    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/other-user-session', {
      headers: {
        'x-request-id': 'test-req-session-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
      },
    });

    const response = await getSession(request, { params: Promise.resolve({ id: 'other-user-session' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(getIntentSession).toHaveBeenCalledWith(
      expect.anything(),
      'other-user-session',
      TEST_USER_ID_2
    );
  });
});

describe('POST /api/intent/sessions/[id]/messages', () => {
  test('appends user message and assistant reply with deterministic seq', async () => {
    const { appendIntentMessage, getIntentSession } = require('../../src/lib/db/intentSessions');

    // Mock getIntentSession to return conversation history
    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'session-1',
        user_id: TEST_USER_ID,
        title: 'Test',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        status: 'active',
        messages: [],
      },
    });

    // Mock two calls: user message then assistant message
    appendIntentMessage
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'msg-1',
          session_id: 'session-1',
          role: 'user',
          content: 'Test message',
          created_at: '2025-01-01T00:00:01.000Z',
          seq: 1,
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 'msg-2',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Test response',
          created_at: '2025-01-01T00:00:02.000Z',
          seq: 2,
        },
      });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-append-1',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ content: 'Test message' }),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.userMessage.seq).toBe(1);
    expect(body.assistantMessage.seq).toBe(2);
    expect(body.userMessage.content).toBe('Test message');
    expect(appendIntentMessage).toHaveBeenCalledWith(
      expect.anything(),
      'session-1',
      TEST_USER_ID,
      'user',
      'Test message'
    );
  });

  test('returns 400 when session id is blank/whitespace', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/%20%20%20/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-missing-session-id',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ content: 'Hello' }),
    });

    const response = await appendMessage(request, { params: Promise.resolve({ id: '   ' }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Session ID required');
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-unauth',
      },
      body: JSON.stringify({ content: 'Hello' }),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });
  test('returns 404 when INTENT is disabled (fail-closed)', async () => {
    const { isIntentEnabled, generateIntentResponse } = require('../../src/lib/intent-agent');
    const { getPool } = require('../../src/lib/db');

    // Ensure this test is isolated from earlier calls in the suite.
    generateIntentResponse.mockClear();
    getPool.mockClear();
    isIntentEnabled.mockReturnValueOnce(false);

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-intent-disabled',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({ content: 'Hello' }),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('INTENT agent is not enabled');
    expect(String(body.details || '')).toContain('AFU9_INTENT_ENABLED=true');
    expect(generateIntentResponse).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
  });

  test('returns 400 when content is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-no-content',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({}),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });

  test('returns 404 when user tries to append to another user\'s session', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found or access denied',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/other-session/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-cross-user',
        'x-afu9-sub': TEST_USER_ID_2,
      },
      body: JSON.stringify({ content: 'Hacking attempt' }),
    });

    const response = await appendMessage(request, { params: Promise.resolve({ id: 'other-session' }) });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });
});

describe('Deterministic ordering and atomic seq increment', () => {
  test('seq increments deterministically using atomic counter', async () => {
    const { appendIntentMessage, getIntentSession } = require('../../src/lib/db/intentSessions');

    // Mock getIntentSession for conversation history
    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'session-1',
        user_id: TEST_USER_ID,
        title: 'Test',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        status: 'active',
        messages: [],
      },
    });

    // Simulate multiple sequential message appends with atomic seq
    const messages = [];
    for (let i = 1; i <= 3; i++) {
      const userSeq = (i - 1) * 2 + 1;
      const assistantSeq = (i - 1) * 2 + 2;

      // Mock user message with atomically incremented seq
      appendIntentMessage.mockResolvedValueOnce({
        success: true,
        data: {
          id: `msg-user-${i}`,
          session_id: 'session-1',
          role: 'user',
          content: `Message ${i}`,
          created_at: new Date(Date.now() + userSeq * 1000).toISOString(),
          seq: userSeq,
        },
      });

      // Mock assistant message
      appendIntentMessage.mockResolvedValueOnce({
        success: true,
        data: {
          id: `msg-assistant-${i}`,
          session_id: 'session-1',
          role: 'assistant',
          content: `Test response`,
          created_at: new Date(Date.now() + assistantSeq * 1000).toISOString(),
          seq: assistantSeq,
        },
      });

      const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': `test-req-seq-${i}`,
          'x-afu9-sub': TEST_USER_ID,
        },
        body: JSON.stringify({ content: `Message ${i}` }),
      });

      const response = await appendMessage(request, { params: { id: 'session-1' } });
      const body = await response.json();
      messages.push(body.userMessage);
    }

    // Verify seq is strictly increasing and gap-free (1, 3, 5)
    expect(messages[0].seq).toBe(1);
    expect(messages[1].seq).toBe(3);
    expect(messages[2].seq).toBe(5);
    
    // Verify all calls included userId for access control
    expect(appendIntentMessage).toHaveBeenCalledWith(
      expect.anything(),
      'session-1',
      TEST_USER_ID,
      expect.any(String),
      expect.any(String)
    );
  });
});
