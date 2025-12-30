/**
 * Tests for E64.1: GitHub Runner Adapter
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Pool } from 'pg';
import {
  normalizeGitHubRunStatus,
  type DispatchWorkflowInput,
  type PollRunInput,
  type IngestRunInput,
} from '../../src/lib/github-runner/types';

// Mock dependencies
jest.mock('../../src/lib/github-app-auth', () => ({
  getGitHubInstallationToken: jest.fn(),
}));

jest.mock('../../src/lib/db/githubRuns', () => ({
  findExistingRun: jest.fn(),
  createRunRecord: jest.fn(),
  updateRunStatus: jest.fn(),
  updateRunResult: jest.fn(),
  findRunByGitHubRunId: jest.fn(),
}));

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('E64.1: GitHub Runner Adapter', () => {
  let mockPool: Pool;
  let dispatchWorkflow: typeof import('../../src/lib/github-runner/adapter').dispatchWorkflow;
  let pollRun: typeof import('../../src/lib/github-runner/adapter').pollRun;
  let ingestRun: typeof import('../../src/lib/github-runner/adapter').ingestRun;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPool = { query: jest.fn() } as unknown as Pool;
    
    // Default mock for installation token
    const { getGitHubInstallationToken } = require('../../src/lib/github-app-auth');
    getGitHubInstallationToken.mockResolvedValue({
      token: 'ghs_mock_token',
      expiresAt: '2024-01-01T13:00:00Z',
    });

    // Avoid slow polling delays in unit tests
    process.env.GITHUB_DISPATCH_DELAY_MS = '0';
    process.env.GITHUB_DISPATCH_MAX_RETRIES = '1';

    const adapter = require('../../src/lib/github-runner/adapter');
    dispatchWorkflow = adapter.dispatchWorkflow;
    pollRun = adapter.pollRun;
    ingestRun = adapter.ingestRun;
  });

  describe('normalizeGitHubRunStatus', () => {
    it('should normalize completed/success to SUCCEEDED', () => {
      expect(normalizeGitHubRunStatus('completed', 'success')).toBe('SUCCEEDED');
    });

    it('should normalize completed/neutral to SUCCEEDED', () => {
      expect(normalizeGitHubRunStatus('completed', 'neutral')).toBe('SUCCEEDED');
    });

    it('should normalize completed/cancelled to CANCELLED', () => {
      expect(normalizeGitHubRunStatus('completed', 'cancelled')).toBe('CANCELLED');
    });

    it('should normalize completed/failure to FAILED', () => {
      expect(normalizeGitHubRunStatus('completed', 'failure')).toBe('FAILED');
    });

    it('should normalize in_progress to RUNNING', () => {
      expect(normalizeGitHubRunStatus('in_progress', null)).toBe('RUNNING');
    });

    it('should normalize queued to QUEUED', () => {
      expect(normalizeGitHubRunStatus('queued', null)).toBe('QUEUED');
    });
  });

  describe('dispatchWorkflow', () => {
    it('should return existing run if already dispatched (idempotent)', async () => {
      const { findExistingRun } = require('../../src/lib/db/githubRuns');
      
      findExistingRun.mockResolvedValue({
        id: 'run-record-123',
        githubRunId: 456789,
        runUrl: 'https://github.com/owner/repo/actions/runs/456789',
        status: 'RUNNING',
      });

      const input: DispatchWorkflowInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        workflowIdOrFile: 'ci.yml',
        ref: 'main',
        correlationId: 'issue-123',
      };

      const result = await dispatchWorkflow(mockPool, input);

      expect(result.isExisting).toBe(true);
      expect(result.runId).toBe(456789);
      expect(result.recordId).toBe('run-record-123');
      expect(findExistingRun).toHaveBeenCalledWith(
        mockPool,
        'issue-123',
        'ci.yml',
        'test-owner/test-repo'
      );
    });

    it('should dispatch new workflow when no existing run', async () => {
      const { findExistingRun, createRunRecord } = require('../../src/lib/db/githubRuns');
      
      findExistingRun.mockResolvedValue(null);
      createRunRecord.mockResolvedValue({
        id: 'run-record-new',
        githubRunId: 999888,
        runUrl: 'https://github.com/owner/repo/actions/runs/999888',
        status: 'QUEUED',
      });

      // Mock dispatch response (204 No Content)
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          text: jest.fn().mockResolvedValue(''),
        } as any)
        // Mock list runs response
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            workflow_runs: [
              {
                id: 999888,
                html_url: 'https://github.com/owner/repo/actions/runs/999888',
                status: 'queued',
                created_at: new Date().toISOString(),
              },
            ],
          }),
        } as any);

      const input: DispatchWorkflowInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        workflowIdOrFile: 'ci.yml',
        ref: 'main',
        correlationId: 'issue-456',
        inputs: { key: 'value' },
      };

      const result = await dispatchWorkflow(mockPool, input);

      expect(result.isExisting).toBe(false);
      expect(result.runId).toBe(999888);
      expect(result.recordId).toBe('run-record-new');
      expect(findExistingRun).toHaveBeenCalled();
      expect(createRunRecord).toHaveBeenCalledWith(
        mockPool,
        input,
        999888,
        'https://github.com/owner/repo/actions/runs/999888'
      );
    });

    it('should throw error if dispatch fails', async () => {
      const { findExistingRun } = require('../../src/lib/db/githubRuns');
      
      findExistingRun.mockResolvedValue(null);

      // Mock failed dispatch
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: jest.fn().mockResolvedValue('Workflow not found'),
        } as any);

      const input: DispatchWorkflowInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        workflowIdOrFile: 'nonexistent.yml',
        ref: 'main',
        correlationId: 'issue-789',
      };

      await expect(dispatchWorkflow(mockPool, input)).rejects.toThrow(
        'Failed to dispatch workflow'
      );
    });
  });

  describe('pollRun', () => {
    it('should poll and update run status', async () => {
      const { findRunByGitHubRunId, updateRunStatus } = require('../../src/lib/db/githubRuns');
      
      findRunByGitHubRunId.mockResolvedValue({
        id: 'run-record-123',
        status: 'QUEUED',
      });

      // Mock GitHub API response
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            id: 123456,
            status: 'in_progress',
            conclusion: null,
            created_at: '2024-01-01T12:00:00Z',
            updated_at: '2024-01-01T12:05:00Z',
            run_started_at: '2024-01-01T12:01:00Z',
          }),
        } as any);

      const input: PollRunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: 123456,
      };

      const result = await pollRun(mockPool, input);

      expect(result.runId).toBe(123456);
      expect(result.status).toBe('in_progress');
      expect(result.conclusion).toBeNull();
      expect(result.normalizedStatus).toBe('RUNNING');
      expect(updateRunStatus).toHaveBeenCalledWith(
        mockPool,
        'run-record-123',
        'RUNNING',
        '2024-01-01T12:05:00Z'
      );
    });

    it('should handle completed run with success conclusion', async () => {
      const { findRunByGitHubRunId, updateRunStatus } = require('../../src/lib/db/githubRuns');
      
      findRunByGitHubRunId.mockResolvedValue({
        id: 'run-record-456',
        status: 'RUNNING',
      });

      // Mock GitHub API response
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            id: 789012,
            status: 'completed',
            conclusion: 'success',
            created_at: '2024-01-01T12:00:00Z',
            updated_at: '2024-01-01T12:10:00Z',
            run_started_at: '2024-01-01T12:01:00Z',
          }),
        } as any);

      const input: PollRunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: 789012,
      };

      const result = await pollRun(mockPool, input);

      expect(result.status).toBe('completed');
      expect(result.conclusion).toBe('success');
      expect(result.normalizedStatus).toBe('SUCCEEDED');
      expect(updateRunStatus).toHaveBeenCalledWith(
        mockPool,
        'run-record-456',
        'SUCCEEDED',
        '2024-01-01T12:10:00Z'
      );
    });

    it('should throw error if run not found', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: jest.fn().mockResolvedValue('Not Found'),
        } as any);

      const input: PollRunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: 999999,
      };

      await expect(pollRun(mockPool, input)).rejects.toThrow(
        'Failed to get workflow run'
      );
    });
  });

  describe('ingestRun', () => {
    it('should ingest completed run with jobs and artifacts', async () => {
      const { findRunByGitHubRunId, updateRunResult } = require('../../src/lib/db/githubRuns');
      
      findRunByGitHubRunId.mockResolvedValue({
        id: 'run-record-789',
        status: 'SUCCEEDED',
      });

      // Mock GitHub API responses: run details, jobs, artifacts
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            id: 111222,
            status: 'completed',
            conclusion: 'success',
            created_at: '2024-01-01T12:00:00Z',
            updated_at: '2024-01-01T12:10:00Z',
            run_started_at: '2024-01-01T12:01:00Z',
            html_url: 'https://github.com/owner/repo/actions/runs/111222',
            logs_url: 'https://api.github.com/repos/owner/repo/actions/runs/111222/logs',
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            jobs: [
              {
                id: 1,
                name: 'build',
                status: 'completed',
                conclusion: 'success',
                started_at: '2024-01-01T12:01:00Z',
                completed_at: '2024-01-01T12:05:00Z',
                steps: [{ name: 'step1' }, { name: 'step2' }],
              },
              {
                id: 2,
                name: 'test',
                status: 'completed',
                conclusion: 'success',
                started_at: '2024-01-01T12:05:00Z',
                completed_at: '2024-01-01T12:10:00Z',
                steps: [{ name: 'step3' }],
              },
            ],
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            artifacts: [
              {
                id: 100,
                name: 'build-output',
                size_in_bytes: 1024,
                archive_download_url: 'https://api.github.com/repos/owner/repo/actions/artifacts/100/zip',
                created_at: '2024-01-01T12:05:00Z',
                expires_at: '2024-02-01T12:05:00Z',
              },
            ],
          }),
        } as any);

      const input: IngestRunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: 111222,
      };

      const result = await ingestRun(mockPool, input);

      expect(result.runId).toBe(111222);
      expect(result.recordId).toBe('run-record-789');
      expect(result.summary.status).toBe('completed');
      expect(result.summary.conclusion).toBe('success');
      expect(result.summary.totalJobs).toBe(2);
      expect(result.summary.successfulJobs).toBe(2);
      expect(result.summary.failedJobs).toBe(0);
      expect(result.jobs).toHaveLength(2);
      expect(result.artifacts).toHaveLength(1);
      expect(updateRunResult).toHaveBeenCalledWith(
        mockPool,
        'run-record-789',
        expect.objectContaining({
          runId: 111222,
          summary: expect.objectContaining({
            totalJobs: 2,
          }),
        })
      );
    });

    it('should throw error if run record not found', async () => {
      const { findRunByGitHubRunId } = require('../../src/lib/db/githubRuns');
      
      findRunByGitHubRunId.mockResolvedValue(null);

      // Mock GitHub API response (run exists in GitHub but not in our DB)
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({
            id: 333444,
            status: 'completed',
            conclusion: 'success',
            created_at: '2024-01-01T12:00:00Z',
            updated_at: '2024-01-01T12:10:00Z',
            html_url: 'https://github.com/owner/repo/actions/runs/333444',
            logs_url: 'https://api.github.com/repos/owner/repo/actions/runs/333444/logs',
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ jobs: [] }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ artifacts: [] }),
        } as any);

      const input: IngestRunInput = {
        owner: 'test-owner',
        repo: 'test-repo',
        runId: 333444,
      };

      await expect(ingestRun(mockPool, input)).rejects.toThrow(
        'No run record found for GitHub run ID 333444'
      );
    });
  });
});
