/**
 * INTENT Sessions API Tests
 * 
 * Tests for /api/intent/sessions endpoints
 * Issue E73.1: INTENT Console UI Shell
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getSessions, POST as createSession } from '../../app/api/intent/sessions/route';
import { GET as getSession } from '../../app/api/intent/sessions/[id]/route';
import { POST as appendMessage } from '../../app/api/intent/sessions/[id]/messages/route';

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

describe('GET /api/intent/sessions', () => {
  test('returns 200 and a list of sessions', async () => {
    const { listIntentSessions } = require('../../src/lib/db/intentSessions');

    listIntentSessions.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'session-1',
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
      },
    });

    const response = await getSessions(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('test-req-sessions-1');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toEqual({
      id: 'session-1',
      title: 'Test Session',
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
      status: 'active',
    });
  });
});

describe('POST /api/intent/sessions', () => {
  test('creates a new session and returns 201', async () => {
    const { createIntentSession } = require('../../src/lib/db/intentSessions');

    createIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'new-session-1',
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
      },
      body: JSON.stringify({}),
    });

    const response = await createSession(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('test-req-sessions-create-1');
    expect(body.id).toBe('new-session-1');
    expect(body.status).toBe('active');
  });
});

describe('GET /api/intent/sessions/[id]', () => {
  test('returns session with messages ordered by seq', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: 'session-1',
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
      },
    });

    const response = await getSession(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].seq).toBe(1);
    expect(body.messages[1].seq).toBe(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
  });

  test('returns 404 when session not found', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    getIntentSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/nonexistent', {
      headers: {
        'x-request-id': 'test-req-session-not-found',
      },
    });

    const response = await getSession(request, { params: { id: 'nonexistent' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });
});

describe('POST /api/intent/sessions/[id]/messages', () => {
  test('appends user message and assistant reply with deterministic seq', async () => {
    const { appendIntentMessage } = require('../../src/lib/db/intentSessions');

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
          content: '[Stub] I received: "Test message"',
          created_at: '2025-01-01T00:00:02.000Z',
          seq: 2,
        },
      });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-append-1',
      },
      body: JSON.stringify({ content: 'Test message' }),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.userMessage.seq).toBe(1);
    expect(body.assistantMessage.seq).toBe(2);
    expect(body.userMessage.content).toBe('Test message');
    expect(body.assistantMessage.content).toContain('[Stub]');
    expect(body.assistantMessage.content).toContain('Test message');
  });

  test('returns 400 when content is missing', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-message-no-content',
      },
      body: JSON.stringify({}),
    });

    const response = await appendMessage(request, { params: { id: 'session-1' } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid input');
  });
});

describe('Deterministic ordering test', () => {
  test('seq increments deterministically', async () => {
    const { appendIntentMessage } = require('../../src/lib/db/intentSessions');

    // Simulate multiple sequential message appends
    const messages = [];
    for (let i = 1; i <= 5; i++) {
      appendIntentMessage.mockResolvedValueOnce({
        success: true,
        data: {
          id: `msg-${i}`,
          session_id: 'session-1',
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Message ${i}`,
          created_at: new Date(Date.now() + i * 1000).toISOString(),
          seq: i,
        },
      });

      const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': `test-req-seq-${i}`,
        },
        body: JSON.stringify({ content: `Message ${i}` }),
      });

      const response = await appendMessage(request, { params: { id: 'session-1' } });
      const body = await response.json();
      messages.push(body.userMessage);
    }

    // Verify seq is strictly increasing
    for (let i = 0; i < messages.length - 1; i++) {
      expect(messages[i + 1].seq).toBe(messages[i].seq + 2); // +2 because assistant message is inserted between
    }
  });
});
