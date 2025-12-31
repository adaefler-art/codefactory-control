/**
 * GitHub Ingestion Tests
 * 
 * Tests for GitHub ingestion functions:
 * - Idempotency (safe to re-run)
 * - Deterministic node IDs
 * - I711 policy enforcement
 * - Error handling
 * 
 * Reference: I722 (E72.2 - GitHub Ingestion)
 * 
 * @jest-environment node
 */

import { Pool } from 'pg';
import {
  ingestIssue,
  ingestPullRequest,
  ingestIssueComments,
  ingestLabels,
  IssueNotFoundError,
  PullRequestNotFoundError,
} from '../../src/lib/github-ingestion';
import { TimelineDAO } from '../../src/lib/db/timeline';

// Mock dependencies
jest.mock('../../src/lib/github/auth-wrapper');
jest.mock('../../src/lib/db/timeline');

const mockCreateAuthenticatedClient = jest.requireMock('../../src/lib/github/auth-wrapper').createAuthenticatedClient;

// Mock Octokit
const mockGet = jest.fn();
const mockListComments = jest.fn();
const mockListLabelsForRepo = jest.fn();

const mockOctokit = {
  rest: {
    issues: {
      get: mockGet,
      listComments: mockListComments,
      listLabelsForRepo: mockListLabelsForRepo,
    },
    pulls: {
      get: mockGet,
    },
  },
};

// Mock TimelineDAO
const mockUpsertNode = jest.fn();
const mockGetNodeByNaturalKey = jest.fn();
const mockGetNodeById = jest.fn();
const mockCreateSource = jest.fn();
const mockCreateEdge = jest.fn();

const MockTimelineDAO = TimelineDAO as jest.MockedClass<typeof TimelineDAO>;

