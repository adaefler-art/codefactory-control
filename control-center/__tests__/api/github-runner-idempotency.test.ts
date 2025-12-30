/**
 * E64.1: Idempotency Tests for GitHub Runner Adapter
 * Gate 3: Testing dispatch idempotency guarantees
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
}));

describe('E64.1: Gate 3 - Idempotency', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const getDispatchRoute = () =>
    require('../../app/api/integrations/github/runner/dispatch/route').POST;

  const dispatchRoute = (request: NextRequest) => getDispatchRoute()(request);

  describe('Dispatch Idempotency', () => {
    it('should return isExisting=true for duplicate dispatch with same correlationId+workflow+repo', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');

      const dispatchRoute = getDispatchRoute();

      // First call: create new run
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const requestBody = {
        owner: 'test-owner',
        repo: 'test-repo',
        workflowIdOrFile: 'ci.yml',
        ref: 'main',
        correlationId: 'issue-456',
      };

      const request1 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      const response1 = await dispatchRoute(request1);
      expect(response1.status).toBe(200);

      const body1 = await response1.json();
      expect(body1.isExisting).toBe(false);
      expect(body1.runId).toBe(123456);

      // Second call: return existing run
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: true,
      });

      const request2 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      const response2 = await dispatchRoute(request2);
      expect(response2.status).toBe(200);

      const body2 = await response2.json();
      expect(body2.isExisting).toBe(true);
      expect(body2.runId).toBe(123456);
      expect(body2.runId).toBe(body1.runId); // Same run ID
      expect(body2.recordId).toBe(body1.recordId); // Same record ID
    });

    it('should create new run when correlationId is different', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');

      const dispatchRoute = getDispatchRoute();

      // First call with correlationId: issue-123
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const request1 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-123',
        }),
      });

      const response1 = await dispatchRoute(request1);
      const body1 = await response1.json();
      expect(body1.isExisting).toBe(false);
      expect(body1.runId).toBe(123456);

      // Second call with different correlationId: issue-456
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 789012,
        runUrl: 'https://github.com/owner/repo/actions/runs/789012',
        recordId: 'rec-456',
        isExisting: false,
      });

      const request2 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-456', // Different correlationId
        }),
      });

      const response2 = await dispatchRoute(request2);
      const body2 = await response2.json();
      expect(body2.isExisting).toBe(false);
      expect(body2.runId).toBe(789012);
      expect(body2.runId).not.toBe(body1.runId); // Different run ID
    });

    it('should create new run when workflow is different', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');

      // First call with workflow: ci.yml
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const request1 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-123',
        }),
      });

      const response1 = await dispatchRoute(request1);
      const body1 = await response1.json();
      expect(body1.isExisting).toBe(false);

      // Second call with different workflow: deploy.yml
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 789012,
        runUrl: 'https://github.com/owner/repo/actions/runs/789012',
        recordId: 'rec-456',
        isExisting: false,
      });

      const request2 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'deploy.yml', // Different workflow
          ref: 'main',
          correlationId: 'issue-123', // Same correlationId
        }),
      });

      const response2 = await dispatchRoute(request2);
      const body2 = await response2.json();
      expect(body2.isExisting).toBe(false);
      expect(body2.runId).not.toBe(body1.runId); // Different run ID
    });

    it('should create new run when repo is different', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');

      // First call with repo: test-repo-1
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 123456,
        runUrl: 'https://github.com/owner/test-repo-1/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const request1 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo-1',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-123',
        }),
      });

      const response1 = await dispatchRoute(request1);
      const body1 = await response1.json();
      expect(body1.isExisting).toBe(false);

      // Second call with different repo: test-repo-2
      dispatchWorkflow.mockResolvedValueOnce({
        runId: 789012,
        runUrl: 'https://github.com/owner/test-repo-2/actions/runs/789012',
        recordId: 'rec-456',
        isExisting: false,
      });

      const request2 = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          owner: 'test-owner',
          repo: 'test-repo-2', // Different repo
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-123', // Same correlationId
        }),
      });

      const response2 = await dispatchRoute(request2);
      const body2 = await response2.json();
      expect(body2.isExisting).toBe(false);
      expect(body2.runId).not.toBe(body1.runId); // Different run ID
    });

    it('should verify adapter is called with correct parameters for idempotency check', async () => {
      const { dispatchWorkflow } = require('../../src/lib/github-runner/adapter');
      const { getPool } = require('../../src/lib/db');

      dispatchWorkflow.mockResolvedValue({
        runId: 123456,
        runUrl: 'https://github.com/owner/repo/actions/runs/123456',
        recordId: 'rec-123',
        isExisting: false,
      });

      const requestBody = {
        owner: 'test-owner',
        repo: 'test-repo',
        workflowIdOrFile: 'ci.yml',
        ref: 'main',
        correlationId: 'issue-789',
        inputs: { env: 'staging' },
        title: 'Test Run',
      };

      const request = new NextRequest('http://localhost/api/integrations/github/runner/dispatch', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      await dispatchRoute(request);

      // Verify adapter was called with correct input
      expect(dispatchWorkflow).toHaveBeenCalledTimes(1);
      expect(dispatchWorkflow).toHaveBeenCalledWith(
        expect.anything(), // pool
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          workflowIdOrFile: 'ci.yml',
          ref: 'main',
          correlationId: 'issue-789',
          inputs: { env: 'staging' },
          title: 'Test Run',
        })
      );
    });
  });
});
