/**
 * Playbook Executor Integration Tests
 * 
 * Tests playbook execution logic including HTTP checks, retries, and error handling.
 * 
 * Reference: E65.2 (Post-Deploy Verification Playbook)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import { executePlaybook, getPlaybookRunResult } from '../../src/lib/playbook-executor';
import { PlaybookDefinition } from '../../src/lib/contracts/playbook';

// Mock fetch
global.fetch = jest.fn();

// Mock database pool
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(),
} as unknown as Pool;

describe('Playbook Executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
    
    // Default mock responses for database operations
    // Mock sequence: insertPlaybookRun, updatePlaybookRunStatus, insertPlaybookRunStep, updatePlaybookRunStepStatus, updatePlaybookRunStatus (final)
    mockPool.query = jest.fn()
      .mockResolvedValueOnce({ 
        rows: [{ 
          id: 'run-123', 
          playbook_id: 'test',
          playbook_version: '1.0.0',
          env: 'stage',
          status: 'pending',
          started_at: null,
          completed_at: null,
          summary: null,
          created_at: new Date().toISOString() 
        }] 
      })
      .mockResolvedValueOnce({ rows: [] }) // updatePlaybookRunStatus (to running)
      .mockResolvedValueOnce({ 
        rows: [{ 
          id: 'step-123', 
          run_id: 'run-123',
          step_id: 'health-check',
          step_index: 0,
          status: 'pending',
          started_at: null,
          completed_at: null,
          evidence: null,
          error: null,
          created_at: new Date().toISOString()
        }] 
      })
      .mockResolvedValueOnce({ rows: [] }) // updatePlaybookRunStepStatus (to running)
      .mockResolvedValueOnce({ rows: [] }) // updatePlaybookRunStepStatus (to success/failed)
      .mockResolvedValueOnce({ rows: [] }); // updatePlaybookRunStatus (final)
  });

  describe('HTTP Check Execution', () => {
    test('successful HTTP check creates success evidence', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com/health',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: async () => '{"status":"ok"}',
      });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.status).toBe('success');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].status).toBe('success');
      expect(result.steps[0].evidence?.type).toBe('http_check');
      expect(result.steps[0].error).toBeNull();
    });

    test('failed HTTP check due to status mismatch', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com/health',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error?.code).toBe('STATUS_MISMATCH');
    });

    test('failed HTTP check due to body mismatch', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com/health',
              method: 'GET',
              expectedStatus: 200,
              expectedBodyIncludes: '"status":"ok"',
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: async () => '{"status":"degraded"}',
      });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].error?.code).toBe('BODY_MISMATCH');
    });
  });

  describe('Retry Logic', () => {
    test('retries failed step and eventually succeeds', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 2,
            input: {
              type: 'http_check',
              url: 'https://example.com/health',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          status: 503,
          text: async () => 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          status: 503,
          text: async () => 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          status: 200,
          text: async () => '{"status":"ok"}',
        });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.status).toBe('success');
      expect(result.steps[0].status).toBe('success');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('exhausts retries and fails', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 2,
            input: {
              type: 'http_check',
              url: 'https://example.com/health',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 503,
        text: async () => 'Service Unavailable',
      });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.status).toBe('failed');
      expect(result.steps[0].status).toBe('failed');
      expect(global.fetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });

  describe('Variable Substitution', () => {
    test('substitutes variables in URL', async () => {
      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'health-check',
            title: 'Health Check',
            retries: 0,
            input: {
              type: 'http_check',
              url: '${DEPLOY_URL}/health',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: async () => '{"status":"ok"}',
      });

      await executePlaybook(mockPool, playbook, 'stage', {
        DEPLOY_URL: 'https://stage.example.com',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://stage.example.com/health',
        expect.any(Object)
      );
    });
  });

  describe('Summary Calculation', () => {
    test('calculates correct summary for successful run', async () => {
      // Need extra mocks for second step (2 steps total = extra insert + 2 updates)
      mockPool.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'run-123', playbook_id: 'test', playbook_version: '1.0.0', env: 'stage', status: 'pending', started_at: null, completed_at: null, summary: null, created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({ rows: [] }) // update run to running
        .mockResolvedValueOnce({ rows: [{ id: 'step-1', run_id: 'run-123', step_id: 'step1', step_index: 0, status: 'pending', started_at: null, completed_at: null, evidence: null, error: null, created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({ rows: [] }) // update step1 to running
        .mockResolvedValueOnce({ rows: [] }) // update step1 to success
        .mockResolvedValueOnce({ rows: [{ id: 'step-2', run_id: 'run-123', step_id: 'step2', step_index: 1, status: 'pending', started_at: null, completed_at: null, evidence: null, error: null, created_at: new Date().toISOString() }] })
        .mockResolvedValueOnce({ rows: [] }) // update step2 to running
        .mockResolvedValueOnce({ rows: [] }) // update step2 to success
        .mockResolvedValueOnce({ rows: [] }); // final run status update

      const playbook: PlaybookDefinition = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '1.0.0',
          environments: ['stage'],
        },
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com/1',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
          {
            id: 'step2',
            title: 'Step 2',
            retries: 0,
            input: {
              type: 'http_check',
              url: 'https://example.com/2',
              method: 'GET',
              expectedStatus: 200,
              timeoutSeconds: 10,
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        status: 200,
        text: async () => '{"status":"ok"}',
      });

      const result = await executePlaybook(mockPool, playbook, 'stage', {});

      expect(result.summary?.totalSteps).toBe(2);
      expect(result.summary?.successCount).toBe(2);
      expect(result.summary?.failedCount).toBe(0);
      expect(result.summary?.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
