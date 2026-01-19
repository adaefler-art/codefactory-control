/**
 * Tests for POST /api/intent/sessions/:sessionId/issues/create
 * 
 * I201.2: Draft → AFU-9 Issue Commit (idempotent, read-after-write, no stub)
 */

import { Pool } from 'pg';
import { POST } from '../../app/api/intent/sessions/[id]/issues/create/route';
import { NextRequest } from 'next/server';
import { getIssueDraft } from '../../src/lib/db/intentIssueDrafts';
import { getLatestCommittedVersion } from '../../src/lib/db/intentIssueDraftVersions';
import { ensureIssueForCommittedDraft, getAfu9IssueById, getPublicId } from '../../src/lib/db/afu9Issues';
import { Afu9IssueStatus } from '../../src/lib/contracts/afu9Issue';

// Mock dependencies
jest.mock('../../src/lib/db');
jest.mock('../../src/lib/db/intentIssueDrafts');
jest.mock('../../src/lib/db/intentIssueDraftVersions');
jest.mock('../../src/lib/db/afu9Issues');

const mockGetPool = jest.fn();
const mockGetIssueDraft = getIssueDraft as jest.MockedFunction<typeof getIssueDraft>;
const mockGetLatestCommittedVersion = getLatestCommittedVersion as jest.MockedFunction<typeof getLatestCommittedVersion>;
const mockEnsureIssueForCommittedDraft = ensureIssueForCommittedDraft as jest.MockedFunction<typeof ensureIssueForCommittedDraft>;
const mockGetAfu9IssueById = getAfu9IssueById as jest.MockedFunction<typeof getAfu9IssueById>;
const mockGetPublicId = getPublicId as jest.MockedFunction<typeof getPublicId>;

// Mock getPool
jest.mock('../../src/lib/db', () => ({
  getPool: () => mockGetPool(),
}));

