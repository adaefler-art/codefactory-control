/**
 * Deploy Events API Contract Tests
 * 
 * Validates the /api/internal/deploy-events endpoint contract:
 * - 400 for validation errors
 * - 401 for auth errors
 * - 503 for DB disabled or DB operation failures
 * - Never 500 for NOT NULL violations
 * 
 * @jest-environment node
 */

import { POST } from '../../../app/api/internal/deploy-events/route';
import { NextRequest } from 'next/server';

// Mock the database pool
jest.mock('../../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
  })),
}));

describe('Deploy Events API Contract', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Status Code Contract', () => {
    test('returns 503 when DATABASE_ENABLED=false', async () => {
      process.env.DATABASE_ENABLED = 'false';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('DB disabled');
    });

    test('returns 401 when token is missing', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 401 when token is incorrect', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'wrong-token',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    test('returns 400 when JSON is invalid', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: 'invalid json',
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Invalid JSON');
    });

    test('returns 400 when required field is missing', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: 'production',
          // Missing service, version, commit_hash, status
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
      expect(body.errors).toBeDefined();
      expect(Array.isArray(body.errors)).toBe(true);
    });

    test('returns 400 when required field is empty', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: '',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
      expect(body.required).toContain('env');
    });

    test('returns 400 when field exceeds max length', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: 'a'.repeat(100), // Exceeds max length of 32
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe('Validation failed');
      expect(body.errors.some((e: any) => e.field === 'env')).toBe(true);
    });

    test('returns 503 when database operation fails', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      // Mock database error
      const { getPool } = require('../../../src/lib/db');
      getPool.mockReturnValue({
        query: jest.fn().mockRejectedValue(new Error('Connection failed')),
      });

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body.error).toBe('Database operation failed');
    });

    test('returns 200 with event data on success', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      // Mock successful insert
      const mockEvent = {
        id: 'test-uuid',
        created_at: '2023-12-23T00:00:00Z',
        env: 'production',
        service: 'api',
        version: 'v1.0.0',
        commit_hash: 'abc123',
        status: 'success',
        message: null,
      };

      const { getPool } = require('../../../src/lib/db');
      getPool.mockReturnValue({
        query: jest.fn().mockResolvedValue({ rows: [mockEvent] }),
      });

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.event).toBeDefined();
      expect(body.event.id).toBe('test-uuid');
      expect(body.event.env).toBe('production');
    });

    test('accepts optional message field', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const mockEvent = {
        id: 'test-uuid',
        created_at: '2023-12-23T00:00:00Z',
        env: 'production',
        service: 'api',
        version: 'v1.0.0',
        commit_hash: 'abc123',
        status: 'success',
        message: 'Deployment successful',
      };

      const { getPool } = require('../../../src/lib/db');
      getPool.mockReturnValue({
        query: jest.fn().mockResolvedValue({ rows: [mockEvent] }),
      });

      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: 'production',
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
          message: 'Deployment successful',
        }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.event.message).toBe('Deployment successful');
    });
  });

  describe('Critical Guarantee: No 500 for NOT NULL Violations', () => {
    test('missing required fields return 400, never 500', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      const testCases = [
        { env: 'production' }, // Missing other fields
        { service: 'api' }, // Missing other fields
        { version: 'v1.0.0' }, // Missing other fields
        { commit_hash: 'abc123' }, // Missing other fields
        { status: 'success' }, // Missing other fields
      ];

      for (const testCase of testCases) {
        const request = new NextRequest('http://localhost/api/internal/deploy-events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': 'secret-token',
          },
          body: JSON.stringify(testCase),
        });

        const response = await POST(request);
        const body = await response.json();

        // CRITICAL: Must be 400, never 500
        expect(response.status).toBe(400);
        expect(body.error).toBe('Validation failed');
        expect(body.errors).toBeDefined();
      }
    });

    test('validation prevents NOT NULL violation at DB layer', async () => {
      process.env.DATABASE_ENABLED = 'true';
      process.env.DEPLOY_EVENTS_TOKEN = 'secret-token';

      // Even if we try to pass null or undefined
      const request = new NextRequest('http://localhost/api/internal/deploy-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': 'secret-token',
        },
        body: JSON.stringify({
          env: null,
          service: 'api',
          version: 'v1.0.0',
          commit_hash: 'abc123',
          status: 'success',
        }),
      });

      const response = await POST(request);

      // Should fail validation before reaching DB
      expect(response.status).toBe(400);
    });
  });
});
