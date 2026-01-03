/**
 * API Auth Tests: Incidents Routes
 * 
 * Tests authentication and authorization for:
 * - GET /api/incidents
 * - GET /api/incidents/[id]
 * 
 * SECURITY: These tests verify that routes fail-closed when x-afu9-sub is missing.
 * In production, proxy.ts middleware strips client-provided x-afu9-* headers
 * (see proxy.ts:397-401) and sets x-afu9-sub only after JWT verification.
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as listIncidents } from '../../../app/api/incidents/route';
import { GET as getIncident } from '../../../app/api/incidents/[id]/route';

// Mock dependencies
const mockListIncidents = jest.fn();
const mockGetIncident = jest.fn();
const mockGetEvidence = jest.fn();
const mockGetEvents = jest.fn();
const mockGetLinks = jest.fn();
const mockQuery = jest.fn();

jest.mock('../../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: mockQuery,
  })),
}));

jest.mock('../../../src/lib/db/incidents', () => ({
  getIncidentDAO: jest.fn(() => ({
    listIncidents: mockListIncidents,
    getIncident: mockGetIncident,
    getEvidence: mockGetEvidence,
    getEvents: mockGetEvents,
    getLinks: mockGetLinks,
  })),
}));

describe('Incidents API Routes - Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListIncidents.mockReset();
    mockGetIncident.mockReset();
    mockGetEvidence.mockReset();
    mockGetEvents.mockReset();
    mockGetLinks.mockReset();
    mockQuery.mockReset();
  });

  describe('GET /api/incidents', () => {
    test('returns 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents', {
        method: 'GET',
        headers: {},
      });

      const response = await listIncidents(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
      expect(data.details).toBe('User authentication required');
      
      // Verify DAO was not called (fail-closed)
      expect(mockListIncidents).not.toHaveBeenCalled();
    });

    test('returns 401 when x-afu9-sub header is empty', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents', {
        method: 'GET',
        headers: {
          'x-afu9-sub': '',
        },
      });

      const response = await listIncidents(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
      
      // Verify DAO was not called (fail-closed)
      expect(mockListIncidents).not.toHaveBeenCalled();
    });

    test('NOTE: client-provided x-afu9-sub is stripped by middleware', async () => {
      // This test documents the security model:
      // In production, proxy.ts middleware (lines 397-401) strips all client-provided
      // x-afu9-* headers BEFORE setting verified values from JWT payload.
      // 
      // This test simulates a scenario where middleware is bypassed (should never happen
      // in production). Even if a malicious client sends x-afu9-sub, the middleware
      // will strip it and replace it with the verified JWT sub claim.
      //
      // If this test runs without middleware (e.g., direct route testing), 
      // the route would accept the header. This is why middleware is critical.
      
      const request = new NextRequest('http://localhost:3000/api/incidents', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'fake-user-123',
        },
      });

      mockListIncidents.mockResolvedValue([]);

      const response = await listIncidents(request);

      // In this unit test context (without middleware), the route accepts the header.
      // In production with middleware, this header would be stripped first.
      expect(response.status).toBe(200);
      
      // The key security guarantee: middleware ALWAYS strips client headers
      // before routes execute. See proxy.ts:397-401.
    });
  });

  describe('GET /api/incidents/[id]', () => {
    test('returns 401 when x-afu9-sub header is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents/test-id', {
        method: 'GET',
        headers: {},
      });

      const params = Promise.resolve({ id: 'test-id' });

      const response = await getIncident(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
      expect(data.details).toBe('User authentication required');
      
      // Verify DAO was not called (fail-closed)
      expect(mockGetIncident).not.toHaveBeenCalled();
    });

    test('returns 401 when x-afu9-sub header is empty', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents/test-id', {
        method: 'GET',
        headers: {
          'x-afu9-sub': '',
        },
      });

      const params = Promise.resolve({ id: 'test-id' });

      const response = await getIncident(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
      
      // Verify DAO was not called (fail-closed)
      expect(mockGetIncident).not.toHaveBeenCalled();
    });

    test('returns 400 when incident ID is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents/', {
        method: 'GET',
        headers: {
          'x-afu9-sub': 'user-123',
        },
      });

      const params = Promise.resolve({ id: '' });

      const response = await getIncident(request, { params });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Incident ID is required');
    });
  });
});
