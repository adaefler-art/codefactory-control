/**
 * Tests for used_sources in INTENT Sessions API
 * 
 * Tests Zod validation, canonicalization, and persistence.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as appendMessage } from '../../app/api/intent/sessions/[id]/messages/route';
import { GET as getSession } from '../../app/api/intent/sessions/[id]/route';
import type { UsedSources } from '../../src/lib/schemas/usedSources';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/intentSessions', () => ({
  appendIntentMessage: jest.fn(),
  getIntentSession: jest.fn(),
}));

const TEST_USER_ID = 'user-123';
const TEST_SESSION_ID = 'session-456';

describe('POST /api/intent/sessions/[id]/messages - used_sources', () => {
  test('accepts valid used_sources and stores with assistant message', async () => {
    const { appendIntentMessage } = require('../../src/lib/db/intentSessions');

    const validSources: UsedSources = [
      {
        kind: 'file_snippet',
        repo: { owner: 'test', repo: 'repo' },
        branch: 'main',
        path: 'file.ts',
        startLine: 1,
        endLine: 10,
        snippetHash: 'abc123',
      },
      {
        kind: 'github_issue',
        repo: { owner: 'test', repo: 'repo' },
        number: 42,
        title: 'Test Issue',
      },
    ];

    // Mock user message append
    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-user-1',
        session_id: TEST_SESSION_ID,
        role: 'user',
        content: 'Test message',
        created_at: new Date().toISOString(),
        seq: 1,
        used_sources: null,
        used_sources_hash: null,
      },
    });

    // Mock assistant message append with used_sources
    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-assistant-1',
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        content: '[Stub] Response',
        created_at: new Date().toISOString(),
        seq: 2,
        used_sources: validSources,
        used_sources_hash: 'abc123hash',
      },
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-sources-1',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({
        content: 'Test message',
        used_sources: validSources,
      }),
    });

    const response = await appendMessage(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.assistantMessage.used_sources).toBeDefined();
    expect(body.assistantMessage.used_sources).toHaveLength(2);
    expect(body.assistantMessage.used_sources_hash).toBe('abc123hash');
    
    // Verify appendIntentMessage was called with used_sources
    expect(appendIntentMessage).toHaveBeenLastCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID,
      'assistant',
      expect.any(String),
      validSources
    );
  });

  test('rejects invalid used_sources schema', async () => {
    const invalidSources = [
      {
        kind: 'file_snippet',
        // Missing required fields
        path: 'file.ts',
      },
    ];

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-invalid-sources',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({
        content: 'Test message',
        used_sources: invalidSources,
      }),
    });

    const response = await appendMessage(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid used_sources');
  });

  test('accepts empty used_sources array', async () => {
    const { appendIntentMessage } = require('../../src/lib/db/intentSessions');

    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-user-2',
        session_id: TEST_SESSION_ID,
        role: 'user',
        content: 'Test',
        created_at: new Date().toISOString(),
        seq: 3,
      },
    });

    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-assistant-2',
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        content: '[Stub] Response',
        created_at: new Date().toISOString(),
        seq: 4,
        used_sources: null,
        used_sources_hash: null,
      },
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-empty-sources',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({
        content: 'Test',
        used_sources: [],
      }),
    });

    const response = await appendMessage(request, { params: { id: TEST_SESSION_ID } });

    expect(response.status).toBe(201);
  });

  test('validates all source types', async () => {
    const { appendIntentMessage } = require('../../src/lib/db/intentSessions');

    const allSourceTypes: UsedSources = [
      {
        kind: 'file_snippet',
        repo: { owner: 'org', repo: 'repo' },
        branch: 'main',
        path: 'file.ts',
        startLine: 1,
        endLine: 10,
        snippetHash: 'abc',
      },
      {
        kind: 'github_issue',
        repo: { owner: 'org', repo: 'repo' },
        number: 1,
      },
      {
        kind: 'github_pr',
        repo: { owner: 'org', repo: 'repo' },
        number: 2,
      },
      {
        kind: 'afu9_artifact',
        artifactType: 'verdict',
        artifactId: 'v-123',
      },
    ];

    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-user-3',
        session_id: TEST_SESSION_ID,
        role: 'user',
        content: 'Test',
        created_at: new Date().toISOString(),
        seq: 5,
      },
    });

    appendIntentMessage.mockResolvedValueOnce({
      success: true,
      data: {
        id: 'msg-assistant-3',
        session_id: TEST_SESSION_ID,
        role: 'assistant',
        content: '[Stub] Response',
        created_at: new Date().toISOString(),
        seq: 6,
        used_sources: allSourceTypes,
      },
    });

    const request = new NextRequest('http://localhost/api/intent/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'test-req-all-types',
        'x-afu9-sub': TEST_USER_ID,
      },
      body: JSON.stringify({
        content: 'Test',
        used_sources: allSourceTypes,
      }),
    });

    const response = await appendMessage(request, { params: { id: TEST_SESSION_ID } });

    expect(response.status).toBe(201);
  });
});

describe('GET /api/intent/sessions/[id] - used_sources', () => {
  test('returns used_sources with messages', async () => {
    const { getIntentSession } = require('../../src/lib/db/intentSessions');

    const mockSources: UsedSources = [
      {
        kind: 'github_issue',
        repo: { owner: 'test', repo: 'repo' },
        number: 1,
      },
    ];

    getIntentSession.mockResolvedValue({
      success: true,
      data: {
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'active',
        messages: [
          {
            id: 'msg-1',
            session_id: TEST_SESSION_ID,
            role: 'user',
            content: 'Hello',
            created_at: new Date().toISOString(),
            seq: 1,
            used_sources: null,
            used_sources_hash: null,
          },
          {
            id: 'msg-2',
            session_id: TEST_SESSION_ID,
            role: 'assistant',
            content: 'Hi',
            created_at: new Date().toISOString(),
            seq: 2,
            used_sources: mockSources,
            used_sources_hash: 'hash123',
          },
        ],
      },
    });

    const request = new NextRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}`, {
      headers: {
        'x-request-id': 'test-req-get-sources',
        'x-afu9-sub': TEST_USER_ID,
      },
    });

    const response = await getSession(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].used_sources).toBeNull();
    expect(body.messages[1].used_sources).toBeDefined();
    expect(body.messages[1].used_sources).toHaveLength(1);
    expect(body.messages[1].used_sources_hash).toBe('hash123');
  });
});
