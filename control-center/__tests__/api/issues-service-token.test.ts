/**
 * Service token guard tests for Issues API
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as getIssues } from '../../app/api/issues/route';
import { GET as getIssue } from '../../app/api/issues/[id]/route';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

jest.mock('../../src/lib/db/afu9Issues', () => ({
  listAfu9Issues: jest.fn(),
}));

jest.mock('../../app/api/issues/_shared', () => ({
  fetchIssueRowByIdentifier: jest.fn(),
  normalizeIssueForApi: jest.fn(() => ({ id: 'issue-1' })),
}));

describe('Issues API service token guard', () => {
  beforeEach(() => {
    process.env.SERVICE_READ_TOKEN = 'service-secret';
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SERVICE_READ_TOKEN;
  });

  describe('GET /api/issues', () => {
    test('missing header returns 401', async () => {
      const req = new NextRequest('http://localhost/api/issues');
      const res = await getIssues(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Authentication required');
    });

    test('x-afu9-sub allows without service token', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const headers = new Headers({ 'x-afu9-sub': 'user-123' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });

    test('wrong header returns 403', async () => {
      const headers = new Headers({ 'x-afu9-service-token': 'wrong' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('service token rejected');
    });

    test('accepts Authorization Bearer token', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const headers = new Headers({ Authorization: 'Bearer service-secret' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });

    test('accepts x-service-token fallback header', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const headers = new Headers({ 'x-service-token': 'service-secret' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });

    test('accepts quoted env token', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      process.env.SERVICE_READ_TOKEN = '"service-secret"';
      const headers = new Headers({ 'x-afu9-service-token': 'service-secret' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });

    test('accepts env token with newline', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      process.env.SERVICE_READ_TOKEN = 'service-secret\n';
      const headers = new Headers({ 'x-afu9-service-token': 'service-secret' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });

    test('correct header returns 200', async () => {
      const { listAfu9Issues } = require('../../src/lib/db/afu9Issues');
      listAfu9Issues.mockResolvedValue({ success: true, data: [] });

      const headers = new Headers({ 'x-afu9-service-token': 'service-secret' });
      const req = new NextRequest('http://localhost/api/issues', { headers });
      const res = await getIssues(req);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/issues/[id]', () => {
    test('missing header returns 401', async () => {
      const req = new NextRequest('http://localhost/api/issues/ISS-001');
      const res = await getIssue(req, { params: Promise.resolve({ id: 'ISS-001' }) });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Authentication required');
    });

    test('x-afu9-sub allows without service token', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      fetchIssueRowByIdentifier.mockResolvedValue({ ok: true, row: { id: 'issue-1' } });

      const headers = new Headers({ 'x-afu9-sub': 'user-123' });
      const req = new NextRequest('http://localhost/api/issues/ISS-001', { headers });
      const res = await getIssue(req, { params: Promise.resolve({ id: 'ISS-001' }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('issue-1');
    });

    test('wrong header returns 403', async () => {
      const headers = new Headers({ 'x-afu9-service-token': 'wrong' });
      const req = new NextRequest('http://localhost/api/issues/ISS-001', { headers });
      const res = await getIssue(req, { params: Promise.resolve({ id: 'ISS-001' }) });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('service token rejected');
    });

    test('accepts Authorization Bearer token', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      fetchIssueRowByIdentifier.mockResolvedValue({ ok: true, row: { id: 'issue-1' } });

      const headers = new Headers({ Authorization: 'Bearer service-secret' });
      const req = new NextRequest('http://localhost/api/issues/ISS-001', { headers });
      const res = await getIssue(req, { params: Promise.resolve({ id: 'ISS-001' }) });

      expect(res.status).toBe(200);
    });

    test('correct header returns 200', async () => {
      const { fetchIssueRowByIdentifier } = require('../../app/api/issues/_shared');
      fetchIssueRowByIdentifier.mockResolvedValue({ ok: true, row: { id: 'issue-1' } });

      const headers = new Headers({ 'x-afu9-service-token': 'service-secret' });
      const req = new NextRequest('http://localhost/api/issues/ISS-001', { headers });
      const res = await getIssue(req, { params: Promise.resolve({ id: 'ISS-001' }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('issue-1');
    });
  });
});
