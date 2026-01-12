/**
 * Implementation Summary Service Tests (E83.3)
 * 
 * Tests for deterministic ordering, hashing, and versioning
 * of implementation summaries.
 * 
 * @jest-environment node
 */

import { ImplementationSummaryService } from '@/lib/implementation-summary-service';
import { Pool } from 'pg';
import { Octokit } from 'octokit';

// Mock dependencies
jest.mock('@/lib/db', () => ({
  getPool: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/github/auth-wrapper', () => ({
  createAuthenticatedClient: jest.fn(),
  RepoAccessDeniedError: class RepoAccessDeniedError extends Error {
    constructor(public repository: string) {
      super(`Access denied: ${repository}`);
      this.name = 'RepoAccessDeniedError';
    }
  },
}));

jest.mock('@/lib/repo-actions-registry-service', () => ({
  getRepoActionsRegistryService: jest.fn(() => ({
    validateAction: jest.fn().mockResolvedValue({ allowed: true }),
  })),
}));

describe('ImplementationSummaryService', () => {
  let service: ImplementationSummaryService;
  let mockPool: jest.Mocked<Pool>;
  let mockOctokit: jest.Mocked<Octokit>;

  beforeEach(() => {
    // Mock pool
    mockPool = {
      query: jest.fn(),
      connect: jest.fn(),
    } as any;

    // Mock octokit
    mockOctokit = {
      rest: {
        pulls: {
          get: jest.fn(),
        },
        issues: {
          listComments: jest.fn(),
        },
        checks: {
          listForRef: jest.fn(),
        },
      },
    } as any;

    const { createAuthenticatedClient } = require('@/lib/github/auth-wrapper');
    createAuthenticatedClient.mockResolvedValue(mockOctokit);

    service = new ImplementationSummaryService(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Deterministic Ordering', () => {
    it('should sort comments by created_at then id', async () => {
      // Mock PR response
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          body: 'Test PR',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          user: { login: 'testuser' },
          html_url: 'https://github.com/owner/repo/pull/123',
          head: { sha: 'abc123' },
        },
      } as any);

      // Mock comments with same timestamp but different IDs
      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 3,
            body: 'Comment 3',
            created_at: '2025-01-01T10:00:00Z',
            updated_at: '2025-01-01T10:00:00Z',
            user: { login: 'user1' },
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-3',
          },
          {
            id: 1,
            body: 'Comment 1',
            created_at: '2025-01-01T10:00:00Z',
            updated_at: '2025-01-01T10:00:00Z',
            user: { login: 'user2' },
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-1',
          },
          {
            id: 2,
            body: 'Comment 2',
            created_at: '2025-01-01T11:00:00Z',
            updated_at: '2025-01-01T11:00:00Z',
            user: { login: 'user3' },
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-2',
          },
        ],
      } as any);

      // Mock checks
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      // Mock DB queries
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any); // No existing summary
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'test-uuid',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash123',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Verify comment order: by timestamp, then by ID
      expect(result.content.comments).toHaveLength(3);
      expect(result.content.comments[0].id).toBe(1); // Same timestamp, lower ID first
      expect(result.content.comments[1].id).toBe(3); // Same timestamp, higher ID second
      expect(result.content.comments[2].id).toBe(2); // Later timestamp
    });

    it('should sort check runs alphabetically by name', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          body: 'Test PR',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          user: { login: 'testuser' },
          html_url: 'https://github.com/owner/repo/pull/123',
          head: { sha: 'abc123' },
        },
      } as any);

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [],
      } as any);

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            {
              id: 3,
              name: 'Lint',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T10:05:00Z',
              html_url: 'https://github.com/owner/repo/runs/3',
            },
            {
              id: 1,
              name: 'Build',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T10:03:00Z',
              html_url: 'https://github.com/owner/repo/runs/1',
            },
            {
              id: 2,
              name: 'Test',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2025-01-01T10:04:00Z',
              html_url: 'https://github.com/owner/repo/runs/2',
            },
          ],
        },
      } as any);

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'test-uuid',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash123',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Verify alphabetical order
      expect(result.content.checkRuns).toHaveLength(3);
      expect(result.content.checkRuns[0].name).toBe('Build');
      expect(result.content.checkRuns[1].name).toBe('Lint');
      expect(result.content.checkRuns[2].name).toBe('Test');
    });
  });

  describe('Deterministic Hashing', () => {
    it('should generate same hash for identical content', async () => {
      const prData = {
        number: 123,
        body: 'Test PR',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'testuser' },
        html_url: 'https://github.com/owner/repo/pull/123',
        head: { sha: 'abc123' },
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({ data: prData } as any);
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] } as any);
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValue({ rows: [] } as any);
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any); // No existing
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'uuid-1',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash1',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result1 = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Collect again with same data
      jest.clearAllMocks();
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: prData } as any);
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] } as any);
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'uuid-1',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: result1.contentHash,
            content: result1.content,
            sources: result1.sources,
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result2 = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Same hash for same content
      expect(result2.contentHash).toBe(result1.contentHash);
      expect(result2.isNewVersion).toBe(false);
      expect(result2.version).toBe(1);
    });

    it('should generate different hash when PR body changes', async () => {
      const prData1 = {
        number: 123,
        body: 'Original PR body',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        user: { login: 'testuser' },
        html_url: 'https://github.com/owner/repo/pull/123',
        head: { sha: 'abc123' },
      };

      mockOctokit.rest.pulls.get.mockResolvedValue({ data: prData1 } as any);
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] } as any);
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'uuid-1',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash1',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result1 = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Change PR body
      jest.clearAllMocks();
      const prData2 = { ...prData1, body: 'Updated PR body', updated_at: '2025-01-02T00:00:00Z' };
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: prData2 } as any);
      mockOctokit.rest.issues.listComments.mockResolvedValue({ data: [] } as any);
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'uuid-1',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: result1.contentHash,
            content: result1.content,
            sources: result1.sources,
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            summary_id: 'uuid-2',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash2',
            content: {},
            sources: [],
            version: 2,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result2 = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Different hash for different content
      expect(result2.contentHash).not.toBe(result1.contentHash);
      expect(result2.isNewVersion).toBe(true);
      expect(result2.version).toBe(2);
    });
  });

  describe('Comment Bounds', () => {
    it('should respect maxComments limit', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          body: 'Test PR',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          user: { login: 'testuser' },
          html_url: 'https://github.com/owner/repo/pull/123',
          head: { sha: 'abc123' },
        },
      } as any);

      // Generate 100 comments
      const comments = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        body: `Comment ${i + 1}`,
        created_at: `2025-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        updated_at: `2025-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        user: { login: `user${i}` },
        html_url: `https://github.com/owner/repo/pull/123#issuecomment-${i + 1}`,
      }));

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: comments,
      } as any);

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'test-uuid',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash123',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
        maxComments: 10,
      });

      // Should only collect first 10 comments
      expect(result.content.comments).toHaveLength(10);
      expect(result.content.metadata.collectCount).toBe(10);
    });
  });

  describe('Whitespace Normalization', () => {
    it('should normalize whitespace in PR body and comments', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 123,
          body: '  Test PR\r\nWith windows line endings  \r\n  ',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          user: { login: 'testuser' },
          html_url: 'https://github.com/owner/repo/pull/123',
          head: { sha: 'abc123' },
        },
      } as any);

      mockOctokit.rest.issues.listComments.mockResolvedValue({
        data: [
          {
            id: 1,
            body: '\r\n  Comment with\r\n  mixed line endings\r\n  ',
            created_at: '2025-01-01T10:00:00Z',
            updated_at: '2025-01-01T10:00:00Z',
            user: { login: 'user1' },
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-1',
          },
        ],
      } as any);

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      } as any);

      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            summary_id: 'test-uuid',
            owner: 'owner',
            repo: 'repo',
            pr_number: 123,
            content_hash: 'hash123',
            content: {},
            sources: [],
            version: 1,
            collected_at: new Date(),
          },
        ],
      } as any);

      const result = await service.collectSummary({
        owner: 'owner',
        repo: 'repo',
        prNumber: 123,
      });

      // Verify normalized content
      expect(result.content.prDescription?.body).toBe('Test PR\nWith windows line endings');
      expect(result.content.comments[0].body).toBe('Comment with\n  mixed line endings');
    });
  });
});
