/**
 * Tests for /api/issues/[id] with ID format support
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET } from '../../app/api/issues/[id]/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  getAfu9IssueById: jest.fn(),
  getAfu9IssueByPublicId: jest.fn(),
  updateAfu9Issue: jest.fn(),
  upsertAfu9IssueFromEngine: jest.fn(),
}));

describe('GET /api/issues/[id] - ID format support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockIssue = {
    id: 'c300abd8-1234-5678-90ab-cdef12345678',
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
  };

  test('accepts full UUID v4', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

    const req = new NextRequest('http://localhost/api/issues/c300abd8-1234-5678-90ab-cdef12345678');
    const res = await GET(req, {
      params: { id: 'c300abd8-1234-5678-90ab-cdef12345678' },
    });

    expect(res.status).toBe(200);
    expect(getAfu9IssueById).toHaveBeenCalledWith(expect.anything(), 'c300abd8-1234-5678-90ab-cdef12345678');

    const body = await res.json();
    expect(body).toHaveProperty('id', mockIssue.id);
    expect(body).toHaveProperty('title', 'Test Issue');
  });

  test('accepts 8-character hex shortId', async () => {
    const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

    const req = new NextRequest('http://localhost/api/issues/c300abd8');
    const res = await GET(req, {
      params: { id: 'c300abd8' },
    });

    expect(res.status).toBe(200);
    expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'c300abd8');

    const body = await res.json();
    expect(body).toHaveProperty('id', mockIssue.id);
    expect(body).toHaveProperty('publicId', 'c300abd8');
  });

  test('normalizes shortId to lowercase', async () => {
    const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueByPublicId.mockResolvedValue({ success: true, data: mockIssue });

    const req = new NextRequest('http://localhost/api/issues/C300ABD8');
    const res = await GET(req, {
      params: { id: 'C300ABD8' },
    });

    expect(res.status).toBe(200);
    expect(getAfu9IssueByPublicId).toHaveBeenCalledWith(expect.anything(), 'c300abd8');
  });

  test('returns 400 for invalid ID format', async () => {
    const req = new NextRequest('http://localhost/api/issues/invalid-id');
    const res = await GET(req, {
      params: { id: 'invalid-id' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'Invalid issue ID format');
  });

  test('returns 404 when issue not found (UUID)', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueById.mockResolvedValue({
      success: false,
      error: 'Issue not found',
    });

    const req = new NextRequest('http://localhost/api/issues/c300abd8-1234-5678-90ab-cdef12345678');
    const res = await GET(req, {
      params: { id: 'c300abd8-1234-5678-90ab-cdef12345678' },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: 'c300abd8-1234-5678-90ab-cdef12345678',
      lookupStore: 'control',
    });
    expect(res.headers.get('x-afu9-request-id')).toBeTruthy();
  });

  test('returns 404 when issue not found (shortId)', async () => {
    const { getAfu9IssueByPublicId } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueByPublicId.mockResolvedValue({
      success: false,
      error: 'Issue not found: c300abd8',
    });

    const req = new NextRequest('http://localhost/api/issues/c300abd8');
    const res = await GET(req, {
      params: { id: 'c300abd8' },
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      errorCode: 'issue_not_found',
      issueId: 'c300abd8',
      lookupStore: 'control',
    });
    expect(res.headers.get('x-afu9-request-id')).toBeTruthy();
  });

  test('falls back to engine and persists issue', async () => {
    const { getAfu9IssueById, upsertAfu9IssueFromEngine } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueById.mockResolvedValue({ success: false, error: 'Issue not found' });
    upsertAfu9IssueFromEngine.mockResolvedValue({ success: true, data: mockIssue });

    process.env.ENGINE_BASE_URL = 'https://engine.example.com';
    process.env.ENGINE_SERVICE_TOKEN = 'engine-token';

    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: mockIssue.id,
        title: mockIssue.title,
        status: mockIssue.status,
        labels: [],
      }),
    } as any);

    const req = new NextRequest(`http://localhost/api/issues/${mockIssue.id}`);
    const res = await GET(req, {
      params: { id: mockIssue.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id', mockIssue.id);
    expect(upsertAfu9IssueFromEngine).toHaveBeenCalled();

    fetchMock.mockRestore();
    delete process.env.ENGINE_BASE_URL;
    delete process.env.ENGINE_SERVICE_TOKEN;
  });

  test('returns structured error with requestId on unhandled error', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueById.mockRejectedValue(new Error('Database connection failed'));

    const req = new NextRequest('http://localhost/api/issues/c300abd8-1234-5678-90ab-cdef12345678');
    const res = await GET(req, {
      params: { id: 'c300abd8-1234-5678-90ab-cdef12345678' },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('requestId');
    expect(body).toHaveProperty('timestamp');
    expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('includes ISO timestamps in response', async () => {
    const { getAfu9IssueById } = require('../../src/lib/db/afu9Issues');
    getAfu9IssueById.mockResolvedValue({ success: true, data: mockIssue });

    const req = new NextRequest('http://localhost/api/issues/c300abd8-1234-5678-90ab-cdef12345678');
    const res = await GET(req, {
      params: { id: 'c300abd8-1234-5678-90ab-cdef12345678' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.createdAt).toBe('2024-01-15T10:00:00.000Z');
    expect(body.updatedAt).toBe('2024-01-15T10:00:00.000Z');
  });
});
