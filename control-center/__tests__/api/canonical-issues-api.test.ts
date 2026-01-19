/**
 * Integration tests for I201.1: Canonical Issues API
 * 
 * Tests the canonical /api/afu9/issues endpoint to ensure:
 * - Deterministic filtering by canonicalId and publicId
 * - Consistent response format with issues[], total, filtered, limit, offset
 * - /api/issues delegates to canonical behavior
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getAfu9Issues } from '../../app/api/afu9/issues/route';
import { GET as getIssues } from '../../app/api/issues/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
}));

describe('I201.1: Canonical Issues API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockIssueI867 = {
    id: 'c300abd8-1234-5678-90ab-1234567890ab',
    canonical_id: 'I867',
    title: 'Test Issue I867',
    body: 'Test body',
    status: 'CREATED',
    labels: ['test'],
    priority: null,
    assignee: null,
    source: 'afu9',
    handoff_state: 'NOT_SENT',
    github_issue_number: null,
    github_url: null,
    last_error: null,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    activated_at: null,
    execution_state: 'IDLE',
    execution_started_at: null,
    execution_completed_at: null,
    execution_output: null,
    deleted_at: null,
  };

  const mockIssueE81 = {
    id: 'd400bce9-2345-6789-01bc-2345678901bc',
    canonical_id: 'E81.1',
    title: 'Test Issue E81.1',
    body: 'Test body',
    status: 'SPEC_READY',
    labels: ['epic'],
    priority: 'P1',
    assignee: null,
    source: 'afu9',
    handoff_state: 'SENT',
    github_issue_number: 100,
    github_url: 'https://github.com/test/repo/issues/100',
    last_error: null,
    created_at: new Date('2024-01-16T10:00:00Z'),
    updated_at: new Date('2024-01-16T10:00:00Z'),
    activated_at: new Date('2024-01-16T10:00:00Z'),
    execution_state: 'RUNNING',
    execution_started_at: new Date('2024-01-16T10:00:00Z'),
    execution_completed_at: null,
    execution_output: null,
    deleted_at: null,
  };

  describe('GET /api/afu9/issues - Canonical endpoint', () => {
    test('filters by canonicalId and returns exactly one issue (filtered=1)', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/afu9/issues?canonicalId=I867');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify call to database with correct filter
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          canonicalId: 'I867',
          limit: 100,
          offset: 0,
        })
      );

      // Verify response structure
      expect(body).toHaveProperty('issues');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('filtered');
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');

      // Verify deterministic filtering
      expect(body.issues).toHaveLength(1);
      expect(body.filtered).toBe(1);
      expect(body.total).toBe(1);
      expect(body.issues[0].id).toBe(mockIssueI867.id);
    });

    test('supports canonical_id as alias for canonicalId', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/afu9/issues?canonical_id=I867');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          canonicalId: 'I867',
        })
      );
    });

    test('filters by publicId and returns matching issue', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/afu9/issues?publicId=c300abd8');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publicId: 'c300abd8',
        })
      );

      expect(body.filtered).toBe(1);
      expect(body.issues[0].id).toBe(mockIssueI867.id);
    });

    test('supports public_id as alias for publicId', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/afu9/issues?public_id=c300abd8');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publicId: 'c300abd8',
        })
      );
    });

    test('filters by status', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueE81] });

      const req = new NextRequest('http://localhost/api/afu9/issues?status=SPEC_READY');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'SPEC_READY',
        })
      );

      expect(body.filtered).toBe(1);
      expect(body.issues[0].status).toBe('SPEC_READY');
    });

    test('respects limit and offset parameters', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867, mockIssueE81] });

      const req = new NextRequest('http://localhost/api/afu9/issues?limit=10&offset=5');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          limit: 10,
          offset: 5,
        })
      );

      expect(body.limit).toBe(10);
      expect(body.offset).toBe(5);
    });

    test('returns empty list when no matches with filtered=0', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const req = new NextRequest('http://localhost/api/afu9/issues?canonicalId=NONEXISTENT');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.issues).toHaveLength(0);
      expect(body.filtered).toBe(0);
      expect(body.total).toBe(0);
    });

    test('returns 400 for invalid status', async () => {
      const req = new NextRequest('http://localhost/api/afu9/issues?status=INVALID');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Invalid status parameter');
    });

    test('does NOT return unfiltered default list when filter is set', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      // Mock returns empty array when filter doesn't match
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const req = new NextRequest('http://localhost/api/afu9/issues?canonicalId=NONEXISTENT');
      const res = await getAfu9Issues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      // Should return empty, not a default list
      expect(body.issues).toHaveLength(0);
      expect(body.filtered).toBe(0);
    });
  });

  describe('GET /api/issues - Delegates to canonical behavior', () => {
    test('filters by canonicalId same as /api/afu9/issues', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/issues?canonicalId=I867');
      const res = await getIssues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      // Should delegate to listAfu9Issues with canonicalId filter
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          canonicalId: 'I867',
        })
      );

      expect(body.filtered).toBe(1);
      expect(body.issues[0].id).toBe(mockIssueI867.id);
    });

    test('supports canonical_id alias', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/issues?canonical_id=I867');
      const res = await getIssues(req);

      expect(res.status).toBe(200);
      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          canonicalId: 'I867',
        })
      );
    });

    test('filters by publicId same as /api/afu9/issues', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867] });

      const req = new NextRequest('http://localhost/api/issues?publicId=c300abd8');
      const res = await getIssues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(listAfu9Issues).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          publicId: 'c300abd8',
        })
      );

      expect(body.filtered).toBeGreaterThanOrEqual(1);
    });

    test('returns consistent response structure', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [mockIssueI867, mockIssueE81] });

      const req = new NextRequest('http://localhost/api/issues');
      const res = await getIssues(req);

      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify same response structure as canonical API
      expect(body).toHaveProperty('issues');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('filtered');
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');
    });
  });
});
