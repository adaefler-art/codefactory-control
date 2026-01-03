/**
 * Integration tests for Incidents API Routes (E76.4 / I764)
 * 
 * Tests:
 * - GET /api/incidents: List with filters, deterministic ordering
 * - GET /api/incidents/[id]: Detail with evidence, events, links
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as listIncidents } from '../../../app/api/incidents/route';
import { GET as getIncident } from '../../../app/api/incidents/[id]/route';

// Create mock functions
const mockListIncidents = jest.fn();
const mockGetIncident = jest.fn();
const mockGetEvidence = jest.fn();
const mockGetEvents = jest.fn();
const mockGetLinks = jest.fn();
const mockQuery = jest.fn();

// Mock dependencies
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

describe('Incidents API Routes', () => {
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
    it('should return 401 if not authenticated', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents');
      
      const response = await listIncidents(request);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should list incidents with default filters', async () => {
      const mockIncidents = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          incident_key: 'deploy_status:prod:deploy-123:2024-01-15T10:00:00Z',
          severity: 'RED',
          status: 'OPEN',
          title: 'Deploy failed',
          summary: 'Deploy to prod failed',
          classification: null,
          lawbook_version: 'v1.0.0',
          source_primary: { kind: 'deploy_status', ref: {} },
          tags: [],
          created_at: '2024-01-15T10:00:00Z',
          updated_at: '2024-01-15T10:00:00Z',
          first_seen_at: '2024-01-15T10:00:00Z',
          last_seen_at: '2024-01-15T10:05:00Z',
        },
      ];
      
      mockListIncidents.mockResolvedValue(mockIncidents);

      const request = new NextRequest('http://localhost:3000/api/incidents');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.incidents).toEqual(mockIncidents);
      expect(data.count).toBe(1);
      expect(data.hasMore).toBe(false); // 1 < 50 default limit
      expect(mockListIncidents).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
      });
    });

    it('should filter by status', async () => {
      mockListIncidents.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/incidents?status=OPEN');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(200);
      expect(mockListIncidents).toHaveBeenCalledWith({
        status: 'OPEN',
        limit: 50,
        offset: 0,
      });
    });

    it('should filter by severity', async () => {
      mockListIncidents.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/incidents?severity=RED');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(200);
      expect(mockListIncidents).toHaveBeenCalledWith({
        severity: 'RED',
        limit: 50,
        offset: 0,
      });
    });

    it('should support pagination with limit and offset', async () => {
      mockListIncidents.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/incidents?limit=50&offset=10');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(200);
      expect(mockListIncidents).toHaveBeenCalledWith({
        limit: 50,
        offset: 10,
      });
    });

    it('should return 400 for invalid filter parameters', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents?status=INVALID');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid filter parameters');
    });

    it('should enforce max limit of 200', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents?limit=500');
      request.headers.set('x-afu9-sub', 'test-user');

      const response = await listIncidents(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid filter parameters');
      expect(data.details).toContain('200'); // Should mention max limit
    });
  });

  describe('GET /api/incidents/[id]', () => {
    it('should return 401 if not authenticated', async () => {
      const request = new NextRequest('http://localhost:3000/api/incidents/123');
      const params = Promise.resolve({ id: '123' });
      
      const response = await getIncident(request, { params });
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('should return 404 if incident not found', async () => {
      mockGetIncident.mockResolvedValue(null);

      const request = new NextRequest('http://localhost:3000/api/incidents/123');
      request.headers.set('x-afu9-sub', 'test-user');
      const params = Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' });

      const response = await getIncident(request, { params });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Incident not found');
    });

    it('should return incident with evidence, events, and links', async () => {
      const mockIncident = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        incident_key: 'deploy_status:prod:deploy-123:2024-01-15T10:00:00Z',
        severity: 'RED',
        status: 'OPEN',
        title: 'Deploy failed',
        summary: 'Deploy to prod failed',
        classification: null,
        lawbook_version: 'v1.0.0',
        source_primary: { kind: 'deploy_status', ref: {} },
        tags: [],
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        first_seen_at: '2024-01-15T10:00:00Z',
        last_seen_at: '2024-01-15T10:05:00Z',
      };

      const mockEvidence = [
        {
          id: 'ev-123',
          incident_id: mockIncident.id,
          kind: 'deploy_status',
          ref: { env: 'prod' },
          sha256: 'abc123',
          created_at: '2024-01-15T10:00:00Z',
        },
      ];

      const mockEvents = [
        {
          id: 'evt-123',
          incident_id: mockIncident.id,
          event_type: 'CREATED',
          payload: {},
          created_at: '2024-01-15T10:00:00Z',
        },
      ];

      const mockLinks = [
        {
          id: 'link-123',
          incident_id: mockIncident.id,
          timeline_node_id: 'node-123',
          link_type: 'TRIGGERED_BY',
          created_at: '2024-01-15T10:00:00Z',
        },
      ];

      mockGetIncident.mockResolvedValue(mockIncident);
      mockGetEvidence.mockResolvedValue(mockEvidence);
      mockGetEvents.mockResolvedValue(mockEvents);
      mockGetLinks.mockResolvedValue(mockLinks);

      // Mock timeline node query
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'node-123',
            node_type: 'DEPLOY',
            node_id: 'deploy-123',
            created_at: new Date('2024-01-15T10:00:00Z'),
            payload: {},
          },
        ],
      });

      const request = new NextRequest('http://localhost:3000/api/incidents/123');
      request.headers.set('x-afu9-sub', 'test-user');
      const params = Promise.resolve({ id: mockIncident.id });

      const response = await getIncident(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.incident).toEqual(mockIncident);
      expect(data.evidence).toEqual(mockEvidence);
      expect(data.events).toEqual(mockEvents);
      expect(data.links).toHaveLength(1);
      expect(data.links[0].timeline_node_id).toBe('node-123');
      expect(data.links[0].node_type).toBe('DEPLOY');
    });
  });
});
