/**
 * Tests for E64.1: GitHub Runner Adapter API Routes
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

describe('E64.1: GitHub Runner API Routes', () => {
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

  describe('POST /api/integrations/github/runner/dispatch', () => {
    it('should dispatch workflow successfully', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      
      dispatchWorkflow.mockResolvedValue({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'run-record-123',
        isExisting: false,
      });

      const { dispatchRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-123',
          inputs: { key: 'value' },
        }),
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.runId).toBe(123456);
      expect(body.runUrl).toBe('https://github.com/owner/repo/actions/runs/123456');
      expect(body.isExisting).toBe(false);
      expect(body.message).toContain('dispatched successfully');
    });

    it('should return existing run (idempotent)', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      
      dispatchWorkflow.mockResolvedValue({
        runId: 789012,
        runUrl: 'https://github.com/owner/repo/actions/runs/789012',
        recordId: 'run-record-456',
        isExisting: true,
      });

      const { dispatchRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-456',
        }),
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.isExisting).toBe(true);
      expect(body.message).toContain('existing');
    });

    it('should return 400 for missing required fields', async () => {
      const { dispatchRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          // Missing repo, workflowIdOrFile, ref
        }),
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 400 for missing correlationId', async () => {
      const { dispatchRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
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
      expect(body.error).toContain('correlationId');
    });

    it('should return 500 on adapter error', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      
      dispatchWorkflow.mockRejectedValue(new Error('GitHub API error'));

      const { dispatchRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-789',
        }),
      });

      const response = await dispatchRoute(request);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toContain('Failed to dispatch workflow');
      expect(body.details).toContain('GitHub API error');
    });
  });

  describe('POST /api/integrations/github/runner/poll', () => {
    it('should poll workflow run successfully', async () => {
      const { pollRun } = require('../../src/lib/github-runner/adapter');
      
      pollRun.mockResolvedValue({
        runId: 123456,
        status: 'in_progress',
        conclusion: null,
        normalizedStatus: 'RUNNING',
        updatedAt: '2024-01-01T12:05:00Z',
        createdAt: '2024-01-01T12:00:00Z',
        runStartedAt: '2024-01-01T12:01:00Z',
      });

      const { pollRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/poll', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          runId: 123456,
        }),
      });

      const response = await pollRoute(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.runId).toBe(123456);
      expect(body.status).toBe('in_progress');
      expect(body.normalizedStatus).toBe('RUNNING');
    });

    it('should return 400 for missing required fields', async () => {
      const { pollRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/poll', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          // Missing repo and runId
        }),
      });

      const response = await pollRoute(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 500 on adapter error', async () => {
      const { pollRun } = require('../../src/lib/github-runner/adapter');
      
      pollRun.mockRejectedValue(new Error('Run not found'));

      const { pollRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/poll', {
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
      expect(body.error).toContain('Failed to poll workflow run');
    });
  });

  describe('POST /api/integrations/github/runner/ingest', () => {
    it('should ingest workflow run successfully', async () => {
      const { ingestRun } = require('../../src/lib/github-runner/adapter');
      
      ingestRun.mockResolvedValue({
        runId: 123456,
        recordId: 'run-record-123',
        summary: {
          status: 'completed',
          conclusion: 'success',
          totalJobs: 2,
          successfulJobs: 2,
          failedJobs: 0,
          durationMs: 300000,
        },
        jobs: [
          {
            id: 1,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2024-01-01T12:01:00Z',
            completedAt: '2024-01-01T12:05:00Z',
            stepCount: 3,
          },
        ],
        artifacts: [
          {
            id: 100,
            name: 'build-output',
            sizeInBytes: 1024,
            downloadUrl: 'https://api.github.com/artifacts/100/zip',
            createdAt: '2024-01-01T12:05:00Z',
            expiresAt: '2024-02-01T12:05:00Z',
          },
        ],
        annotations: [],
        logsUrl: 'https://api.github.com/repos/owner/repo/actions/runs/123456/logs',
      });

      const { ingestRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/ingest', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          runId: 123456,
        }),
      });

      const response = await ingestRoute(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.runId).toBe(123456);
      expect(body.summary.totalJobs).toBe(2);
      expect(body.jobs).toHaveLength(1);
      expect(body.artifacts).toHaveLength(1);
    });

    it('should return 400 for missing required fields', async () => {
      const { ingestRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/ingest', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          // Missing repo and runId
        }),
      });

      const response = await ingestRoute(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toContain('Missing required fields');
    });

    it('should return 500 on adapter error', async () => {
      const { ingestRun } = require('../../src/lib/github-runner/adapter');
      
      ingestRun.mockRejectedValue(new Error('No run record found'));

      const { ingestRoute } = getRoutes();
      const request = new NextRequest('http://localhost/api/integrations/github/runner/ingest', {
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
      expect(body.error).toContain('Failed to ingest workflow run');
    });
  });
});
