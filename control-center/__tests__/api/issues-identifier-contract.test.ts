/**
 * Integration tests for Issue #3: Identifier Consistency
 * 
 * Tests the identifier contract across all Issues API endpoints:
 * - id = UUID (canonical)
 * - publicId = 8-hex display
 * - API accepts both UUID and 8-hex
 * - Response codes: 200 (found), 404 (not found), 400 (invalid)
 * - No 400 for valid UUIDs or 8-hex prefixes
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssue, PATCH as patchIssue } from '../../app/api/issues/[id]/route';
import { GET as getExecution, POST as postExecution } from '../../app/api/issues/[id]/execution/route';
import { GET as getEvents } from '../../app/api/issues/[id]/events/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
  updateAfu9Issue: jest.fn(),
  getIssueEvents: jest.fn(),
}));

describe('Issue #3: Identifier Consistency Contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  };

  describe('Valid UUID acceptance (canonical identifier)', () => {
    test('GET /api/issues/[id] accepts full UUID', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueById).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4-5678-90ab-cdef-1234567890ab');
    });

    test('GET /api/issues/[id]/execution accepts full UUID', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab/execution');
      const res = await getExecution(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueById).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4-5678-90ab-cdef-1234567890ab');
    });

    test('PATCH /api/issues/[id] accepts full UUID', async () => {
      const { getAfu9IssueById, updateAfu9Issue } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });
      updateAfu9Issue.mockResolvedValue({ success: true, data: { ...mockIssue, title: 'Updated' } });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
      });
      const res = await patchIssue(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueById).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4-5678-90ab-cdef-1234567890ab');
    });
  });

  describe('Valid 8-hex publicId acceptance (display format)', () => {
    test('GET /api/issues/[id] accepts 8-hex publicId', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4');
    });

    test('GET /api/issues/[id]/execution accepts 8-hex publicId', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4/execution');
      const res = await getExecution(req, {
        params: { id: 'a1b2c3d4' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4');
    });

    test('GET /api/issues/[id]/events accepts 8-hex publicId', async () => {
      const { getAfu9IssueByPublicId, getIssueEvents } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });
      getIssueEvents.mockResolvedValue({ success: true, data: [] });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4/events');
      const res = await getEvents(req, {
        params: { id: 'a1b2c3d4' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4');
    });
  });

  describe('Case insensitivity for 8-hex publicId', () => {
    test('normalizes uppercase 8-hex to lowercase', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/A1B2C3D4');
      const res = await getIssue(req, {
        params: { id: 'A1B2C3D4' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4');
    });

    test('normalizes mixed case 8-hex to lowercase', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1B2c3D4');
      const res = await getIssue(req, {
        params: { id: 'a1B2c3D4' },
      });

      expect(res.status).toBe(200);
      expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'a1b2c3d4');
    });
  });

  describe('Response code contract: 400 for invalid formats', () => {
    test('returns 400 for invalid format (too short)', async () => {
      const req = new NextRequest('http://localhost/api/issues/abc123');
      const res = await getIssue(req, {
        params: { id: 'abc123' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid issue ID format');
    });

    test('returns 400 for invalid format (too long 8-hex)', async () => {
      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4e');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4e' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid issue ID format');
    });

    test('returns 400 for invalid format (non-hex chars)', async () => {
      const req = new NextRequest('http://localhost/api/issues/zzzzxxxx');
      const res = await getIssue(req, {
        params: { id: 'zzzzxxxx' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid issue ID format');
    });

    test('returns 400 for malformed UUID', async () => {
      const req = new NextRequest('http://localhost/api/issues/not-a-uuid-format');
      const res = await getIssue(req, {
        params: { id: 'not-a-uuid-format' },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid issue ID format');
    });
  });

  describe('Response code contract: 404 for not found', () => {
    test('returns 404 when UUID not found', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      process.env.ENGINE_BASE_URL = 'https://engine.example.com';
      process.env.ENGINE_SERVICE_TOKEN = 'engine-token';

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as any);

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({
        errorCode: 'issue_not_found',
        issueId: 'a1b2c3d4-5678-90ab-cdef-1234567890ab',
        lookupStore: 'control',
      });

      fetchMock.mockRestore();
      delete process.env.ENGINE_BASE_URL;
      delete process.env.ENGINE_SERVICE_TOKEN;
    });

    test('returns 404 when 8-hex publicId not found', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({
        success: false,
        error: 'Issue not found: a1b2c3d4',
      });

      process.env.ENGINE_BASE_URL = 'https://engine.example.com';
      process.env.ENGINE_SERVICE_TOKEN = 'engine-token';

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as any);

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4' },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toMatchObject({
        errorCode: 'issue_not_found',
        issueId: 'a1b2c3d4',
        lookupStore: 'control',
      });

      fetchMock.mockRestore();
      delete process.env.ENGINE_BASE_URL;
      delete process.env.ENGINE_SERVICE_TOKEN;
    });
  });

  describe('Response code contract: 200 for found', () => {
    test('returns 200 with valid UUID when found', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('id', mockIssue.id);
      expect(body).toHaveProperty('publicId', 'a1b2c3d4');
      expect(body).toHaveProperty('title', mockIssue.title);
    });

    test('returns 200 with valid 8-hex when found', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('id', mockIssue.id);
      expect(body).toHaveProperty('publicId', 'a1b2c3d4');
      expect(body).toHaveProperty('title', mockIssue.title);
    });
  });

  describe('Guarantee: No 400 for valid identifiers', () => {
    test('all valid UUIDs return 200 or 404, never 400', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      
      const validUUIDs = [
        'a1b2c3d4-5678-90ab-cdef-1234567890ab',
        'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ];

      for (const uuid of validUUIDs) {
        getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

        const req = new NextRequest(`http://localhost/api/issues/${uuid}`);
        const res = await getIssue(req, { params: { id: uuid } });

        expect([200, 404]).toContain(res.status);
        expect(res.status).not.toBe(400);
      }
    });

    test('all valid 8-hex publicIds return 200 or 404, never 400', async () => {
      const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
      
      const validPublicIds = [
        'a1b2c3d4',
        'AAAAAAAA',
        '00000000',
        'ffffffff',
        '12345678',
        'abcdef01',
      ];

      for (const publicId of validPublicIds) {
        getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

        const req = new NextRequest(`http://localhost/api/issues/${publicId}`);
        const res = await getIssue(req, { params: { id: publicId } });

        expect([200, 404]).toContain(res.status);
        expect(res.status).not.toBe(400);
      }
    });
  });

  describe('API response includes both id and publicId', () => {
    test('response always includes both id (UUID) and publicId (8-hex)', async () => {
      const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
      getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

      const req = new NextRequest('http://localhost/api/issues/a1b2c3d4-5678-90ab-cdef-1234567890ab');
      const res = await getIssue(req, {
        params: { id: 'a1b2c3d4-5678-90ab-cdef-1234567890ab' },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      // Both identifiers present
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('publicId');
      
      // Canonical id is full UUID
      expect(body.id).toBe('a1b2c3d4-5678-90ab-cdef-1234567890ab');
      expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      // publicId is 8-hex derived from UUID
      expect(body.publicId).toBe('a1b2c3d4');
      expect(body.publicId).toMatch(/^[0-9a-f]{8}$/i);
    });
  });
});
