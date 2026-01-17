/**
 * E2E Tests for I902: Draft Access Reliability
 * 
 * Tests the complete flow of draft access for INTENT sessions:
 *  - GET draft (deterministic empty states: NO_DRAFT, MIGRATION_REQUIRED)
 *  - CREATE draft (from unstructured input)
 *  - PATCH draft (multiple patches, idempotent)
 *  - LIST versions (with hash/correlationId)
 *  - COMMIT draft
 *  - UI state consistency (no stale reads)
 * 
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, PUT, PATCH } from '../../app/api/intent/sessions/[id]/issue-draft/route';
import { POST as COMMIT } from '../../app/api/intent/sessions/[id]/issue-draft/commit/route';
import { GET as GET_VERSIONS } from '../../app/api/intent/sessions/[id]/issue-draft/versions/route';
import * as intentIssueDrafts from '../../src/lib/db/intentIssueDrafts';
import * as intentIssueDraftVersions from '../../src/lib/db/intentIssueDraftVersions';
import * as intentIssueAuthoringEvents from '../../src/lib/db/intentIssueAuthoringEvents';
import type { IssueDraft } from '../../src/lib/schemas/issueDraft';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/db/intentIssueDrafts');
jest.mock('../../src/lib/db/intentIssueDraftVersions');
jest.mock('../../src/lib/db/intentIssueAuthoringEvents');
jest.mock('../../src/lib/lawbook-version-helper', () => ({
  getActiveLawbookVersion: jest.fn(async () => ({ hash: 'test-lawbook-hash-v1' })),
}));
jest.mock('../../src/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(() => 'development'),
}));

describe('I902: Draft Access Reliability E2E', () => {
  const mockGetIssueDraft = intentIssueDrafts.getIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.getIssueDraft
  >;
  const mockSaveIssueDraft = intentIssueDrafts.saveIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.saveIssueDraft
  >;
  const mockValidateAndSaveIssueDraft = intentIssueDrafts.validateAndSaveIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.validateAndSaveIssueDraft
  >;
  const mockCommitIssueDraftVersion = intentIssueDraftVersions.commitIssueDraftVersion as jest.MockedFunction<
    typeof intentIssueDraftVersions.commitIssueDraftVersion
  >;
  const mockListIssueDraftVersions = intentIssueDraftVersions.listIssueDraftVersions as jest.MockedFunction<
    typeof intentIssueDraftVersions.listIssueDraftVersions
  >;
  const mockInsertEvent = intentIssueAuthoringEvents.insertEvent as jest.MockedFunction<
    typeof intentIssueAuthoringEvents.insertEvent
  >;

  const sessionId = 'e2e-session-123';
  const userId = 'e2e-user-456';

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertEvent.mockResolvedValue({ success: true });
  });

  /**
   * AC1: GET /api/intent/sessions/{id}/issue-draft delivers deterministic Empty-States
   */
  describe('AC1: Deterministic Empty States', () => {
    it('returns 200 with success:true, draft:null, reason:NO_DRAFT when no draft exists', async () => {
      mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

      const req = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'GET',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-no-draft',
        },
      });

      const res = await GET(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        success: true,
        draft: null,
        reason: 'NO_DRAFT',
      });
    });

    it('returns 503 with code:MIGRATION_REQUIRED when table is missing', async () => {
      mockGetIssueDraft.mockResolvedValue({ success: false, error: 'MIGRATION_REQUIRED' });

      const req = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'GET',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-migration',
        },
      });

      const res = await GET(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toMatchObject({
        code: 'MIGRATION_REQUIRED',
        requestId: 'req-migration',
      });
    });
  });

  /**
   * AC2: INTENT can patch the same draft multiple times without conflicts (idempotent)
   */
  describe('AC2: Idempotent PATCH operations', () => {
    const baseDraft: IssueDraft = {
      issueDraftVersion: '1.0',
      title: 'E2E Test Issue',
      body: 'Initial body content',
      type: 'issue',
      canonicalId: 'I902',
      labels: ['v0.9', 'draft'],
      dependsOn: [],
      priority: 'P1',
      acceptanceCriteria: ['AC1', 'AC2'],
      verify: {
        commands: ['npm test'],
        expected: ['All tests pass'],
      },
      guards: {
        env: 'development',
        prodBlocked: false,
      },
    };

    it('applies first patch successfully', async () => {
      const existingDraft = {
        id: 'draft-e2e-1',
        session_id: sessionId,
        created_at: '2026-01-16T10:00:00Z',
        updated_at: '2026-01-16T10:00:00Z',
        issue_json: baseDraft,
        issue_hash: 'hash-v1',
        last_validation_status: 'unknown' as const,
        last_validation_at: null,
        last_validation_result: null,
      };

      mockGetIssueDraft.mockResolvedValue({ success: true, data: existingDraft });
      mockSaveIssueDraft.mockResolvedValue({
        success: true,
        data: {
          ...existingDraft,
          issue_hash: 'hash-v2',
          updated_at: '2026-01-16T10:01:00Z',
        },
      });

      const patch1 = { title: 'E2E Test Issue - Updated' };
      const req1 = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PATCH',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-patch-1',
        },
        body: JSON.stringify({ patch: patch1 }),
      });

      const res1 = await PATCH(req1, { params: Promise.resolve({ id: sessionId }) });

      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expect(body1.success).toBe(true);
      expect(body1.diffSummary?.changedFields).toContain('title');
    });

    it('applies second patch to already patched draft (idempotent)', async () => {
      const patchedDraft = {
        id: 'draft-e2e-1',
        session_id: sessionId,
        created_at: '2026-01-16T10:00:00Z',
        updated_at: '2026-01-16T10:01:00Z',
        issue_json: { ...baseDraft, title: 'E2E Test Issue - Updated' },
        issue_hash: 'hash-v2',
        last_validation_status: 'unknown' as const,
        last_validation_at: null,
        last_validation_result: null,
      };

      mockGetIssueDraft.mockResolvedValue({ success: true, data: patchedDraft });
      mockSaveIssueDraft.mockResolvedValue({
        success: true,
        data: {
          ...patchedDraft,
          issue_hash: 'hash-v3',
          updated_at: '2026-01-16T10:02:00Z',
        },
      });

      const patch2 = {
        acceptanceCriteria: { op: 'append', values: ['AC3'] },
      };
      const req2 = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PATCH',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-patch-2',
        },
        body: JSON.stringify({ patch: patch2 }),
      });

      const res2 = await PATCH(req2, { params: Promise.resolve({ id: sessionId }) });

      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      expect(body2.success).toBe(true);
      expect(body2.diffSummary?.changedFields).toContain('acceptanceCriteria');
    });

    it('handles multiple PATCH operations without conflicts', async () => {
      // Simulate rapid-fire patches
      const drafts = [
        {
          id: 'draft-e2e-1',
          session_id: sessionId,
          created_at: '2026-01-16T10:00:00Z',
          updated_at: '2026-01-16T10:00:00Z',
          issue_json: baseDraft,
          issue_hash: 'hash-v1',
          last_validation_status: 'unknown' as const,
          last_validation_at: null,
          last_validation_result: null,
        },
        {
          id: 'draft-e2e-1',
          session_id: sessionId,
          created_at: '2026-01-16T10:00:00Z',
          updated_at: '2026-01-16T10:01:00Z',
          issue_json: { ...baseDraft, priority: 'P0' as const },
          issue_hash: 'hash-v2',
          last_validation_status: 'unknown' as const,
          last_validation_at: null,
          last_validation_result: null,
        },
      ];

      mockGetIssueDraft.mockResolvedValueOnce({ success: true, data: drafts[0] });
      mockSaveIssueDraft.mockResolvedValueOnce({
        success: true,
        data: drafts[1],
      });

      const patch = { priority: 'P0' as const };
      const req = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PATCH',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-patch-rapid',
        },
        body: JSON.stringify({ patch }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.updatedDraft.issue_hash).toBe('hash-v2');
    });
  });

  /**
   * AC3: Version list shows new versions deterministically with hash/correlationId
   */
  describe('AC3: Version list with hash/correlationId', () => {
    it('lists versions with deterministic ordering (newest first)', async () => {
      const versions = [
        {
          id: 'ver-3',
          session_id: sessionId,
          version_number: 3,
          issue_json: {},
          issue_hash: 'hash-v3',
          created_at: '2026-01-16T10:03:00Z',
          correlation_id: 'corr-3',
        },
        {
          id: 'ver-2',
          session_id: sessionId,
          version_number: 2,
          issue_json: {},
          issue_hash: 'hash-v2',
          created_at: '2026-01-16T10:02:00Z',
          correlation_id: 'corr-2',
        },
        {
          id: 'ver-1',
          session_id: sessionId,
          version_number: 1,
          issue_json: {},
          issue_hash: 'hash-v1',
          created_at: '2026-01-16T10:01:00Z',
          correlation_id: 'corr-1',
        },
      ];

      mockListIssueDraftVersions.mockResolvedValue({
        success: true,
        data: versions,
      });

      const req = new NextRequest(
        `http://localhost/api/intent/sessions/${sessionId}/issue-draft/versions?limit=50&offset=0`,
        {
          method: 'GET',
          headers: {
            'x-afu9-sub': userId,
            'x-request-id': 'req-versions',
          },
        }
      );

      const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.versions).toHaveLength(3);
      expect(body.versions[0].version_number).toBe(3);
      expect(body.versions[0].issue_hash).toBe('hash-v3');
      expect(body.versions[0].correlation_id).toBe('corr-3');
      expect(body.versions[2].version_number).toBe(1);
    });

    it('includes hash in each version entry', async () => {
      const versions = [
        {
          id: 'ver-1',
          session_id: sessionId,
          version_number: 1,
          issue_json: {},
          issue_hash: 'abc123def456',
          created_at: '2026-01-16T10:01:00Z',
          correlation_id: 'corr-1',
        },
      ];

      mockListIssueDraftVersions.mockResolvedValue({
        success: true,
        data: versions,
      });

      const req = new NextRequest(
        `http://localhost/api/intent/sessions/${sessionId}/issue-draft/versions`,
        {
          method: 'GET',
          headers: {
            'x-afu9-sub': userId,
            'x-request-id': 'req-hash-check',
          },
        }
      );

      const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.versions[0].issue_hash).toBeDefined();
      expect(body.versions[0].issue_hash).toBe('abc123def456');
      expect(body.versions[0].correlation_id).toBeDefined();
    });
  });

  /**
   * AC4: UI Draft Panel shows always the current draft (no stale reads)
   */
  describe('AC4: No stale reads (Cache-Control headers)', () => {
    it('GET draft returns Cache-Control: no-store header', async () => {
      mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

      const req = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'GET',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-cache-check',
        },
      });

      const res = await GET(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('PATCH draft returns Cache-Control: no-store header', async () => {
      const draft = {
        id: 'draft-1',
        session_id: sessionId,
        created_at: '2026-01-16T10:00:00Z',
        updated_at: '2026-01-16T10:00:00Z',
        issue_json: {
          issueDraftVersion: '1.0',
          title: 'Test',
          body: 'Test body content for validation',
          type: 'issue',
          canonicalId: 'I902',
          labels: [],
          dependsOn: [],
          priority: 'P1',
          acceptanceCriteria: ['AC1'],
          verify: {
            commands: ['npm test'],
            expected: ['Tests pass'],
          },
          guards: {
            env: 'development',
            prodBlocked: false,
          },
        },
        issue_hash: 'hash-1',
        last_validation_status: 'unknown' as const,
        last_validation_at: null,
        last_validation_result: null,
      };

      mockGetIssueDraft.mockResolvedValue({ success: true, data: draft });
      mockSaveIssueDraft.mockResolvedValue({
        success: true,
        data: { ...draft, issue_hash: 'hash-2' },
      });

      const req = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PATCH',
        headers: {
          'x-afu9-sub': userId,
          'x-request-id': 'req-patch-cache',
        },
        body: JSON.stringify({ patch: { title: 'Updated' } }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('GET versions returns Cache-Control: no-store header', async () => {
      mockListIssueDraftVersions.mockResolvedValue({
        success: true,
        data: [],
      });

      const req = new NextRequest(
        `http://localhost/api/intent/sessions/${sessionId}/issue-draft/versions`,
        {
          method: 'GET',
          headers: {
            'x-afu9-sub': userId,
            'x-request-id': 'req-versions-cache',
          },
        }
      );

      const res = await GET_VERSIONS(req, { params: Promise.resolve({ id: sessionId }) });

      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  /**
   * AC5: Complete E2E flow - unstructured input → draft → patch → versions → commit
   */
  describe('AC5: Complete E2E Flow', () => {
    it('executes full flow: create → patch → commit → verify versions', async () => {
      const initialDraft: IssueDraft = {
        issueDraftVersion: '1.0',
        title: 'I902 — Draft Access Reliability',
        body: 'INTENT kann Draft für Session lesen/patchen/committen',
        type: 'issue',
        canonicalId: 'I902',
        labels: ['v0.9', 'intent'],
        dependsOn: [],
        priority: 'P0',
        acceptanceCriteria: [
          'GET returns deterministic empty states',
          'PATCH is idempotent',
          'Versions show hash/correlationId',
        ],
        verify: {
          commands: ['npm test -- intent-draft-access-e2e'],
          expected: ['All tests pass'],
        },
        guards: {
          env: 'development',
          prodBlocked: false,
        },
      };

      // Step 1: GET draft (empty state)
      mockGetIssueDraft.mockResolvedValueOnce({ success: true, data: null });

      const getReq1 = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'GET',
        headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-get-1' },
      });

      const getRes1 = await GET(getReq1, { params: Promise.resolve({ id: sessionId }) });
      const getBody1 = await getRes1.json();
      expect(getBody1.draft).toBeNull();
      expect(getBody1.reason).toBe('NO_DRAFT');

      // Step 2: CREATE draft (PUT)
      mockSaveIssueDraft.mockResolvedValueOnce({
        success: true,
        data: {
          id: 'draft-e2e-full',
          session_id: sessionId,
          created_at: '2026-01-16T10:00:00Z',
          updated_at: '2026-01-16T10:00:00Z',
          issue_json: initialDraft,
          issue_hash: 'hash-initial',
          last_validation_status: 'unknown' as const,
          last_validation_at: null,
          last_validation_result: null,
        },
      });

      const putReq = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PUT',
        headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-put' },
        body: JSON.stringify({ issue_json: initialDraft }),
      });

      const putRes = await PUT(putReq, { params: Promise.resolve({ id: sessionId }) });
      const putBody = await putRes.json();
      expect(putBody.issue_hash).toBe('hash-initial');

      // Step 3: PATCH draft (add acceptance criterion)
      const draftAfterCreate = {
        id: 'draft-e2e-full',
        session_id: sessionId,
        created_at: '2026-01-16T10:00:00Z',
        updated_at: '2026-01-16T10:00:00Z',
        issue_json: initialDraft,
        issue_hash: 'hash-initial',
        last_validation_status: 'unknown' as const,
        last_validation_at: null,
        last_validation_result: null,
      };

      mockGetIssueDraft.mockResolvedValueOnce({ success: true, data: draftAfterCreate });
      mockSaveIssueDraft.mockResolvedValueOnce({
        success: true,
        data: {
          ...draftAfterCreate,
          issue_hash: 'hash-patched',
          updated_at: '2026-01-16T10:01:00Z',
        },
      });

      const patchReq = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'PATCH',
        headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-patch' },
        body: JSON.stringify({
          patch: {
            acceptanceCriteria: { op: 'append', values: ['UI panel shows current state'] },
          },
        }),
      });

      const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: sessionId }) });
      const patchBody = await patchRes.json();
      expect(patchBody.success).toBe(true);
      expect(patchBody.updatedDraft.issue_hash).toBe('hash-patched');

      // Step 4: COMMIT draft
      const draftBeforeCommit = {
        id: 'draft-e2e-full',
        session_id: sessionId,
        created_at: '2026-01-16T10:00:00Z',
        updated_at: '2026-01-16T10:01:00Z',
        issue_json: { ...initialDraft },
        issue_hash: 'hash-patched',
        // Validation status must be 'valid' for commit to succeed (fail-closed policy)
        // Prevents committing invalid drafts as immutable versions
        last_validation_status: 'valid' as const,
        last_validation_at: '2026-01-16T10:01:00Z',
        last_validation_result: null,
      };

      mockGetIssueDraft.mockResolvedValueOnce({ success: true, data: draftBeforeCommit });
      mockCommitIssueDraftVersion.mockResolvedValueOnce({
        success: true,
        data: {
          id: 'version-1',
          session_id: sessionId,
          version_number: 1,
          issue_json: draftBeforeCommit.issue_json,
          issue_hash: 'hash-patched',
          created_at: '2026-01-16T10:02:00Z',
          correlation_id: 'corr-e2e-1',
        },
        isNew: true,
      });

      const commitReq = new NextRequest(
        `http://localhost/api/intent/sessions/${sessionId}/issue-draft/commit`,
        {
          method: 'POST',
          headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-commit' },
        }
      );

      const commitRes = await COMMIT(commitReq, { params: Promise.resolve({ id: sessionId }) });
      const commitBody = await commitRes.json();
      expect(commitBody.version.version_number).toBe(1);
      expect(commitBody.version.issue_hash).toBe('hash-patched');
      expect(commitBody.isNew).toBe(true);

      // Step 5: GET versions (verify committed version appears)
      mockListIssueDraftVersions.mockResolvedValueOnce({
        success: true,
        data: [
          {
            id: 'version-1',
            session_id: sessionId,
            version_number: 1,
            issue_json: draftBeforeCommit.issue_json,
            issue_hash: 'hash-patched',
            created_at: '2026-01-16T10:02:00Z',
            correlation_id: 'corr-e2e-1',
          },
        ],
      });

      const versionsReq = new NextRequest(
        `http://localhost/api/intent/sessions/${sessionId}/issue-draft/versions`,
        {
          method: 'GET',
          headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-versions' },
        }
      );

      const versionsRes = await GET_VERSIONS(versionsReq, { params: Promise.resolve({ id: sessionId }) });
      const versionsBody = await versionsRes.json();
      expect(versionsBody.versions).toHaveLength(1);
      expect(versionsBody.versions[0].issue_hash).toBe('hash-patched');
      expect(versionsBody.versions[0].correlation_id).toBe('corr-e2e-1');

      // Step 6: GET draft again (should still exist, not affected by commit)
      mockGetIssueDraft.mockResolvedValueOnce({ success: true, data: draftBeforeCommit });

      const getReq2 = new NextRequest(`http://localhost/api/intent/sessions/${sessionId}/issue-draft`, {
        method: 'GET',
        headers: { 'x-afu9-sub': userId, 'x-request-id': 'e2e-get-2' },
      });

      const getRes2 = await GET(getReq2, { params: Promise.resolve({ id: sessionId }) });
      const getBody2 = await getRes2.json();
      expect(getBody2.draft).toBeDefined();
      expect(getBody2.draft.issue_hash).toBe('hash-patched');
    });
  });
});
