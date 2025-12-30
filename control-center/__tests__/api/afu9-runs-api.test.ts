/**
 * AFU9 Runs API Tests
 * 
 * Tests all endpoints for the AFU9 Runs API:
 * - GET /api/playbooks (list playbooks)
 * - GET /api/issues/[id]/runs (list runs for issue)
 * - POST /api/issues/[id]/runs (create run)
 * - GET /api/runs/[runId] (get run details)
 * - POST /api/runs/[runId]/execute (execute run)
 * - POST /api/runs/[runId]/rerun (rerun)
 * 
 * Reference: I633 (Issue UI Runs Tab)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET as listPlaybooks } from '../../app/api/playbooks/route';
import { GET as listRuns, POST as createRun } from '../../app/api/issues/[id]/runs/route';
import { GET as getRunDetail } from '../../app/api/runs/[runId]/route';
import { POST as executeRun } from '../../app/api/runs/[runId]/execute/route';
import { POST as rerunRun } from '../../app/api/runs/[runId]/rerun/route';

// Mock the database module
jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({
    query: jest.fn(),
    connect: jest.fn(() => ({
      query: jest.fn(),
      release: jest.fn(),
    })),
  })),
}));

// Mock RunsDAO
jest.mock('../../src/lib/db/afu9Runs', () => ({
  getRunsDAO: jest.fn(() => ({
    listRunsByIssue: jest.fn(),
    getRun: jest.fn(),
    reconstructRunResult: jest.fn(),
    createRun: jest.fn(),
  })),
}));

// Mock RunnerService
jest.mock('../../src/lib/runner-service', () => ({
  getRunnerService: jest.fn(() => ({
    listPlaybooks: jest.fn(),
    getPlaybook: jest.fn(),
    createRun: jest.fn(),
    executeRun: jest.fn(),
    getRunResult: jest.fn(),
    rerun: jest.fn(),
  })),
}));

describe('AFU9 Runs API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/playbooks', () => {
    test('returns list of playbooks', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();
      
      mockService.listPlaybooks.mockResolvedValue([
        { id: 'hello-world', name: 'Hello World', description: 'Simple example' },
        { id: 'multi-step', name: 'Multi-Step Build' },
      ]);

      const request = new NextRequest('http://localhost/api/playbooks');
      const response = await listPlaybooks(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.playbooks).toBeDefined();
      expect(Array.isArray(body.playbooks)).toBe(true);
      expect(body.playbooks.length).toBe(2);
      expect(body.playbooks[0].id).toBe('hello-world');
      expect(body.playbooks[0].name).toBe('Hello World');
    });
  });

  describe('GET /api/issues/[id]/runs', () => {
    test('returns list of runs for issue', async () => {
      const { getRunsDAO } = require('../../src/lib/db/afu9Runs');
      const mockDAO = getRunsDAO();

      mockDAO.listRunsByIssue.mockResolvedValue([
        {
          runId: 'run-123',
          title: 'Test Run',
          status: 'SUCCEEDED',
          createdAt: '2023-12-23T00:00:00Z',
          startedAt: '2023-12-23T00:01:00Z',
          finishedAt: '2023-12-23T00:02:00Z',
          playbookId: 'hello-world',
          parentRunId: null,
        },
      ]);

      const request = new NextRequest('http://localhost/api/issues/issue-123/runs');
      const params = Promise.resolve({ id: 'issue-123' });
      const response = await listRuns(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.runs).toBeDefined();
      expect(Array.isArray(body.runs)).toBe(true);
      expect(body.runs.length).toBe(1);
      expect(body.runs[0].runId).toBe('run-123');
      expect(body.runs[0].status).toBe('SUCCEEDED');
    });

    test('respects limit and offset parameters', async () => {
      const { getRunsDAO } = require('../../src/lib/db/afu9Runs');
      const mockDAO = getRunsDAO();

      mockDAO.listRunsByIssue.mockResolvedValue([]);

      const request = new NextRequest('http://localhost/api/issues/issue-123/runs?limit=10&offset=5');
      const params = Promise.resolve({ id: 'issue-123' });
      await listRuns(request, { params });

      expect(mockDAO.listRunsByIssue).toHaveBeenCalledWith('issue-123', 10, 5);
    });

    test('enforces maximum limit of 100', async () => {
      const { getRunsDAO } = require('../../src/lib/db/afu9Runs');
      const mockDAO = getRunsDAO();

      mockDAO.listRunsByIssue.mockResolvedValue([]);

      const request = new NextRequest('http://localhost/api/issues/issue-123/runs?limit=500');
      const params = Promise.resolve({ id: 'issue-123' });
      await listRuns(request, { params });

      expect(mockDAO.listRunsByIssue).toHaveBeenCalledWith('issue-123', 100, 0);
    });
  });

  describe('POST /api/issues/[id]/runs', () => {
    test('creates run from playbook', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.getPlaybook.mockResolvedValue({
        id: 'hello-world',
        name: 'Hello World',
        spec: {
          title: 'Hello World Run',
          runtime: 'dummy',
          steps: [{ name: 'Step 1', shell: 'bash', command: 'echo hello' }],
        },
      });

      mockService.createRun.mockResolvedValue('run-123');
      mockService.executeRun.mockResolvedValue({
        runId: 'run-123',
        status: 'running',
      });

      const request = new NextRequest('http://localhost/api/issues/issue-123/runs', {
        method: 'POST',
        body: JSON.stringify({ playbookId: 'hello-world', autoExecute: true }),
      });
      const params = Promise.resolve({ id: 'issue-123' });
      const response = await createRun(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.runId).toBe('run-123');
      expect(body.status).toBe('executing');
      expect(mockService.createRun).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Hello World Run' }),
        'issue-123',
        'hello-world',
        undefined
      );
    });

    test('returns 404 for non-existent playbook', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.getPlaybook.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/issues/issue-123/runs', {
        method: 'POST',
        body: JSON.stringify({ playbookId: 'non-existent' }),
      });
      const params = Promise.resolve({ id: 'issue-123' });
      const response = await createRun(request, { params });

      expect(response.status).toBe(404);
    });

    test('requires playbookId or spec', async () => {
      const request = new NextRequest('http://localhost/api/issues/issue-123/runs', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const params = Promise.resolve({ id: 'issue-123' });
      const response = await createRun(request, { params });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/runs/[runId]', () => {
    test('returns run details', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      const mockRunResult = {
        runId: 'run-123',
        title: 'Test Run',
        runtime: 'dummy',
        status: 'success',
        steps: [
          {
            name: 'Step 1',
            status: 'success',
            exitCode: 0,
            stdout: 'Output',
          },
        ],
        createdAt: '2023-12-23T00:00:00Z',
        startedAt: '2023-12-23T00:01:00Z',
        completedAt: '2023-12-23T00:02:00Z',
        durationMs: 60000,
      };

      mockService.getRunResult.mockResolvedValue(mockRunResult);

      const request = new NextRequest('http://localhost/api/runs/run-123');
      const params = Promise.resolve({ runId: 'run-123' });
      const response = await getRunDetail(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.runId).toBe('run-123');
      expect(body.status).toBe('success');
      expect(body.steps).toBeDefined();
      expect(body.steps.length).toBe(1);
    });

    test('returns 404 for non-existent run', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.getRunResult.mockResolvedValue(null);

      const request = new NextRequest('http://localhost/api/runs/non-existent');
      const params = Promise.resolve({ runId: 'non-existent' });
      const response = await getRunDetail(request, { params });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/runs/[runId]/execute', () => {
    test('starts run execution', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.executeRun.mockResolvedValue({
        runId: 'run-123',
        status: 'running',
      });

      const request = new NextRequest('http://localhost/api/runs/run-123/execute', {
        method: 'POST',
      });
      const params = Promise.resolve({ runId: 'run-123' });
      const response = await executeRun(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.runId).toBe('run-123');
      expect(body.status).toBe('executing');
    });
  });

  describe('POST /api/runs/[runId]/rerun', () => {
    test('creates and executes re-run', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.rerun.mockResolvedValue('run-456');
      mockService.executeRun.mockResolvedValue({
        runId: 'run-456',
        status: 'running',
      });

      const request = new NextRequest('http://localhost/api/runs/run-123/rerun', {
        method: 'POST',
        body: JSON.stringify({ autoExecute: true }),
      });
      const params = Promise.resolve({ runId: 'run-123' });
      const response = await rerunRun(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.newRunId).toBe('run-456');
      expect(body.parentRunId).toBe('run-123');
      expect(body.status).toBe('executing');
      expect(mockService.rerun).toHaveBeenCalledWith('run-123');
    });

    test('creates re-run without auto-execution', async () => {
      const { getRunnerService } = require('../../src/lib/runner-service');
      const mockService = getRunnerService();

      mockService.rerun.mockResolvedValue('run-456');

      const request = new NextRequest('http://localhost/api/runs/run-123/rerun', {
        method: 'POST',
        body: JSON.stringify({ autoExecute: false }),
      });
      const params = Promise.resolve({ runId: 'run-123' });
      const response = await rerunRun(request, { params });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.newRunId).toBe('run-456');
      expect(body.status).toBe('created');
      expect(mockService.executeRun).not.toHaveBeenCalled();
    });
  });
});
