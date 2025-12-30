/**
 * Playbook API Route Tests
 * 
 * Tests API endpoints for playbook execution and run retrieval.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

// Mock modules before imports
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('../../src/lib/playbook-executor', () => ({
  executePlaybook: jest.fn(),
  getPlaybookRunResult: jest.fn(),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}));

// Now import the route handlers and the mocked modules
import { POST as runPlaybook } from '../../app/api/playbooks/post-deploy-verify/run/route';
import { GET as getPlaybookRun } from '../../app/api/playbooks/runs/[id]/route';

const mockPool = {
  query: jest.fn(),
};

describe('Playbook API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get mocked modules
    const { getPool } = require('../../src/lib/db');
    const { executePlaybook, getPlaybookRunResult } = require('../../src/lib/playbook-executor');
    const fs = require('fs');
    
    (getPool as jest.Mock).mockReturnValue(mockPool);
    
    // Mock playbook file loading
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
      metadata: {
        id: 'post-deploy-verify',
        name: 'Post-Deploy Verification',
        version: '1.0.0',
        environments: ['stage', 'prod'],
      },
      steps: [
        {
          id: 'health-check',
          title: 'Health Check',
          retries: 2,
          input: {
            type: 'http_check',
            url: '${DEPLOY_URL}/api/health',
            method: 'GET',
            expectedStatus: 200,
          },
        },
      ],
    }));
  });

  describe('POST /api/playbooks/post-deploy-verify/run', () => {
    test('executes playbook for stage environment', async () => {
      const { executePlaybook } = require('../../src/lib/playbook-executor');
      
      (executePlaybook as jest.Mock).mockResolvedValue({
        id: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'success',
        startedAt: '2023-12-30T12:00:00Z',
        completedAt: '2023-12-30T12:01:00Z',
        summary: {
          totalSteps: 1,
          successCount: 1,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 60000,
        },
        steps: [],
        createdAt: '2023-12-30T11:59:00Z',
      });

      const request = new NextRequest('http://localhost/api/playbooks/post-deploy-verify/run?env=stage', {
        method: 'POST',
        body: JSON.stringify({ variables: { DEPLOY_URL: 'https://stage.example.com' } }),
      });

      const response = await runPlaybook(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('run-123');
      expect(body.status).toBe('success');
      expect(body.env).toBe('stage');
    });

    test('rejects invalid environment parameter', async () => {
      const request = new NextRequest('http://localhost/api/playbooks/post-deploy-verify/run?env=invalid', {
        method: 'POST',
      });

      const response = await runPlaybook(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid environment parameter');
    });

    test('requires environment parameter', async () => {
      const request = new NextRequest('http://localhost/api/playbooks/post-deploy-verify/run', {
        method: 'POST',
      });

      const response = await runPlaybook(request);
      const body = await response.json();

      expect(response.status).toBe(400);
    });

    test('includes x-request-id in response', async () => {
      const { executePlaybook } = require('../../src/lib/playbook-executor');
      
      (executePlaybook as jest.Mock).mockResolvedValue({
        id: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'success',
        startedAt: '2023-12-30T12:00:00Z',
        completedAt: '2023-12-30T12:01:00Z',
        summary: null,
        steps: [],
        createdAt: '2023-12-30T11:59:00Z',
      });

      const headers = new Headers();
      headers.set('x-request-id', 'test-123');

      const request = new NextRequest('http://localhost/api/playbooks/post-deploy-verify/run?env=stage', {
        method: 'POST',
        headers,
      });

      const response = await runPlaybook(request);

      expect(response.headers.get('x-request-id')).toBe('test-123');
    });
  });

  describe('GET /api/playbooks/runs/:id', () => {
    test('returns playbook run details', async () => {
      const { getPlaybookRunResult } = require('../../src/lib/playbook-executor');
      
      (getPlaybookRunResult as jest.Mock).mockResolvedValue({
        id: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'success',
        startedAt: '2023-12-30T12:00:00Z',
        completedAt: '2023-12-30T12:01:00Z',
        summary: {
          totalSteps: 1,
          successCount: 1,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 60000,
        },
        steps: [
          {
            stepId: 'health-check',
            stepIndex: 0,
            status: 'success',
            startedAt: '2023-12-30T12:00:00Z',
            completedAt: '2023-12-30T12:00:10Z',
            evidence: {
              type: 'http_check',
              status: 200,
              responseTime: 123,
            },
            error: null,
          },
        ],
        createdAt: '2023-12-30T11:59:00Z',
      });

      const request = new NextRequest('http://localhost/api/playbooks/runs/run-123');
      const response = await getPlaybookRun(request, { params: { id: 'run-123' } });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.id).toBe('run-123');
      expect(body.steps).toHaveLength(1);
    });

    test('returns 404 for non-existent run', async () => {
      const { getPlaybookRunResult } = require('../../src/lib/playbook-executor');
      
      (getPlaybookRunResult as jest.Mock).mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/playbooks/runs/non-existent');
      const response = await getPlaybookRun(request, { params: { id: 'non-existent' } });
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body.error).toContain('not found');
    });

    test('includes x-request-id in response', async () => {
      const { getPlaybookRunResult } = require('../../src/lib/playbook-executor');
      
      (getPlaybookRunResult as jest.Mock).mockResolvedValue({
        id: 'run-123',
        playbookId: 'post-deploy-verify',
        playbookVersion: '1.0.0',
        env: 'stage',
        status: 'success',
        startedAt: null,
        completedAt: null,
        summary: null,
        steps: [],
        createdAt: '2023-12-30T11:59:00Z',
      });

      const headers = new Headers();
      headers.set('x-request-id', 'test-456');

      const request = new NextRequest('http://localhost/api/playbooks/runs/run-123', {
        headers,
      });
      const response = await getPlaybookRun(request, { params: { id: 'run-123' } });

      expect(response.headers.get('x-request-id')).toBe('test-456');
    });
  });
});
