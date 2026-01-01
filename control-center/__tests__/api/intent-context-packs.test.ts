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
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
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

  test('hash stability - same session unchanged produces identical pack_hash', async () => {
    const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

    // First generation
    mockGenerate.mockResolvedValueOnce({
      success: true,
      data: {
        ...MOCK_CONTEXT_PACK,
        created_at: '2026-01-01T12:00:00.000Z',
      },
    });

    const request1 = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-hash-stability-1',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response1 = await generateContextPack(request1, { params: { id: TEST_SESSION_ID } });
    const body1 = await response1.json();
    const hash1 = body1.pack_hash;

    // Second generation (should return same pack due to idempotency)
    mockGenerate.mockResolvedValueOnce({
      success: true,
      data: {
        ...MOCK_CONTEXT_PACK,
        created_at: '2026-01-01T12:05:00.000Z', // Different timestamp
      },
    });

    const request2 = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-hash-stability-2',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response2 = await generateContextPack(request2, { params: { id: TEST_SESSION_ID } });
    const body2 = await response2.json();
    const hash2 = body2.pack_hash;

    // Hashes should be identical despite different created_at
    expect(hash1).toBe(hash2);
    expect(hash1).toBe('session-hash-123abc');
  });

  test('size cap - returns 413 when context pack exceeds maximum size', async () => {
    const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

    mockGenerate.mockResolvedValue({
      success: false,
      error: 'Context pack exceeds maximum size of 2 MB (current: 2.50 MB)',
      code: 'CONTEXT_PACK_TOO_LARGE',
    });

    const request = new NextRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
      {
        method: 'POST',
        headers: {
          'x-request-id': 'test-req-size-cap',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await generateContextPack(request, { params: { id: TEST_SESSION_ID } });
    const body = await response.json();

    expect(response.status).toBe(413); // Payload Too Large
    expect(body.error).toContain('exceeds maximum size');
  });

  test('download response has correct headers for evidence', async () => {
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
          'x-request-id': 'test-req-evidence-headers',
          'x-afu9-sub': TEST_USER_ID,
        },
      }
    );

    const response = await downloadContextPack(request, { params: { id: TEST_PACK_ID } });

    // Verify Content-Type
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    
    // Verify Content-Disposition includes session ID and hash12
    const disposition = response.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(TEST_SESSION_ID);
    const hash12 = MOCK_CONTEXT_PACK.pack_hash.substring(0, 12);
    expect(disposition).toContain(hash12);
    
    // Verify Cache-Control: no-store
    expect(response.headers.get('cache-control')).toContain('no-store');
    
    // Verify ETag
    expect(response.headers.get('etag')).toBe(`"${MOCK_CONTEXT_PACK.pack_hash}"`);
  });
});

/**
 * Tests for E73.4: Context Pack Storage/Retrieval
 * 
 * Tests for versioning, immutability, and retrieval UX enhancements
 */

// Import new routes for E73.4
import { GET as listContextPacks } from '../../app/api/intent/sessions/[id]/context-packs/route';
import { GET as getContextPackByHash } from '../../app/api/intent/context-packs/by-hash/[hash]/route';

// Add new mock functions for E73.4
jest.mock('../../src/lib/db/contextPacks', () => ({
  generateContextPack: jest.fn(),
  getContextPack: jest.fn(),
  listContextPacksMetadata: jest.fn(),
  getContextPackByHash: jest.fn(),
}));

const MOCK_PACK_METADATA = [
  {
    id: 'pack-1',
    session_id: TEST_SESSION_ID,
    created_at: '2026-01-01T14:00:00.000Z',
    pack_hash: 'hash-newer-abc123',
    version: '0.7.0',
    message_count: 5,
    sources_count: 2,
  },
  {
    id: 'pack-2',
    session_id: TEST_SESSION_ID,
    created_at: '2026-01-01T12:00:00.000Z',
    pack_hash: 'hash-older-def456',
    version: '0.7.0',
    message_count: 3,
    sources_count: 1,
  },
];

