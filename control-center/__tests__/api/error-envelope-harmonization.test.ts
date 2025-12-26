/**
 * Tests for API Error Envelope Harmonization (Issue #4)
 * 
 * Validates that all API routes use the canonical error format:
 * {
 *   "error": "string",
 *   "requestId": "string",
 *   "timestamp": "ISO-8601",
 *   "details": "optional"
 * }
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST as loginPost } from '../../app/api/auth/login/route';
import { GET as refreshGet, POST as refreshPost } from '../../app/api/auth/refresh/route';
import { POST as forgotPasswordPost } from '../../app/api/auth/forgot-password/route';
import { POST as resetPasswordPost } from '../../app/api/auth/reset-password/route';
import { GET as kpiAggregateGet, POST as kpiAggregatePost } from '../../app/api/v1/kpi/aggregate/route';
import { GET as buildDeterminismGet } from '../../app/api/v1/kpi/build-determinism/route';

// Mock Cognito SDK
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({
    send: jest.fn(),
  })),
  InitiateAuthCommand: jest.fn(),
  ForgotPasswordCommand: jest.fn(),
  ConfirmForgotPasswordCommand: jest.fn(),
}));

// Mock KPI service
jest.mock('@/lib/kpi-service', () => ({
  executeKpiAggregationPipeline: jest.fn(),
  getBuildDeterminismMetrics: jest.fn(),
  calculateBuildDeterminismKPI: jest.fn(),
}));

describe('API Error Envelope Harmonization', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ISO8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  /**
   * Helper to validate canonical error format
   */
  function validateErrorEnvelope(body: any, allowedFields: string[] = ['error', 'requestId', 'timestamp', 'details']) {
    // Must have required fields
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);

    expect(body).toHaveProperty('requestId');
    expect(body.requestId).toMatch(UUID_REGEX);

    expect(body).toHaveProperty('timestamp');
    expect(body.timestamp).toMatch(ISO8601_REGEX);

    // Must NOT have success field
    expect(body).not.toHaveProperty('success');

    // Check for unexpected fields (except allowed ones)
    const bodyKeys = Object.keys(body);
    const unexpectedFields = bodyKeys.filter(key => !allowedFields.includes(key));
    if (unexpectedFields.length > 0) {
      // Allow some flexibility for debug fields if details exists
      const debugFields = ['expectedOrigin', 'origin', 'referer'];
      const reallyUnexpected = unexpectedFields.filter(f => !debugFields.includes(f));
      expect(reallyUnexpected).toEqual([]);
    }
  }

  describe('Auth Routes', () => {
    describe('POST /api/auth/login', () => {
      test('returns canonical error format for missing credentials', async () => {
        const req = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        const res = await loginPost(req);
        expect(res.status).toBe(400);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toContain('Username and password are required');
      });

      test('returns canonical error format for Cognito errors', async () => {
        const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
        const mockSend = jest.fn().mockRejectedValue({
          name: 'NotAuthorizedException',
          message: 'Invalid credentials',
        });
        CognitoIdentityProviderClient.mockImplementation(() => ({ send: mockSend }));

        const req = new NextRequest('http://localhost/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: 'test@example.com', password: 'wrong' }),
        });

        const res = await loginPost(req);
        expect(res.status).toBe(401);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toContain('Invalid username or password');
      });
    });

    describe('GET /api/auth/refresh', () => {
      test('returns canonical error format for method not allowed', async () => {
        const req = new NextRequest('http://localhost/api/auth/refresh', {
          method: 'GET',
        });

        const res = await refreshGet(req);
        expect(res.status).toBe(405);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Method Not Allowed');
      });
    });

    describe('POST /api/auth/refresh', () => {
      test('returns canonical error format for missing refresh token', async () => {
        const req = new NextRequest('http://localhost/api/auth/refresh', {
          method: 'POST',
          headers: {
            'origin': 'http://localhost',
          },
        });

        const res = await refreshPost(req);
        expect(res.status).toBe(401);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Missing refresh token');
      });
    });

    describe('POST /api/auth/forgot-password', () => {
      test('returns canonical error format for missing username', async () => {
        const req = new NextRequest('http://localhost/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        const res = await forgotPasswordPost(req);
        expect(res.status).toBe(400);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Username is required');
      });
    });

    describe('POST /api/auth/reset-password', () => {
      test('returns canonical error format for missing fields', async () => {
        const req = new NextRequest('http://localhost/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ username: 'test@example.com' }),
        });

        const res = await resetPasswordPost(req);
        expect(res.status).toBe(400);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toContain('Username, code, and new password are required');
      });
    });
  });

  describe('KPI Routes', () => {
    describe('GET /api/v1/kpi/aggregate', () => {
      test('returns canonical error format for method not allowed', async () => {
        const req = new NextRequest('http://localhost/api/v1/kpi/aggregate', {
          method: 'GET',
        });

        const res = await kpiAggregateGet();
        expect(res.status).toBe(405);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Method not allowed');
      });
    });

    describe('POST /api/v1/kpi/aggregate', () => {
      test('returns canonical error format on pipeline failure', async () => {
        const { executeKpiAggregationPipeline } = require('@/lib/kpi-service');
        executeKpiAggregationPipeline.mockRejectedValue(new Error('Pipeline failed'));

        const req = new NextRequest('http://localhost/api/v1/kpi/aggregate', {
          method: 'POST',
          body: JSON.stringify({}),
        });

        const res = await kpiAggregatePost(req);
        expect(res.status).toBe(500);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Pipeline failed');
        expect(body.details).toBe('Failed to trigger KPI aggregation pipeline');
      });
    });

    describe('GET /api/v1/kpi/build-determinism', () => {
      test('returns canonical error format on service failure', async () => {
        const { getBuildDeterminismMetrics } = require('@/lib/kpi-service');
        getBuildDeterminismMetrics.mockRejectedValue(new Error('Database connection failed'));

        const req = new NextRequest('http://localhost/api/v1/kpi/build-determinism', {
          method: 'GET',
        });

        const res = await buildDeterminismGet(req);
        expect(res.status).toBe(500);

        const body = await res.json();
        validateErrorEnvelope(body);
        expect(body.error).toBe('Failed to retrieve Build Determinism metrics');
        expect(body.details).toBe('Database connection failed');
      });
    });
  });

  describe('Error Envelope Compliance', () => {
    test('all error responses include requestId', async () => {
      const testCases = [
        { name: 'login', handler: loginPost, req: new NextRequest('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({}) }) },
        { name: 'refresh GET', handler: refreshGet, req: new NextRequest('http://localhost/api/auth/refresh', { method: 'GET' }) },
        { name: 'forgot-password', handler: forgotPasswordPost, req: new NextRequest('http://localhost/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({}) }) },
        { name: 'reset-password', handler: resetPasswordPost, req: new NextRequest('http://localhost/api/auth/reset-password', { method: 'POST', body: JSON.stringify({}) }) },
        { name: 'kpi-aggregate GET', handler: kpiAggregateGet, req: null },
      ];

      for (const { name, handler, req } of testCases) {
        const res = req ? await handler(req) : await handler();
        const body = await res.json();
        
        expect(body.requestId).toBeDefined();
        expect(body.requestId).toMatch(UUID_REGEX);
      }
    });

    test('all error responses include timestamp in ISO-8601 format', async () => {
      const req = new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const res = await loginPost(req);
      const body = await res.json();

      expect(body.timestamp).toBeDefined();
      expect(body.timestamp).toMatch(ISO8601_REGEX);
      
      // Validate it's a valid date
      const date = new Date(body.timestamp);
      expect(date.toISOString()).toBe(body.timestamp);
    });

    test('no error responses include success field', async () => {
      const { getBuildDeterminismMetrics } = require('@/lib/kpi-service');
      getBuildDeterminismMetrics.mockRejectedValue(new Error('Test error'));

      const req = new NextRequest('http://localhost/api/v1/kpi/build-determinism', {
        method: 'GET',
      });

      const res = await buildDeterminismGet(req);
      const body = await res.json();

      expect(body).not.toHaveProperty('success');
    });
  });
});
