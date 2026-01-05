/**
 * Ops Dashboard API Contract Tests (E78.4 / I784)
 * 
 * Tests for ops dashboard API endpoint:
 * - GET /api/ops/dashboard - Get ops dashboard data
 * 
 * Validates:
 * - Deterministic ordering
 * - Required fields presence
 * - Response structure
 * 
 * @jest-environment node
 */

import { GET } from '../../app/api/ops/dashboard/route';
import { getPool } from '../../src/lib/db';
import { NextRequest } from 'next/server';

// Mock NextRequest for testing
function createMockRequest(options: {
  url?: string;
  requestId?: string;
  userId?: string;
}): NextRequest {
  const headers = new Headers();
  if (options.requestId) {
    headers.set('x-request-id', options.requestId);
  }
  if (options.userId !== undefined) {
    headers.set('x-afu9-sub', options.userId);
  }

  const url = options.url || 'http://localhost:3000/api/ops/dashboard?window=daily';

  return {
    method: 'GET',
    headers,
    url,
  } as NextRequest;
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Ops Dashboard API - GET /api/ops/dashboard', () => {
  beforeAll(() => {
    getPool(); // Ensure pool is initialized
  });

  describe('Authentication', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        requestId: 'test-auth-1',
        // userId explicitly not set
      });

      const response = await GET(request);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBeTruthy();
    });

    it('should return 401 when x-afu9-sub header is empty string', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        requestId: 'test-auth-2',
        userId: '', // Empty string
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('should accept request with valid x-afu9-sub header', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        requestId: 'test-auth-3',
        userId: 'test-user-123',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid window parameter', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=invalid',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBeTruthy();
    });

    it('should reject invalid from date format', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily&from=invalid-date',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('should reject invalid to date format', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily&to=not-a-date',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
    });

    it('should reject when start date is after end date', async () => {
      const start = '2024-02-01T00:00:00Z';
      const end = '2024-01-01T00:00:00Z';
      
      const request = createMockRequest({
        url: `http://localhost:3000/api/ops/dashboard?window=daily&from=${start}&to=${end}`,
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.details).toContain('before or equal');
    });

    it('should reject date range exceeding 90 days', async () => {
      const start = '2024-01-01T00:00:00Z';
      const end = '2024-05-01T00:00:00Z'; // 121 days
      
      const request = createMockRequest({
        url: `http://localhost:3000/api/ops/dashboard?window=daily&from=${start}&to=${end}`,
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.details).toContain('90 days');
    });

    it('should accept valid date range within 90 days', async () => {
      const start = '2024-01-01T00:00:00Z';
      const end = '2024-03-01T00:00:00Z'; // ~60 days
      
      const request = createMockRequest({
        url: `http://localhost:3000/api/ops/dashboard?window=daily&from=${start}&to=${end}`,
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  describe('Response Structure', () => {
    it('should return all required fields', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        requestId: 'test-req-1',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();

      // Validate top-level structure
      expect(data).toHaveProperty('kpis');
      expect(data).toHaveProperty('topCategories');
      expect(data).toHaveProperty('playbooks');
      expect(data).toHaveProperty('recentIncidents');
      expect(data).toHaveProperty('filters');

      // Validate filters
      expect(data.filters).toHaveProperty('window');
      expect(data.filters).toHaveProperty('from');
      expect(data.filters).toHaveProperty('to');

      // Validate array types
      expect(Array.isArray(data.kpis)).toBe(true);
      expect(Array.isArray(data.topCategories)).toBe(true);
      expect(Array.isArray(data.playbooks)).toBe(true);
      expect(Array.isArray(data.recentIncidents)).toBe(true);
    });

    it('should respect bounded limits on results', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // Verify limits are respected
      expect(data.topCategories.length).toBeLessThanOrEqual(10);
      expect(data.playbooks.length).toBeLessThanOrEqual(10);
      expect(data.recentIncidents.length).toBeLessThanOrEqual(50);
    });

    it('should validate KPI structure', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // If we have KPIs, validate their structure
      if (data.kpis.length > 0) {
        const kpi = data.kpis[0];
        expect(kpi).toHaveProperty('kpi_name');
        expect(kpi).toHaveProperty('points');
        expect(Array.isArray(kpi.points)).toBe(true);

        if (kpi.points.length > 0) {
          const point = kpi.points[0];
          expect(point).toHaveProperty('t');
          expect(point).toHaveProperty('value');
          
          // t should be a valid ISO 8601 timestamp
          expect(() => new Date(point.t)).not.toThrow();
        }
      }
    });

    it('should validate topCategories structure', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // If we have categories, validate their structure
      if (data.topCategories.length > 0) {
        const category = data.topCategories[0];
        expect(category).toHaveProperty('category');
        expect(category).toHaveProperty('count');
        expect(category).toHaveProperty('share');

        expect(typeof category.category).toBe('string');
        expect(typeof category.count).toBe('number');
        expect(typeof category.share).toBe('number');

        // Share should be a percentage (0-100)
        expect(category.share).toBeGreaterThanOrEqual(0);
        expect(category.share).toBeLessThanOrEqual(100);
      }
    });

    it('should validate playbooks structure', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // If we have playbooks, validate their structure
      if (data.playbooks.length > 0) {
        const playbook = data.playbooks[0];
        expect(playbook).toHaveProperty('playbookId');
        expect(playbook).toHaveProperty('runs');
        expect(playbook).toHaveProperty('successRate');
        expect(playbook).toHaveProperty('medianTimeToVerify');
        expect(playbook).toHaveProperty('medianTimeToMitigate');

        expect(typeof playbook.playbookId).toBe('string');
        expect(typeof playbook.runs).toBe('number');
        expect(typeof playbook.successRate).toBe('number');

        // Success rate should be a percentage (0-100)
        expect(playbook.successRate).toBeGreaterThanOrEqual(0);
        expect(playbook.successRate).toBeLessThanOrEqual(100);
      }
    });

    it('should validate recentIncidents structure', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // If we have incidents, validate their structure
      if (data.recentIncidents.length > 0) {
        const incident = data.recentIncidents[0];
        expect(incident).toHaveProperty('id');
        expect(incident).toHaveProperty('severity');
        expect(incident).toHaveProperty('category');
        expect(incident).toHaveProperty('lastSeenAt');
        expect(incident).toHaveProperty('status');

        expect(typeof incident.id).toBe('string');
        expect(typeof incident.severity).toBe('string');
        expect(typeof incident.status).toBe('string');

        // lastSeenAt should be a valid ISO 8601 timestamp
        expect(() => new Date(incident.lastSeenAt)).not.toThrow();
      }
    });
  });

  describe('Deterministic Ordering', () => {
    it('should return KPIs in deterministic order (sorted by kpi_name)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      if (data.kpis.length > 1) {
        // Verify KPIs are sorted alphabetically by kpi_name
        for (let i = 0; i < data.kpis.length - 1; i++) {
          expect(data.kpis[i].kpi_name.localeCompare(data.kpis[i + 1].kpi_name)).toBeLessThanOrEqual(0);
        }
      }
    });

    it('should return KPI points in deterministic order (sorted by time DESC)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      // For each KPI, verify points are sorted by time DESC
      for (const kpi of data.kpis) {
        if (kpi.points.length > 1) {
          for (let i = 0; i < kpi.points.length - 1; i++) {
            const time1 = new Date(kpi.points[i].t).getTime();
            const time2 = new Date(kpi.points[i + 1].t).getTime();
            expect(time1).toBeGreaterThanOrEqual(time2);
          }
        }
      }
    });

    it('should return topCategories in deterministic order (count DESC, category ASC)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      if (data.topCategories.length > 1) {
        // Verify categories are sorted by count DESC
        for (let i = 0; i < data.topCategories.length - 1; i++) {
          const count1 = data.topCategories[i].count;
          const count2 = data.topCategories[i + 1].count;
          
          if (count1 === count2) {
            // If counts are equal, verify alphabetical order by category
            expect(
              data.topCategories[i].category.localeCompare(data.topCategories[i + 1].category)
            ).toBeLessThanOrEqual(0);
          } else {
            // Otherwise, verify count DESC
            expect(count1).toBeGreaterThanOrEqual(count2);
          }
        }
      }
    });

    it('should return playbooks in deterministic order (runs DESC, playbookId ASC)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      if (data.playbooks.length > 1) {
        // Verify playbooks are sorted by runs DESC
        for (let i = 0; i < data.playbooks.length - 1; i++) {
          const runs1 = data.playbooks[i].runs;
          const runs2 = data.playbooks[i + 1].runs;
          
          if (runs1 === runs2) {
            // If runs are equal, verify alphabetical order by playbookId
            expect(
              data.playbooks[i].playbookId.localeCompare(data.playbooks[i + 1].playbookId)
            ).toBeLessThanOrEqual(0);
          } else {
            // Otherwise, verify runs DESC
            expect(runs1).toBeGreaterThanOrEqual(runs2);
          }
        }
      }
    });

    it('should return recentIncidents in deterministic order (lastSeenAt DESC, id ASC)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily', userId: 'test-user',
      });

      const response = await GET(request);
      const data = await response.json();

      if (data.recentIncidents.length > 1) {
        // Verify incidents are sorted by lastSeenAt DESC
        for (let i = 0; i < data.recentIncidents.length - 1; i++) {
          const time1 = new Date(data.recentIncidents[i].lastSeenAt).getTime();
          const time2 = new Date(data.recentIncidents[i + 1].lastSeenAt).getTime();
          
          if (time1 === time2) {
            // If times are equal, verify alphabetical order by id
            expect(
              data.recentIncidents[i].id.localeCompare(data.recentIncidents[i + 1].id)
            ).toBeLessThanOrEqual(0);
          } else {
            // Otherwise, verify time DESC
            expect(time1).toBeGreaterThanOrEqual(time2);
          }
        }
      }
    });
  });

  describe('Window Parameter', () => {
    it('should accept daily window', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.window).toBe('daily');
    });

    it('should accept weekly window', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=weekly',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.window).toBe('weekly');
    });

    it('should default to daily when no window specified', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.window).toBe('daily');
    });
  });

  describe('Date Filtering', () => {
    it('should accept from and to parameters', async () => {
      const from = '2024-01-01T00:00:00Z';
      const to = '2024-01-31T23:59:59Z';
      
      const request = createMockRequest({
        url: `http://localhost:3000/api/ops/dashboard?window=daily&from=${from}&to=${to}`,
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.from).toBe(from);
      expect(data.filters.to).toBe(to);
    });

    it('should work without date parameters', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/dashboard?window=daily',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.from).toBeNull();
      expect(data.filters.to).toBeNull();
    });
  });

  describe('Idempotency', () => {
    it('should return the same results for identical requests', async () => {
      const url = 'http://localhost:3000/api/ops/dashboard?window=daily';

      const request1 = createMockRequest({ url, userId: 'test-user' });
      const response1 = await GET(request1);
      const data1 = await response1.json();

      const request2 = createMockRequest({ url, userId: 'test-user' });
      const response2 = await GET(request2);
      const data2 = await response2.json();

      // Compare structure (not timestamps, as they may change)
      expect(data1.kpis.length).toBe(data2.kpis.length);
      expect(data1.topCategories.length).toBe(data2.topCategories.length);
      expect(data1.playbooks.length).toBe(data2.playbooks.length);
      expect(data1.recentIncidents.length).toBe(data2.recentIncidents.length);
    });
  });
});