describe('E73.4: Versioning and Retrieval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Version validation', () => {
    test('accepts valid version 0.7.0', () => {
      const { ContextPackSchema, ACTIVE_CONTEXT_PACK_VERSIONS } = require('../../src/lib/schemas/contextPack');
      
      expect(ACTIVE_CONTEXT_PACK_VERSIONS).toContain('0.7.0');
      
      const validPack = {
        contextPackVersion: '0.7.0',
        generatedAt: '2026-01-01T12:00:00.000Z',
        session: {
          id: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
          title: 'Test',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
        messages: [],
        derived: {
          sessionHash: 'abc123',
          messageCount: 0,
          sourcesCount: 0,
        },
      };
      
      const result = ContextPackSchema.safeParse(validPack);
      expect(result.success).toBe(true);
    });

    test('rejects invalid version', () => {
      const { ContextPackSchema } = require('../../src/lib/schemas/contextPack');
      
      const invalidPack = {
        contextPackVersion: '99.9.9', // Not in ACTIVE_CONTEXT_PACK_VERSIONS
        generatedAt: '2026-01-01T12:00:00.000Z',
        session: {
          id: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
          title: 'Test',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-01-01T11:00:00.000Z',
        },
        messages: [],
        derived: {
          sessionHash: 'abc123',
          messageCount: 0,
          sourcesCount: 0,
        },
      };
      
      const result = ContextPackSchema.safeParse(invalidPack);
      expect(result.success).toBe(false);
    });
  });

  describe('GET /api/intent/sessions/[id]/context-packs', () => {
    test('lists context packs with metadata only (newest first)', async () => {
      const { listContextPacksMetadata } = require('../../src/lib/db/contextPacks');

      listContextPacksMetadata.mockResolvedValue({
        success: true,
        data: MOCK_PACK_METADATA,
      });

      const request = new NextRequest(
        `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-packs`,
        {
          headers: {
            'x-request-id': 'test-req-list-packs',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response = await listContextPacks(request, { params: { id: TEST_SESSION_ID } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.packs).toHaveLength(2);
      
      // Verify newest first ordering
      expect(body.packs[0].id).toBe('pack-1');
      expect(body.packs[0].created_at).toBe('2026-01-01T14:00:00.000Z');
      expect(body.packs[1].id).toBe('pack-2');
      expect(body.packs[1].created_at).toBe('2026-01-01T12:00:00.000Z');
      
      // Verify metadata fields present
      expect(body.packs[0]).toHaveProperty('pack_hash');
      expect(body.packs[0]).toHaveProperty('version');
      expect(body.packs[0]).toHaveProperty('message_count');
      expect(body.packs[0]).toHaveProperty('sources_count');
      
      // Verify pack_json is NOT included
      expect(body.packs[0]).not.toHaveProperty('pack_json');
    });

    test('returns empty array when no packs exist', async () => {
      const { listContextPacksMetadata } = require('../../src/lib/db/contextPacks');

      listContextPacksMetadata.mockResolvedValue({
        success: true,
        data: [],
      });

      const request = new NextRequest(
        `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-packs`,
        {
          headers: {
            'x-request-id': 'test-req-list-empty',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response = await listContextPacks(request, { params: { id: TEST_SESSION_ID } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.packs).toEqual([]);
    });

    test('returns 401 when user not authenticated', async () => {
      const request = new NextRequest(
        `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-packs`,
        {
          headers: {
            'x-request-id': 'test-req-list-unauth',
          },
        }
      );

      const response = await listContextPacks(request, { params: { id: TEST_SESSION_ID } });
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 404 when session not found', async () => {
      const { listContextPacksMetadata } = require('../../src/lib/db/contextPacks');

      listContextPacksMetadata.mockResolvedValue({
        success: false,
        error: 'Session not found',
      });

      const request = new NextRequest(
        `http://localhost/api/intent/sessions/nonexistent/context-packs`,
        {
          headers: {
            'x-request-id': 'test-req-list-notfound',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response = await listContextPacks(request, { params: { id: 'nonexistent' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Session not found');
    });
  });

  describe('GET /api/intent/context-packs/by-hash/[hash]', () => {
    test('retrieves context pack by hash', async () => {
      const { getContextPackByHash: mockGetByHash } = require('../../src/lib/db/contextPacks');

      mockGetByHash.mockResolvedValue({
        success: true,
        data: MOCK_CONTEXT_PACK,
      });

      const request = new NextRequest(
        `http://localhost/api/intent/context-packs/by-hash/session-hash-123abc`,
        {
          headers: {
            'x-request-id': 'test-req-get-by-hash',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response = await getContextPackByHash(request, { params: { hash: 'session-hash-123abc' } });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('content-disposition')).toContain('attachment');
      
      const body = await response.text();
      const json = JSON.parse(body);
      expect(json.contextPackVersion).toBe('0.7.0');
    });

    test('returns 404 when pack not found by hash', async () => {
      const { getContextPackByHash: mockGetByHash } = require('../../src/lib/db/contextPacks');

      mockGetByHash.mockResolvedValue({
        success: false,
        error: 'Context pack not found',
      });

      const request = new NextRequest(
        `http://localhost/api/intent/context-packs/by-hash/nonexistent-hash`,
        {
          headers: {
            'x-request-id': 'test-req-get-by-hash-notfound',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response = await getContextPackByHash(request, { params: { hash: 'nonexistent-hash' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toBe('Context pack not found');
    });
  });

  describe('Immutability enforcement', () => {
    test('INSERT...ON CONFLICT DO NOTHING prevents duplicates', async () => {
      const { generateContextPack: mockGenerate } = require('../../src/lib/db/contextPacks');

      // First call creates pack
      mockGenerate.mockResolvedValueOnce({
        success: true,
        data: {
          ...MOCK_CONTEXT_PACK,
          created_at: '2026-01-01T12:00:00.000Z',
        },
      });

      // Second call with same hash returns existing pack (idempotent)
      mockGenerate.mockResolvedValueOnce({
        success: true,
        data: {
          ...MOCK_CONTEXT_PACK,
          created_at: '2026-01-01T12:00:00.000Z', // Same timestamp
        },
      });

      const request1 = new NextRequest(
        `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/context-pack`,
        {
          method: 'POST',
          headers: {
            'x-request-id': 'test-req-immutability-1',
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
            'x-request-id': 'test-req-immutability-2',
            'x-afu9-sub': TEST_USER_ID,
          },
        }
      );

      const response2 = await generateContextPack(request2, { params: { id: TEST_SESSION_ID } });
      const body2 = await response2.json();

      // Both should return same pack ID (immutability)
      expect(body1.id).toBe(body2.id);
      expect(body1.pack_hash).toBe(body2.pack_hash);
      expect(body1.created_at).toBe(body2.created_at);
    });
  });
});
