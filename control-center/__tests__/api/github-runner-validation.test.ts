/**
 * E64.1: Additional Validation Tests for GitHub Runner Adapter API Routes
 * Testing request validation, error handling, and edge cases
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

// Mock dependencies
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/github-runner/adapter', () => ({
  dispatchWorkflow: jest.fn(),
  pollRun: jest.fn(),
  ingestRun: jest.fn(),
}));

describe('E64.1: GitHub Runner API Validation Gates', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const getRoutes = () => {
    const dispatchRoute = require('../../app/api/integrations/github/runner/dispatch/route').POST;
    const pollRoute = require('../../app/api/integrations/github/runner/poll/route').POST;
    const ingestRoute = require('../../app/api/integrations/github/runner/ingest/route').POST;
    return { dispatchRoute, pollRoute, ingestRoute };
  };

  const dispatchRoute = (request: NextRequest) => getRoutes().dispatchRoute(request);
  const pollRoute = (request: NextRequest) => getRoutes().pollRoute(request);
  const ingestRoute = (request: NextRequest) => getRoutes().ingestRoute(request);

  const createRequest = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('x-afu9-sub', 'test-user');
    return new NextRequest(url, { ...init, headers });
  };

  describe('Gate 2: API Contract Validation', () => {
    describe('POST /api/integrations/github/runner/dispatch', () => {
      it('should return 400 when owner is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            // Missing owner
            repo: 'test-repo',
            workflowIdOrFile: 'ci.yml',
            ref: 'main',
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
        expect(body.details).toContain('owner');
      });

      it('should return 400 when repo is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            // Missing repo
            workflowIdOrFile: 'ci.yml',
            ref: 'main',
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
        expect(body.details).toContain('repo');
      });

      it('should return 400 when workflowIdOrFile is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            // Missing workflowIdOrFile
            ref: 'main',
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
        expect(body.details).toContain('workflowIdOrFile');
      });

      it('should return 400 when ref is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            workflowIdOrFile: 'ci.yml',
            // Missing ref
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
      });

      it('should return 400 when correlationId is missing (idempotency requirement)', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            workflowIdOrFile: 'ci.yml',
            ref: 'main',
            // Missing correlationId
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing correlationId');
        expect(body.details).toContain('idempotency');
      });

      it('should return 500 on adapter internal error', async () => {
        const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
        dispatchWorkflow.mockRejectedValue(new Error('Internal adapter error'));

        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            workflowIdOrFile: 'ci.yml',
            ref: 'main',
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(500);

        const body = await response.json();
        expect(body.error).toBe('Failed to dispatch workflow');
        expect(body.details).toBe('Internal adapter error');
      });

      it('should validate runId type is number (via adapter)', async () => {
        const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
        dispatchWorkflow.mockResolvedValue({
          runId: 123456,
          runUrl: 'https://github.com/owner/repo/actions/runs/123456',
          recordId: 'rec-123',
          isExisting: false,
        });

        const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            workflowIdOrFile: 'ci.yml',
            ref: 'main',
            correlationId: 'test-123',
          }),
        });

        const response = await dispatchRoute(request);
        expect(response.status).toBe(200);

        const body = await response.json();
        expect(typeof body.runId).toBe('number');
      });
    });

    describe('POST /api/integrations/github/runner/poll', () => {
      it('should return 400 when owner is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/poll', {
          method: 'POST',
          body: JSON.stringify({
            // Missing owner
            repo: 'test-repo',
            runId: 123456,
          }),
        });

        const response = await pollRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
      });

      it('should return 400 when repo is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/poll', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            // Missing repo
            runId: 123456,
          }),
        });

        const response = await pollRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
      });

      it('should return 400 when runId is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/poll', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            // Missing runId
          }),
        });

        const response = await pollRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
        expect(body.details).toContain('runId');
      });

      it('should return 500 on adapter error', async () => {
        const { pollRun } = require('../../src/lib/github-runner/adapter');
        pollRun.mockRejectedValue(new Error('Run not found'));

        const request = createRequest('http://localhost/api/integrations/github/runner/poll', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            runId: 999999,
          }),
        });

        const response = await pollRoute(request);
        expect(response.status).toBe(500);

        const body = await response.json();
        expect(body.error).toBe('Failed to poll workflow run');
        expect(body.details).toContain('Run not found');
      });
    });

    describe('POST /api/integrations/github/runner/ingest', () => {
      it('should return 400 when owner is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/ingest', {
          method: 'POST',
          body: JSON.stringify({
            // Missing owner
            repo: 'test-repo',
            runId: 123456,
          }),
        });

        const response = await ingestRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
      });

      it('should return 400 when repo is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/ingest', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            // Missing repo
            runId: 123456,
          }),
        });

        const response = await ingestRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
      });

      it('should return 400 when runId is missing', async () => {
        const request = createRequest('http://localhost/api/integrations/github/runner/ingest', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            // Missing runId
          }),
        });

        const response = await ingestRoute(request);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toBe('Missing required fields');
        expect(body.details).toContain('runId');
      });

      it('should return 500 when run record not found', async () => {
        const { ingestRun } = require('../../src/lib/github-runner/adapter');
        ingestRun.mockRejectedValue(new Error('No run record found for GitHub run ID 888888'));

        const request = createRequest('http://localhost/api/integrations/github/runner/ingest', {
          method: 'POST',
          body: JSON.stringify({
            owner: 'test-owner',
            repo: 'test-repo',
            runId: 888888,
          }),
        });

        const response = await ingestRoute(request);
        expect(response.status).toBe(500);

        const body = await response.json();
        expect(body.error).toBe('Failed to ingest workflow run');
        expect(body.details).toContain('No run record found');
      });
    });
  });

  describe('Gate 3: Response Shape Validation', () => {
    it('should return consistent success shape for dispatch', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      dispatchWorkflow.mockResolvedValue({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'test-123',
        }),
      });

      const response = await dispatchRoute(request);
      const body = await response.json();

      // Validate response shape
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('runId');
      expect(body).toHaveProperty('runUrl');
      expect(body).toHaveProperty('recordId');
      expect(body).toHaveProperty('isExisting');
      expect(body).toHaveProperty('message');
    });

    it('should return consistent success shape for poll', async () => {
      const { pollRun } = require('../../src/lib/github-runner/adapter');
      pollRun.mockResolvedValue({
        runId: 123456,
        status: 'in_progress',
        conclusion: null,
        normalizedStatus: 'RUNNING',
        updatedAt: '2024-01-01T12:05:00Z',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const request = createRequest('http://localhost/api/integrations/github/runner/poll', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          runId: 123456,
        }),
      });

      const response = await pollRoute(request);
      const body = await response.json();

      // Validate response shape
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('runId');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('conclusion');
      expect(body).toHaveProperty('normalizedStatus');
      expect(body).toHaveProperty('updatedAt');
      expect(body).toHaveProperty('createdAt');
    });

    it('should return consistent success shape for ingest', async () => {
      const { ingestRun } = require('../../src/lib/github-runner/adapter');
      ingestRun.mockResolvedValue({
        runId: 123456,
        recordId: 'rec-123',
        summary: {
          status: 'completed',
          conclusion: 'success',
          totalJobs: 2,
          successfulJobs: 2,
          failedJobs: 0,
          durationMs: 300000,
        },
        jobs: [],
        artifacts: [],
        annotations: [],
        logsUrl: 'https://api.github.com/repos/owner/repo/actions/runs/123456/logs',
      });

      const request = createRequest('http://localhost/api/integrations/github/runner/ingest', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          runId: 123456,
        }),
      });

      const response = await ingestRoute(request);
      const body = await response.json();

      // Validate response shape
      expect(body).toHaveProperty('ok', true);
      expect(body).toHaveProperty('runId');
      expect(body).toHaveProperty('recordId');
      expect(body).toHaveProperty('summary');
      expect(body).toHaveProperty('jobs');
      expect(body).toHaveProperty('artifacts');
      expect(body).toHaveProperty('annotations');
      expect(body).toHaveProperty('logsUrl');
    });

    it('should return consistent error shape on 400 validation errors', async () => {
      const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({}), // Missing all required fields
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(400);

      const body = await response.json();

      // Validate error shape
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('details');
      expect(typeof body.error).toBe('string');
      expect(typeof body.details).toBe('string');
    });

    it('should return consistent error shape on 500 internal errors', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      dispatchWorkflow.mockRejectedValue(new Error('Database connection failed'));

      const request = createRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'test-123',
        }),
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(500);

      const body = await response.json();

      // Validate error shape
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('details');
      expect(typeof body.error).toBe('string');
      expect(typeof body.details).toBe('string');
    });
  });
});
