/**
 * Tests for INTENT Sources API
 * 
 * Tests GET /api/intent/sessions/[id]/sources endpoint.
 * Issue E89.5: INTENT "Sources" Integration
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/intent/sessions/[id]/sources/route';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(),
  })),
}));

// Import mocked getPool
import { getPool } from '../../src/lib/db';

const TEST_USER_ID = 'user-123';
const TEST_SESSION_ID = 'session-456';

// Helper to create mock request
function createMockRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: {
      'x-afu9-sub': TEST_USER_ID,
      ...headers,
    },
  });
}

// Helper to create mock context
function createMockContext(sessionId: string) {
  return {
    params: Promise.resolve({ id: sessionId }),
  };
}

describe('GET /api/intent/sessions/[id]/sources', () => {
  let mockQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = jest.fn();
    (getPool as jest.Mock).mockReturnValue({ query: mockQuery });
  });

  test('returns 401 if user is not authenticated', async () => {
    const request = new NextRequest('http://localhost/api/intent/sessions/session-123/sources');
    const context = createMockContext('session-123');

    const response = await GET(request, context);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('Unauthorized');
  });

  test('returns 400 if session ID is invalid', async () => {
    const request = createMockRequest('http://localhost/api/intent/sessions//sources');
    const context = createMockContext('');

    const response = await GET(request, context);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Session ID required');
  });

  test('returns 403 if session does not belong to user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // Session check fails

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Session not found');
  });

  test('returns empty sources array if no messages have sources', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] }) // Session check
      .mockResolvedValueOnce({ rows: [] }); // No messages with sources

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sources).toEqual([]);
    expect(data.count).toBe(0);
    expect(data.sessionId).toBe(TEST_SESSION_ID);
  });

  test('returns sources from assistant messages', async () => {
    const sources = [
      {
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'src/lib/utils.ts',
        startLine: 1,
        endLine: 10,
        snippetHash: 'abc123',
        contentSha256: 'fullhash123',
      },
    ];

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] }) // Session check
      .mockResolvedValueOnce({
        // Messages with sources
        rows: [
          {
            id: 'msg-1',
            used_sources_json: sources,
            used_sources_hash: 'hash123',
            created_at: new Date('2025-01-15T20:00:00Z'),
          },
        ],
      });

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0]).toEqual(sources[0]);
    expect(data.count).toBe(1);
  });

  test('deduplicates sources from multiple messages', async () => {
    const source1 = {
      kind: 'file_snippet',
      repo: { owner: 'org', repo: 'repo' },
      branch: 'main',
      path: 'file.ts',
      startLine: 1,
      endLine: 10,
      snippetHash: 'abc123',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-1',
            used_sources_json: [source1],
            used_sources_hash: 'hash1',
            created_at: new Date('2025-01-15T20:00:00Z'),
          },
          {
            id: 'msg-2',
            used_sources_json: [source1], // Same source
            used_sources_hash: 'hash1',
            created_at: new Date('2025-01-15T20:01:00Z'),
          },
        ],
      });

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sources).toHaveLength(1); // Deduplicated
    expect(data.count).toBe(1);
  });

  test('filters sources by type when type query param is provided', async () => {
    const fileSource = {
      kind: 'file_snippet',
      repo: { owner: 'org', repo: 'repo' },
      branch: 'main',
      path: 'file.ts',
      startLine: 1,
      endLine: 10,
      snippetHash: 'abc',
    };

    const issueSource = {
      kind: 'github_issue',
      repo: { owner: 'org', repo: 'repo' },
      number: 123,
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-1',
            used_sources_json: [fileSource, issueSource],
            used_sources_hash: 'hash1',
            created_at: new Date('2025-01-15T20:00:00Z'),
          },
        ],
      });

    const request = createMockRequest(
      `http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources?type=file_snippet`
    );
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.sources).toHaveLength(1);
    expect(data.sources[0].kind).toBe('file_snippet');
    expect(data.typeFilter).toBe('file_snippet');
  });

  test('handles database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Database error'));

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    const response = await GET(request, context);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch sources');
  });

  test('orders messages by created_at and id deterministically', async () => {
    // Verify query parameters
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: TEST_SESSION_ID }] })
      .mockResolvedValueOnce({ rows: [] });

    const request = createMockRequest(`http://localhost/api/intent/sessions/${TEST_SESSION_ID}/sources`);
    const context = createMockContext(TEST_SESSION_ID);

    await GET(request, context);

    // Check that query includes ORDER BY clause
    const messagesQuery = mockQuery.mock.calls[1][0];
    expect(messagesQuery).toContain('ORDER BY created_at ASC, id ASC');
  });
});
