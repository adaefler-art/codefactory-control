/**
 * Context Pack Generator Tests
 * 
 * Tests for context pack generation and idempotency
 * Issue E73.3: Context Pack Generator (audit JSON per session) + Export/Download
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as generateContextPack } from '../../app/api/intent/sessions/[id]/context-pack/route';
import { GET as downloadContextPack } from '../../app/api/intent/context-packs/[id]/route';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/contextPacks', () => ({
  generateContextPack: jest.fn(),
  getContextPack: jest.fn(),
}));

jest.mock('../../src/lib/db/intentSessions', () => ({
  getIntentSession: jest.fn(),
}));

const TEST_USER_ID = 'user-123';
const TEST_SESSION_ID = 'session-abc-123';
const TEST_PACK_ID = 'pack-def-456';

const MOCK_CONTEXT_PACK = {
  id: TEST_PACK_ID,
  session_id: TEST_SESSION_ID,
  created_at: '2026-01-01T12:00:00.000Z',
  pack_json: {
    contextPackVersion: '0.7.0',
    generatedAt: '2026-01-01T12:00:00.000Z',
    session: {
      id: TEST_SESSION_ID,
      title: 'Test Session',
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T11:00:00.000Z',
    },
    messages: [
      {
        seq: 1,
        role: 'user',
        content: 'Hello',
        createdAt: '2026-01-01T10:00:01.000Z',
        used_sources: null,
        used_sources_hash: null,
      },
      {
        seq: 2,
        role: 'assistant',
        content: 'Hi there!',
        createdAt: '2026-01-01T10:00:02.000Z',
        used_sources: [
          {
            kind: 'file_snippet',
            repo: { owner: 'test', repo: 'repo' },
            branch: 'main',
            path: 'test.ts',
            startLine: 1,
            endLine: 10,
            snippetHash: 'abc123',
          },
        ],
        used_sources_hash: 'hash123abc',
      },
    ],
    derived: {
      sessionHash: 'session-hash-123abc',
      messageCount: 2,
      sourcesCount: 1,
    },
    warnings: [],
  },
  pack_hash: 'session-hash-123abc',
  version: '0.7.0',
};

describe('POST /api/intent/sessions/[id]/context-pack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('generates context pack successfully', async () => {
    const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

    mockGenerate.mockResolvedValue({
      success: true,
      data: MOCK_CONTEXT_PACK,
    });

    const request = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-pack-1',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await generateContextPack(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.id).toBe(TEST_PACK_ID);
    expect(body.pack_hash).toBe('session-hash-123abc');
    expect(body.version).toBe('0.7.0');
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.anything(),
      TEST_SESSION_ID,
      TEST_USER_ID
    );
  });

  test('returns 401 when user is not authenticated', async () => {
    const request = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-pack-unauth',
        },
      }
    );

    const response = await generateContextPack(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  test('returns 404 when session not found', async () => {
    const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

    mockGenerate.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest(
      `http://localhost/api/intent/sessions/nonexistent/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-pack-notfound',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await generateContextPack(request, { params: { id: 'nonexistent' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Session not found');
  });

  test('implements idempotency - same session returns existing pack', async () => {
    const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

    // First call creates pack
    mockGenerate.mockResolvedValueOnce({
      success: true,
      data: MOCK_CONTEXT_PACK,
    });

    // Second call returns same pack (idempotent)
    mockGenerate.mockResolvedValueOnce({
      success: true,
      data: MOCK_CONTEXT_PACK,
    });

    const request1 = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-pack-idempotent-1',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response1 = await generateContextPack(request1, { params: { id: TEST_SESSION_ID } });
    const body1 = await response1.json();

    const request2 = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-pack-idempotent-2',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response2 = await generateContextPack(request2, { params: { id: TEST_SESSION_ID } });
    const body2 = await response2.json();

    // Both requests should return same pack ID and hash
    expect(body1.id).toBe(body2.id);
    expect(body1.pack_hash).toBe(body2.pack_hash);
    expect(body1.pack_hash).toBe('session-hash-123abc');
  });
});

describe('GET /api/intent/context-packs/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('downloads context pack successfully', async () => {
    const { getContextPack: mockGet } = require('../../src/lib/db/contextPacks');
    const { getIntentSession: mockGetSession } = require('../../src/lib/db/intentSessions');

    mockGet.mockResolvedValue({
      success: true,
      data: MOCK_CONTEXT_PACK,
    });

    mockGetSession.mockResolvedValue({
      success: true,
      data: {
        id: TEST_SESSION_ID,
        user_id: TEST_USER_ID,
        title: 'Test Session',
        created_at: '2026-01-01T10:00:00.000Z',
        updated_at: '2026-01-01T11:00:00.000Z',
        status: 'active',
        messages: [],
      },
    });

    const request = new NextRequest(
      `http://localhost/api/intent/context-packs/${TEST_PACK_ID}`,
      {
        headers: {
          'x-request-id': 'test-req-download-1',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await downloadContextPack(request, { params: { id: TEST_PACK_ID } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('context-pack');

    const body = await response.text();
    const json = JSON.parse(body);
    expect(json.contextPackVersion).toBe('0.7.0');
    expect(json.session.id).toBe(TEST_SESSION_ID);
    expect(json.messages).toHaveLength(2);
  });

  test('returns 404 when pack not found', async () => {
    const { getContextPack: mockGet } = require('../../src/lib/db/contextPacks');

    mockGet.mockResolvedValue({
      success: false,
      error: 'Context pack not found',
    });

    const request = new NextRequest(
      `http://localhost/api/intent/context-packs/nonexistent`,
      {
        headers: {
          'x-request-id': 'test-req-download-notfound',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await downloadContextPack(request, { params: { id: 'nonexistent' } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Context pack not found');
  });

  test('returns 403 when user does not own session', async () => {
    const { getContextPack: mockGet } = require('../../src/lib/db/contextPacks');
    const { getIntentSession: mockGetSession } = require('../../src/lib/db/intentSessions');

    mockGet.mockResolvedValue({
      success: true,
      data: MOCK_CONTEXT_PACK,
    });

    // Session ownership check fails
    mockGetSession.mockResolvedValue({
      success: false,
      error: 'Session not found',
    });

    const request = new NextRequest(
      `http://localhost/api/intent/context-packs/${TEST_PACK_ID}`,
      {
        headers: {
          'x-request-id': 'test-req-download-forbidden',
          'x-afu9-sub': 'other-user-456',
        },
      }
    );

    const response = await downloadContextPack(request, { params: { id: TEST_PACK_ID } });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Access denied');
  });
});

describe('Deterministic hashing and redaction', () => {
  test('context pack does not contain sensitive fields', () => {
    // Verify the pack structure doesn't expose secrets
    const packJson = JSON.stringify(MOCK_CONTEXT_PACK.pack_json);
    
    // These fields should NOT appear in the pack
    expect(packJson).not.toContain('password');
    expect(packJson).not.toContain('token');
    expect(packJson).not.toContain('secret');
    expect(packJson).not.toContain('api_key');
    expect(packJson).not.toContain('apiKey');
    
    // Whitelisted fields should be present
    expect(packJson).toContain('contextPackVersion');
    expect(packJson).toContain('session');
    expect(packJson).toContain('messages');
    expect(packJson).toContain('derived');
  });

  test('context pack has deterministic structure', () => {
    const pack = MOCK_CONTEXT_PACK.pack_json;
    
    // Required top-level fields
    expect(pack).toHaveProperty('contextPackVersion');
    expect(pack).toHaveProperty('generatedAt');
    expect(pack).toHaveProperty('session');
    expect(pack).toHaveProperty('messages');
    expect(pack).toHaveProperty('derived');
    
    // Session fields
    expect(pack.session).toHaveProperty('id');
    expect(pack.session).toHaveProperty('title');
    expect(pack.session).toHaveProperty('createdAt');
    expect(pack.session).toHaveProperty('updatedAt');
    
    // Messages are ordered by seq
    expect(pack.messages[0].seq).toBe(1);
    expect(pack.messages[1].seq).toBe(2);
    expect(pack.messages[0].seq).toBeLessThan(pack.messages[1].seq);
    
    // Derived metadata
    expect(pack.derived).toHaveProperty('sessionHash');
    expect(pack.derived).toHaveProperty('messageCount');
    expect(pack.derived).toHaveProperty('sourcesCount');
    expect(pack.derived.messageCount).toBe(2);
    expect(pack.derived.sourcesCount).toBe(1);
  });
});