describe('GitHub Ingestion', () => {
  let mockPool: Pool;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup auth wrapper mock
    mockCreateAuthenticatedClient.mockResolvedValue(mockOctokit);

    // Setup TimelineDAO mock
    MockTimelineDAO.mockImplementation(() => ({
      upsertNode: mockUpsertNode,
      getNodeByNaturalKey: mockGetNodeByNaturalKey,
      getNodeById: mockGetNodeById,
      createSource: mockCreateSource,
      createEdge: mockCreateEdge,
    } as any));

    mockPool = {} as Pool;
  });

  describe('ingestIssue', () => {
    test('creates new issue node with metadata', async () => {
      const mockIssueData = {
        number: 123,
        title: 'Test Issue',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'testuser' },
        labels: [],
        pull_request: undefined,
      };

      mockGet.mockResolvedValue({
        data: mockIssueData,
        headers: { etag: 'W/"abc123"' },
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null); // Node doesn't exist
      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {
          number: 123,
          state: 'open',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          closed_at: null,
          user: 'testuser',
          labels: [],
        },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      expect(result.nodeId).toBe('node-uuid-1');
      expect(result.issueNumber).toBe(123);
      expect(result.isNew).toBe(true);
      expect(result.source_system).toBe('github');
      expect(result.source_type).toBe('issue');
      expect(result.source_id).toBe('owner/repo/issues/123');
      expect(result.naturalKey).toBe('github:issue:owner/repo/issues/123');

      // Verify auth wrapper was called
      expect(mockCreateAuthenticatedClient).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
      });

      // Verify node was upserted
      expect(mockUpsertNode).toHaveBeenCalledWith({
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: expect.objectContaining({
          number: 123,
          state: 'open',
        }),
      });

      // Verify source reference was created
      expect(mockCreateSource).toHaveBeenCalledWith({
        node_id: 'node-uuid-1',
        source_kind: 'github_api',
        ref_json: expect.objectContaining({
          url: 'https://api.github.com/repos/owner/repo/issues/123',
          etag: 'W/"abc123"',
        }),
      });
    });

    test('is idempotent - returns existing node on re-run', async () => {
      const mockIssueData = {
        number: 123,
        title: 'Test Issue',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'testuser' },
        labels: [],
        pull_request: undefined,
      };

      mockGet.mockResolvedValue({
        data: mockIssueData,
        headers: { etag: 'W/"abc123"' },
      });

      // Node already exists
      mockGetNodeByNaturalKey.mockResolvedValue({
        id: 'existing-node-uuid',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
      });

      mockUpsertNode.mockResolvedValue({
        id: 'existing-node-uuid',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      expect(result.isNew).toBe(false);
      expect(result.nodeId).toBe('existing-node-uuid');
    });

    test('ingests labels when present', async () => {
      const mockIssueData = {
        number: 123,
        title: 'Test Issue',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'testuser' },
        labels: [
          { name: 'bug', color: 'ff0000', description: 'Bug label' },
          { name: 'enhancement', color: '00ff00', description: 'Enhancement label' },
        ],
        pull_request: undefined,
      };

      mockGet.mockResolvedValue({
        data: mockIssueData,
        headers: { etag: 'W/"abc123"' },
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null);
      
      // Mock upsertNode for issue
      mockUpsertNode.mockResolvedValueOnce({
        id: 'issue-node-uuid',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      // Mock upsertNode for labels
      mockUpsertNode.mockResolvedValueOnce({
        id: 'label-node-1',
        source_system: 'github',
        source_type: 'label',
        source_id: 'owner/repo/labels/bug',
        node_type: 'COMMENT',
        title: 'bug',
        url: null,
        payload_json: { color: 'ff0000', description: 'Bug label' },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockUpsertNode.mockResolvedValueOnce({
        id: 'label-node-2',
        source_system: 'github',
        source_type: 'label',
        source_id: 'owner/repo/labels/enhancement',
        node_type: 'COMMENT',
        title: 'enhancement',
        url: null,
        payload_json: { color: '00ff00', description: 'Enhancement label' },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockCreateEdge.mockResolvedValue({ id: 'edge-uuid-1' });

      const result = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      expect(result.labelNodeIds).toHaveLength(2);
      expect(result.labelNodeIds).toContain('label-node-1');
      expect(result.labelNodeIds).toContain('label-node-2');

      // Verify labels were upserted
      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'label',
          title: 'bug',
        })
      );

      // Verify edges were created
      expect(mockCreateEdge).toHaveBeenCalledTimes(2);
    });

    test('throws IssueNotFoundError when issue does not exist', async () => {
      mockGet.mockRejectedValue({ status: 404, message: 'Not Found' });

      await expect(
        ingestIssue({ owner: 'owner', repo: 'repo', issueNumber: 999 }, mockPool)
      ).rejects.toThrow(IssueNotFoundError);
    });

    test('distinguishes between issues and PRs', async () => {
      const mockPRData = {
        number: 456,
        title: 'Test PR',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/456',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'testuser' },
        labels: [],
        pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/456' },
      };

      mockGet.mockResolvedValue({
        data: mockPRData,
        headers: { etag: 'W/"def456"' },
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null);
      mockUpsertNode.mockResolvedValue({
        id: 'pr-node-uuid',
        source_system: 'github',
        source_type: 'pull_request',
        source_id: 'owner/repo/pulls/456',
        node_type: 'PR',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/456',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 456 },
        mockPool
      );

      expect(result.source_type).toBe('pull_request');
      expect(result.source_id).toBe('owner/repo/pulls/456');
      
      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'pull_request',
          node_type: 'PR',
        })
      );
    });
  });

  describe('ingestPullRequest', () => {
    test('creates new PR node with metadata', async () => {
      const mockPRData = {
        number: 456,
        title: 'Test PR',
        state: 'open',
        html_url: 'https://github.com/owner/repo/pull/456',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        merged_at: null,
        user: { login: 'testuser' },
        base: { ref: 'main' },
        head: { ref: 'feature-branch' },
        labels: [],
      };

      mockGet.mockResolvedValue({
        data: mockPRData,
        headers: { etag: 'W/"pr123"' },
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null);
      mockUpsertNode.mockResolvedValue({
        id: 'pr-node-uuid',
        source_system: 'github',
        source_type: 'pull_request',
        source_id: 'owner/repo/pulls/456',
        node_type: 'PR',
        title: 'Test PR',
        url: 'https://github.com/owner/repo/pull/456',
        payload_json: {
          number: 456,
          state: 'open',
          base_ref: 'main',
          head_ref: 'feature-branch',
        },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestPullRequest(
        { owner: 'owner', repo: 'repo', prNumber: 456 },
        mockPool
      );

      expect(result.nodeId).toBe('pr-node-uuid');
      expect(result.prNumber).toBe(456);
      expect(result.source_type).toBe('pull_request');
      expect(result.source_id).toBe('owner/repo/pulls/456');

      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'pull_request',
          node_type: 'PR',
          payload_json: expect.objectContaining({
            base_ref: 'main',
            head_ref: 'feature-branch',
          }),
        })
      );
    });

    test('throws PullRequestNotFoundError when PR does not exist', async () => {
      mockGet.mockRejectedValue({ status: 404, message: 'Not Found' });

      await expect(
        ingestPullRequest({ owner: 'owner', repo: 'repo', prNumber: 999 }, mockPool)
      ).rejects.toThrow(PullRequestNotFoundError);
    });
  });

  describe('ingestIssueComments', () => {
    test('ingests comments and creates edges', async () => {
      const mockCommentsData = [
        {
          id: 1001,
          html_url: 'https://github.com/owner/repo/issues/123#issuecomment-1001',
          url: 'https://api.github.com/repos/owner/repo/issues/comments/1001',
          body: 'First comment',
          created_at: '2024-01-02T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          user: { login: 'commenter1' },
        },
        {
          id: 1002,
          html_url: 'https://github.com/owner/repo/issues/123#issuecomment-1002',
          url: 'https://api.github.com/repos/owner/repo/issues/comments/1002',
          body: 'Second comment',
          created_at: '2024-01-03T00:00:00Z',
          updated_at: '2024-01-03T00:00:00Z',
          user: { login: 'commenter2' },
        },
      ];

      mockListComments.mockResolvedValue({
        data: mockCommentsData,
      });

      // Mock parent node exists
      mockGetNodeByNaturalKey.mockResolvedValue({
        id: 'parent-issue-uuid',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Parent Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      // Mock comment nodes
      mockUpsertNode.mockResolvedValueOnce({
        id: 'comment-node-1',
        source_system: 'github',
        source_type: 'comment',
        source_id: 'owner/repo/comments/1001',
        node_type: 'COMMENT',
        title: null,
        url: 'https://github.com/owner/repo/issues/123#issuecomment-1001',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-02T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      });

      mockUpsertNode.mockResolvedValueOnce({
        id: 'comment-node-2',
        source_system: 'github',
        source_type: 'comment',
        source_id: 'owner/repo/comments/1002',
        node_type: 'COMMENT',
        title: null,
        url: 'https://github.com/owner/repo/issues/123#issuecomment-1002',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-03T00:00:00Z',
        updated_at: '2024-01-03T00:00:00Z',
      });

      mockCreateEdge.mockResolvedValue({ id: 'edge-uuid' });

      const result = await ingestIssueComments(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      expect(result.commentNodes).toHaveLength(2);
      expect(result.parentNodeId).toBe('parent-issue-uuid');
      expect(result.edgeIds).toHaveLength(2);

      // Verify comments were upserted
      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'comment',
          node_type: 'COMMENT',
        })
      );

      // Verify edges were created
      expect(mockCreateEdge).toHaveBeenCalledWith(
        expect.objectContaining({
          from_node_id: 'parent-issue-uuid',
          edge_type: 'ISSUE_HAS_COMMENT',
        })
      );
    });
  });

  describe('ingestLabels', () => {
    test('ingests repository labels', async () => {
      const mockLabelsData = [
        { name: 'bug', color: 'ff0000', description: 'Bug label', url: 'https://api.github.com/repos/owner/repo/labels/bug' },
        { name: 'feature', color: '00ff00', description: 'Feature label', url: 'https://api.github.com/repos/owner/repo/labels/feature' },
      ];

      mockListLabelsForRepo.mockResolvedValue({
        data: mockLabelsData,
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null);

      mockUpsertNode.mockResolvedValueOnce({
        id: 'label-node-1',
        source_system: 'github',
        source_type: 'label',
        source_id: 'owner/repo/labels/bug',
        node_type: 'COMMENT',
        title: 'bug',
        url: null,
        payload_json: { name: 'bug', color: 'ff0000', description: 'Bug label' },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      mockUpsertNode.mockResolvedValueOnce({
        id: 'label-node-2',
        source_system: 'github',
        source_type: 'label',
        source_id: 'owner/repo/labels/feature',
        node_type: 'COMMENT',
        title: 'feature',
        url: null,
        payload_json: { name: 'feature', color: '00ff00', description: 'Feature label' },
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result = await ingestLabels(
        { owner: 'owner', repo: 'repo' },
        mockPool
      );

      expect(result.labelNodes).toHaveLength(2);
      expect(result.labelNodes[0].nodeId).toBe('label-node-1');
      expect(result.labelNodes[1].nodeId).toBe('label-node-2');

      // Verify labels were upserted
      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'label',
          title: 'bug',
        })
      );

      expect(mockUpsertNode).toHaveBeenCalledWith(
        expect.objectContaining({
          source_type: 'label',
          title: 'feature',
        })
      );
    });
  });

  describe('Deterministic node IDs', () => {
    test('generates stable source_id for same issue', async () => {
      const mockIssueData = {
        number: 123,
        title: 'Test Issue',
        state: 'open',
        html_url: 'https://github.com/owner/repo/issues/123',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        closed_at: null,
        user: { login: 'testuser' },
        labels: [],
        pull_request: undefined,
      };

      mockGet.mockResolvedValue({
        data: mockIssueData,
        headers: { etag: 'W/"abc123"' },
      });

      mockGetNodeByNaturalKey.mockResolvedValue(null);
      mockUpsertNode.mockResolvedValue({
        id: 'node-uuid-1',
        source_system: 'github',
        source_type: 'issue',
        source_id: 'owner/repo/issues/123',
        node_type: 'ISSUE',
        title: 'Test Issue',
        url: 'https://github.com/owner/repo/issues/123',
        payload_json: {},
        lawbook_version: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      });

      const result1 = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      const result2 = await ingestIssue(
        { owner: 'owner', repo: 'repo', issueNumber: 123 },
        mockPool
      );

      // Same source_id should be generated
      expect(result1.source_id).toBe(result2.source_id);
      expect(result1.source_id).toBe('owner/repo/issues/123');
      expect(result1.naturalKey).toBe(result2.naturalKey);
    });
  });
});
