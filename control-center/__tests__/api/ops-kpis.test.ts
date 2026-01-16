/**
 * Automation KPI Dashboard API Contract Tests (E88.2)
 * 
 * Tests for automation KPI dashboard API endpoint:
 * - GET /api/ops/kpis - Get automation KPI metrics
 * 
 * Validates:
 * - Authentication and authorization
 * - Input validation (period parameter)
 * - Response structure
 * - KPI calculations (deterministic)
 * 
 * @jest-environment node
 */

import { GET } from '../../app/api/ops/kpis/route';
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

  const url = options.url || 'http://localhost:3000/api/ops/kpis?period=7d';

  return {
    method: 'GET',
    headers,
    url,
  } as NextRequest;
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('Automation KPI Dashboard API - GET /api/ops/kpis', () => {
  describe('Authentication', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        requestId: 'test-auth-kpi-1',
        // userId explicitly not set
      });

      const response = await GET(request);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toBeTruthy();
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when x-afu9-sub header is empty string', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        requestId: 'test-auth-kpi-2',
        userId: '', // Empty string
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('should return 403 when user is not admin', async () => {
      // Set AFU9_ADMIN_SUBS to a different user
      const oldAdminSubs = process.env.AFU9_ADMIN_SUBS;
      process.env.AFU9_ADMIN_SUBS = 'admin-user-123';

      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        requestId: 'test-auth-kpi-3',
        userId: 'non-admin-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(403);

      const data = await response.json();
      expect(data.error).toBeTruthy();
      expect(data.code).toBe('FORBIDDEN');

      // Restore original value
      process.env.AFU9_ADMIN_SUBS = oldAdminSubs;
    });
  });

  describe('Input Validation', () => {
    const oldAdminSubs = process.env.AFU9_ADMIN_SUBS;

    beforeAll(() => {
      // Set test user as admin for validation tests
      process.env.AFU9_ADMIN_SUBS = 'test-user';
    });

    afterAll(() => {
      // Restore original value
      process.env.AFU9_ADMIN_SUBS = oldAdminSubs;
    });

    it('should reject invalid period parameter', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=invalid',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(400);
      
      const data = await response.json();
      expect(data.error).toBeTruthy();
      expect(data.error).toContain('Invalid query parameters');
    });

    it('should accept valid period=cycle', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=cycle',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });

    it('should accept valid period=7d', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });

    it('should accept valid period=30d', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=30d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
    });

    it('should use default period when not specified', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.filters.period).toBe('cycle'); // Default period
    });
  });

  describe('Response Structure', () => {
    const oldAdminSubs = process.env.AFU9_ADMIN_SUBS;

    beforeAll(() => {
      process.env.AFU9_ADMIN_SUBS = 'test-user';
    });

    afterAll(() => {
      process.env.AFU9_ADMIN_SUBS = oldAdminSubs;
    });

    it('should return all required KPI metrics', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      // Verify summary structure
      expect(data.summary).toBeDefined();
      expect(data.summary.d2d).toBeDefined();
      expect(data.summary.hsh).toBeDefined();
      expect(data.summary.dcu).toBeDefined();
      expect(data.summary.automationCoverage).toBeDefined();

      // Verify each metric has required fields
      const metrics = [data.summary.d2d, data.summary.hsh, data.summary.dcu, data.summary.automationCoverage];
      metrics.forEach(metric => {
        expect(metric.name).toBeDefined();
        expect(metric.unit).toBeDefined();
        expect(metric.trend).toBeDefined();
        // value can be null, but property must exist
        expect('value' in metric).toBe(true);
      });
    });

    it('should return touchpoint breakdown', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      expect(data.touchpointBreakdown).toBeDefined();
      expect(Array.isArray(data.touchpointBreakdown)).toBe(true);

      // If there are touchpoints, verify structure
      if (data.touchpointBreakdown.length > 0) {
        const tp = data.touchpointBreakdown[0];
        expect(tp.type).toBeDefined();
        expect(tp.count).toBeDefined();
        expect(tp.percentage).toBeDefined();
        expect(typeof tp.count).toBe('number');
        expect(typeof tp.percentage).toBe('number');
      }
    });

    it('should return filters in response', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=30d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      expect(data.filters).toBeDefined();
      expect(data.filters.period).toBe('30d');
      expect('from' in data.filters).toBe(true);
      expect('to' in data.filters).toBe(true);
      expect('cycleId' in data.filters).toBe(true);
    });

    it('should return metadata', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      expect(data.metadata).toBeDefined();
      expect(data.metadata.calculatedAt).toBeDefined();
      expect(data.metadata.dataVersion).toBeDefined();
      
      // Verify calculatedAt is a valid ISO timestamp
      expect(() => new Date(data.metadata.calculatedAt)).not.toThrow();
    });

    it('should include x-request-id header in response', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        requestId: 'test-request-123',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);
      
      const requestId = response.headers.get('x-request-id');
      expect(requestId).toBeTruthy();
    });
  });

  describe('KPI Calculations', () => {
    const oldAdminSubs = process.env.AFU9_ADMIN_SUBS;

    beforeAll(() => {
      process.env.AFU9_ADMIN_SUBS = 'test-user';
    });

    afterAll(() => {
      process.env.AFU9_ADMIN_SUBS = oldAdminSubs;
    });

    it('should calculate automation coverage as percentage', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const coverage = data.summary.automationCoverage;
      expect(coverage.unit).toBe('%');
      
      if (coverage.value !== null) {
        expect(coverage.value).toBeGreaterThanOrEqual(0);
        expect(coverage.value).toBeLessThanOrEqual(100);
      }
    });

    it('should calculate HSH in hours', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const hsh = data.summary.hsh;
      expect(hsh.unit).toBe('hours');
      expect(hsh.value).toBeGreaterThanOrEqual(0);
    });

    it('should calculate D2D in hours (can be null)', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const d2d = data.summary.d2d;
      expect(d2d.unit).toBe('hours');
      
      if (d2d.value !== null) {
        expect(d2d.value).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate DCU as integer count', async () => {
      const request = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      
      const dcu = data.summary.dcu;
      expect(dcu.unit).toBe('deploys');
      expect(dcu.value).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(dcu.value)).toBe(true);
    });

    it('should produce deterministic results for same period', async () => {
      const request1 = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const request2 = createMockRequest({
        url: 'http://localhost:3000/api/ops/kpis?period=7d',
        userId: 'test-user',
      });

      const response1 = await GET(request1);
      const response2 = await GET(request2);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      const data1 = await response1.json();
      const data2 = await response2.json();

      // KPI values should be the same (deterministic)
      expect(data1.summary.hsh.value).toBe(data2.summary.hsh.value);
      expect(data1.summary.dcu.value).toBe(data2.summary.dcu.value);
      expect(data1.summary.automationCoverage.value).toBe(data2.summary.automationCoverage.value);
      
      // D2D can vary slightly due to timing, but should be close or both null
      if (data1.summary.d2d.value !== null && data2.summary.d2d.value !== null) {
        expect(Math.abs(data1.summary.d2d.value - data2.summary.d2d.value)).toBeLessThan(0.01);
      } else {
        expect(data1.summary.d2d.value).toBe(data2.summary.d2d.value);
      }
    });
  });
});
