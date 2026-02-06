/**
 * Integration tests for Epic-1 v0.9: /api/afu9/issues/[ref] Detail Endpoint
 * 
 * Tests the identifier contract for the new AFU9 issues detail endpoint:
 * - Accepts UUID v4 (canonical identifier)
 * - Accepts publicId (8-hex prefix)
 * - Accepts canonicalId (e.g., I811, E81.1)
 * - Response codes: 200 (found), 404 (not found), 400 (invalid)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/afu9/issues/[id]/route';
import { resolveIssueIdentifierOr404 } from '../../app/api/issues/_shared';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
  getAfu9IssueByCanonicalId: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => {
  const actual = jest.requireActual('../../app/api/issues/_shared');
  return {
    ...actual,
    resolveIssueIdentifierOr404: jest.fn(),
  };
});

describe('/api/afu9/issues/[ref] Detail Endpoint', () => {
  const mockResolveIssueIdentifierOr404 = resolveIssueIdentifierOr404 as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveIssueIdentifierOr404.mockResolvedValue({
      ok: true,
      type: 'uuid',
      uuid: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
      issue: mockIssue,
      source: 'control',
    });
  });

  const mockIssue = {
    id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
    title: 'Test Issue',
    body: null,
    status: 'CREATED',
    labels: [],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    activated_at: null,
    execution_state: 'IDLE',
    execution_started_at: null,
    execution_completed_at: null,
    execution_output: null,
    canonical_id: 'I811',
  };

  describe('UUID v4 lookup', () => {
    test('accepts full UUID', async () => {
      const req = new NextRequest('http://localhost/api/afu9/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' }),
      });

      expect(res.status).toBe(200);
      expect(mockResolveIssueIdentifierOr404).toHaveBeenCalledWith(
        'a1b2c3d4-5678-90ab-cdef-1234567890ab',
        expect.any(String)
      );
    });

    test('returns 404 when UUID not found', async () => {
      mockResolveIssueIdentifierOr404.mockResolvedValue({
        ok: false,
        status: 404,
        body: {
          errorCode: 'issue_not_found',
          issueId: '00000000-0000-0000-0000-000000000000',
          lookupStore: 'control',
          requestId: 'req-404',
        },
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/00000000-0000-0000-0000-000000000000');
      const res = await GET(req, {
        params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PublicId (8-hex) lookup', () => {
    test('accepts 8-hex publicId', async () => {
      mockResolveIssueIdentifierOr404.mockResolvedValue({
        ok: true,
        type: 'shortid',
        uuid: mockIssue.id,
        shortId: 'a1b2c3d4',
        issue: mockIssue,
        source: 'control',
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/a1b2c3d4');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'a1b2c3d4' }),
      });

      expect(res.status).toBe(200);
      expect(mockResolveIssueIdentifierOr404).toHaveBeenCalledWith('a1b2c3d4', expect.any(String));
    });

    test('normalizes case for 8-hex publicId', async () => {
      mockResolveIssueIdentifierOr404.mockResolvedValue({
        ok: true,
        type: 'shortid',
        uuid: mockIssue.id,
        shortId: 'a1b2c3d4',
        issue: mockIssue,
        source: 'control',
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/A1B2C3D4');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'A1B2C3D4' }),
      });

      expect(res.status).toBe(200);
      expect(mockResolveIssueIdentifierOr404).toHaveBeenCalledWith('A1B2C3D4', expect.any(String));
    });
  });

  describe('CanonicalId lookup (fallback)', () => {
    test('falls back to canonicalId lookup when UUID/publicId fails', async () => {
      const { getAfu9IssueByCanonicalId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByCanonicalId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/afu9/issues/I811');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'I811' }),
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByCanonicalId).toHaveBeenCalledWith(expect.anything(), 'I811');
    });

    test('handles canonicalId with dots (e.g., E81.1)', async () => {
      const { getAfu9IssueByCanonicalId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByCanonicalId.mockResolvedValue({ 
        success: true, 
        data: { ...mockIssue, canonical_id: 'E81.1' } 
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/E81.1');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'E81.1' }),
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByCanonicalId).toHaveBeenCalledWith(expect.anything(), 'E81.1');
    });

    test('returns 400 when all lookup methods fail', async () => {
      const { getAfu9IssueByCanonicalId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByCanonicalId.mockResolvedValue({ 
        success: false, 
        error: 'Issue not found with canonical ID' 
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/invalid-ref');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'invalid-ref' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid issue identifier format');
    });
  });

  describe('Error handling', () => {
    test('returns 400 when ref is missing', async () => {
      const req = new NextRequest('http://localhost/api/afu9/issues/');
      const res = await GET(req, {
        params: Promise.resolve({ id: '' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Issue identifier required');
    });

    test('returns 500 on database error', async () => {
      mockResolveIssueIdentifierOr404.mockRejectedValue(new Error('Database connection failed'));

      const req = new NextRequest('http://localhost/api/afu9/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Failed to get issue');
    });
  });

  describe('Response format', () => {
    test('returns normalized issue data', async () => {
      mockResolveIssueIdentifierOr404.mockResolvedValue({
        ok: true,
        type: 'uuid',
        uuid: mockIssue.id,
        issue: mockIssue,
        source: 'control',
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      // Check required fields
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('createdAt');
      expect(body).toHaveProperty('updatedAt');
    });

    test('includes cache control headers', async () => {
      mockResolveIssueIdentifierOr404.mockResolvedValue({
        ok: true,
        type: 'uuid',
        uuid: mockIssue.id,
        issue: mockIssue,
        source: 'control',
      });

      const req = new NextRequest('http://localhost/api/afu9/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await GET(req, {
        params: Promise.resolve({ id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
      expect(res.headers.get('Pragma')).toBe('no-cache');
    });
  });
});