describe('POST /api/intent/sessions/:sessionId/issues/create', () => {
  let mockPool: Pool;
  const sessionId = 'test-session-123';
  const userId = 'test-user-456';
  const requestId = 'req-789';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {} as Pool;
    mockGetPool.mockReturnValue(mockPool);
  });

  const createMockRequest = (headers: Record<string, string> = {}) => {
    return {
      headers: {
        get: (key: string) => headers[key] || null,
      },
    } as unknown as NextRequest;
  };

  const createMockContext = (id: string) => ({
    params: Promise.resolve({ id }),
  });

  describe('Authentication', () => {
    it('should return 401 when x-afu9-sub header is missing', async () => {
      const request = createMockRequest({});
      const context = createMockContext(sessionId);

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when x-afu9-sub header is empty', async () => {
      const request = createMockRequest({ 'x-afu9-sub': '  ' });
      const context = createMockContext(sessionId);

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Draft validation', () => {
    it('should return 404 when no draft exists', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({
        success: true,
        data: null,
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.code).toBe('NO_DRAFT');
    });

    it('should return 409 when draft validation status is not valid', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({
        success: true,
        data: {
          id: 'draft-123',
          session_id: sessionId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          issue_json: {},
          issue_hash: 'hash123',
          last_validation_status: 'invalid',
          last_validation_at: new Date().toISOString(),
          last_validation_result: null,
        },
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('VALIDATION_REQUIRED');
    });

    it('should return 409 when no committed version exists', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({
        success: true,
        data: {
          id: 'draft-123',
          session_id: sessionId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          issue_json: { canonicalId: 'TEST-001' },
          issue_hash: 'hash123',
          last_validation_status: 'valid',
          last_validation_at: new Date().toISOString(),
          last_validation_result: null,
        },
      });

      mockGetLatestCommittedVersion.mockResolvedValue({
        success: true,
        data: null,
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('NO_COMMITTED_VERSION');
    });
  });

  describe('Issue creation', () => {
    const mockIssueDraft = {
      issueDraftVersion: '1.0' as const,
      title: 'Test Issue',
      body: 'Test body content',
      type: 'issue' as const,
      canonicalId: 'TEST-001',
      labels: ['test', 'draft'],
      dependsOn: [],
      priority: 'P1' as const,
      acceptanceCriteria: ['AC1'],
      verify: {
        commands: ['npm test'],
        expected: ['pass'],
      },
      guards: {
        env: 'development' as const,
        prodBlocked: true as const,
      },
      kpi: {
        dcu: 1 as const,
        intent: 'test intent',
      },
    };

    const mockDraft = {
      id: 'draft-123',
      session_id: sessionId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      issue_json: mockIssueDraft,
      issue_hash: 'hash123',
      last_validation_status: 'valid' as const,
      last_validation_at: new Date().toISOString(),
      last_validation_result: null,
    };

    const mockVersion = {
      id: 'version-456',
      session_id: sessionId,
      created_at: new Date().toISOString(),
      created_by_sub: userId,
      issue_json: mockIssueDraft,
      issue_hash: 'hash123',
      version_number: 1,
    };

    const mockCreatedIssue = {
      id: 'issue-uuid-789',
      title: 'Test Issue',
      body: 'Test body content',
      status: Afu9IssueStatus.CREATED,
      labels: ['test', 'draft'],
      priority: 'P1',
      assignee: null,
      source: 'afu9',
      handoff_state: 'NOT_SENT',
      github_issue_number: null,
      github_url: null,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      activated_at: null,
      activated_by: null,
      execution_state: 'IDLE',
      execution_started_at: null,
      execution_completed_at: null,
      execution_output: null,
      deleted_at: null,
      handoff_at: null,
      handoff_error: null,
      github_repo: null,
      github_issue_last_sync_at: null,
      github_status_raw: null,
      github_status_updated_at: null,
      status_source: null,
      github_mirror_status: 'UNKNOWN',
      github_sync_error: null,
      source_session_id: sessionId,
      current_draft_id: mockVersion.id,
      active_cr_id: null,
      github_synced_at: null,
      kpi_context: { dcu: 1, intent: 'test intent' },
      publish_batch_id: null,
      publish_request_id: null,
      canonical_id: 'TEST-001',
    };

    it('should create new AFU-9 issue on first call', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });
      mockGetLatestCommittedVersion.mockResolvedValue({ success: true, data: mockVersion });
      mockEnsureIssueForCommittedDraft.mockResolvedValue({
        success: true,
        data: {
          issue: mockCreatedIssue,
          isNew: true,
        },
      });
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockCreatedIssue,
      });
      mockGetPublicId.mockReturnValue('issue-uu');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.state).toBe('AFU9_ISSUE_CREATED');
      expect(data.issueId).toBe(mockCreatedIssue.id);
      expect(data.canonicalId).toBe('TEST-001');
      expect(data.isNew).toBe(true);
      expect(data.publicId).toBeDefined();
      expect(data.publicId).toBe('issue-uu'); // First 8 chars of 'issue-uuid-789'

      // Verify ensureIssueForCommittedDraft was called with correct params
      expect(mockEnsureIssueForCommittedDraft).toHaveBeenCalledWith(
        mockPool,
        expect.objectContaining({
          title: 'Test Issue',
          body: 'Test body content',
          canonical_id: 'TEST-001',
          labels: ['test', 'draft'],
          priority: 'P1',
          kpi_context: {
            dcu: 1,
            intent: 'test intent',
          },
        }),
        sessionId,
        mockVersion.id
      );

      // Verify read-after-write check was performed
      expect(mockGetAfu9IssueById).toHaveBeenCalledWith(mockPool, mockCreatedIssue.id);
    });

    it('should return existing issue on subsequent calls (idempotency)', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });
      mockGetLatestCommittedVersion.mockResolvedValue({ success: true, data: mockVersion });
      mockEnsureIssueForCommittedDraft.mockResolvedValue({
        success: true,
        data: {
          issue: mockCreatedIssue,
          isNew: false, // Already exists
        },
      });
      mockGetAfu9IssueById.mockResolvedValue({
        success: true,
        data: mockCreatedIssue,
      });
      mockGetPublicId.mockReturnValue('issue-uu');

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(200); // 200 for existing, not 201
      expect(data.state).toBe('AFU9_ISSUE_CREATED');
      expect(data.issueId).toBe(mockCreatedIssue.id);
      expect(data.canonicalId).toBe('TEST-001');
      expect(data.isNew).toBe(false);
    });

    it('should return 500 when read-after-write check fails', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });
      mockGetLatestCommittedVersion.mockResolvedValue({ success: true, data: mockVersion });
      mockEnsureIssueForCommittedDraft.mockResolvedValue({
        success: true,
        data: {
          issue: mockCreatedIssue,
          isNew: true,
        },
      });
      // Read-after-write fails
      mockGetAfu9IssueById.mockResolvedValue({
        success: false,
        error: 'Issue not found',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('E_CREATE_NOT_PERSISTED');
      expect(data.error).toContain('read-after-write');
    });

    it('should return 400 when canonicalId is missing', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      const draftWithoutCanonicalId = {
        ...mockDraft,
        issue_json: {
          ...mockIssueDraft,
          canonicalId: undefined,
        },
      };

      mockGetIssueDraft.mockResolvedValue({ success: true, data: draftWithoutCanonicalId });
      mockGetLatestCommittedVersion.mockResolvedValue({ success: true, data: mockVersion });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.code).toBe('MISSING_CANONICAL_ID');
    });

    it('should handle ensureIssueForCommittedDraft failure', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });
      mockGetLatestCommittedVersion.mockResolvedValue({ success: true, data: mockVersion });
      mockEnsureIssueForCommittedDraft.mockResolvedValue({
        success: false,
        error: 'Database connection failed',
      });

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toContain('Failed to create AFU-9 Issue');
      expect(data.details).toContain('Database connection failed');
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      const request = createMockRequest({ 'x-afu9-sub': userId });
      const context = createMockContext(sessionId);

      mockGetIssueDraft.mockRejectedValue(new Error('Database connection failed'));

      const response = await POST(request, context);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to create AFU-9 Issue');
      expect(data.details).toBe('Database connection failed');
    });
  });
});
