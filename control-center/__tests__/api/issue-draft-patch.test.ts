/**
 * Integration tests for PATCH /api/intent/sessions/[id]/issue-draft (E86.5)
 *
 * Tests:
 * - PATCH applies patch to existing draft
 * - PATCH returns 404 if no draft exists
 * - PATCH validates whitelist (rejects unknown fields)
 * - PATCH with validateAfterUpdate returns validation result
 * - PATCH fails on evidence insert failure (fail-closed)
 *
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, PUT, PATCH } from '../../app/api/intent/sessions/[id]/issue-draft/route';
import * as intentIssueDrafts from '../../src/lib/db/intentIssueDrafts';
import * as intentIssueAuthoringEvents from '../../src/lib/db/intentIssueAuthoringEvents';
import type { IssueDraft } from '../../src/lib/schemas/issueDraft';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/db/intentIssueDrafts');
jest.mock('../../src/lib/db/intentIssueAuthoringEvents');
jest.mock('../../src/lib/lawbook-version-helper', () => ({
  getActiveLawbookVersion: jest.fn(async () => ({ hash: 'test-lawbook-hash' })),
}));
jest.mock('../../src/lib/utils/deployment-env', () => ({
  getDeploymentEnv: jest.fn(() => 'development'),
}));

describe('PATCH /api/intent/sessions/[id]/issue-draft', () => {
  const mockGetIssueDraft = intentIssueDrafts.getIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.getIssueDraft
  >;
  const mockSaveIssueDraft = intentIssueDrafts.saveIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.saveIssueDraft
  >;
  const mockValidateAndSaveIssueDraft = intentIssueDrafts.validateAndSaveIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.validateAndSaveIssueDraft
  >;
  const mockInsertEvent = intentIssueAuthoringEvents.insertEvent as jest.MockedFunction<
    typeof intentIssueAuthoringEvents.insertEvent
  >;

  const baseDraft: IssueDraft = {
    issueDraftVersion: '1.0',
    title: 'Test Issue',
    body: 'Test body content for the issue draft',
    type: 'issue',
    canonicalId: 'E86.5',
    labels: ['v0.8', 'epic:E86'],
    dependsOn: [],
    priority: 'P1',
    acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
    verify: {
      commands: ['npm test'],
      expected: ['Tests pass'],
    },
    guards: {
      env: 'development',
      prodBlocked: true,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockInsertEvent.mockResolvedValue({ success: true });
  });

  test('applies patch to existing draft successfully', async () => {
    const mockExistingDraft = {
      id: 'draft-123',
      session_id: 'session-1',
      created_at: '2026-01-14T10:00:00Z',
      updated_at: '2026-01-14T10:00:00Z',
      issue_json: baseDraft,
      issue_hash: 'old-hash',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockExistingDraft });
    mockSaveIssueDraft.mockResolvedValue({
      success: true,
      data: {
        ...mockExistingDraft,
        issue_hash: 'new-hash',
        updated_at: '2026-01-14T10:05:00Z',
      },
    });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-123',
      },
      body: JSON.stringify({
        patch: {
          title: 'Updated Title',
          labels: { op: 'append', values: ['new-label'] },
        },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.updatedDraft).toBeDefined();
    expect(body.diffSummary).toBeDefined();
    expect(body.diffSummary.changedFields).toContain('title');
    expect(body.diffSummary.changedFields).toContain('labels');
    expect(body.evidenceRecorded).toBe(true);
  });

  test('returns 404 if no draft exists', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-456',
      },
      body: JSON.stringify({
        patch: { title: 'Updated Title' },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_DRAFT');
  });

  test('rejects patch with unknown fields', async () => {
    const mockExistingDraft = {
      id: 'draft-123',
      session_id: 'session-1',
      created_at: '2026-01-14T10:00:00Z',
      updated_at: '2026-01-14T10:00:00Z',
      issue_json: baseDraft,
      issue_hash: 'old-hash',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockExistingDraft });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-789',
      },
      body: JSON.stringify({
        patch: {
          title: 'Updated Title',
          unknownField: 'value',
        },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toContain('PATCH');
  });

  test('validates after update when requested', async () => {
    const mockExistingDraft = {
      id: 'draft-123',
      session_id: 'session-1',
      created_at: '2026-01-14T10:00:00Z',
      updated_at: '2026-01-14T10:00:00Z',
      issue_json: baseDraft,
      issue_hash: 'old-hash',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    const mockValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      meta: {
        validatedAt: '2026-01-14T10:05:00Z',
        validatorVersion: '1.0',
      },
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockExistingDraft });
    mockValidateAndSaveIssueDraft.mockResolvedValue({
      success: true,
      data: {
        ...mockExistingDraft,
        issue_hash: 'new-hash',
        updated_at: '2026-01-14T10:05:00Z',
        last_validation_status: 'valid',
        last_validation_at: '2026-01-14T10:05:00Z',
        last_validation_result: mockValidationResult,
      },
      validation: mockValidationResult,
    });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-abc',
      },
      body: JSON.stringify({
        patch: { title: 'Updated Title' },
        validateAfterUpdate: true,
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.validation).toBeDefined();
    expect(body.validation.isValid).toBe(true);
  });

  test('fails closed on evidence insert failure', async () => {
    const mockExistingDraft = {
      id: 'draft-123',
      session_id: 'session-1',
      created_at: '2026-01-14T10:00:00Z',
      updated_at: '2026-01-14T10:00:00Z',
      issue_json: baseDraft,
      issue_hash: 'old-hash',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockExistingDraft });
    mockSaveIssueDraft.mockResolvedValue({
      success: true,
      data: {
        ...mockExistingDraft,
        issue_hash: 'new-hash',
        updated_at: '2026-01-14T10:05:00Z',
      },
    });
    mockInsertEvent.mockResolvedValue({ success: false, error: 'DB error' });

    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-def',
      },
      body: JSON.stringify({
        patch: { title: 'Updated Title' },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Evidence');
    expect(body.details).toBeDefined();
    expect(body.details.code).toBe('EVIDENCE_INSERT_FAILED');
  });

  test('returns 400 if patch is missing in body', async () => {
    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-afu9-sub': 'user-1',
        'x-request-id': 'req-ghi',
      },
      body: JSON.stringify({}),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('patch');
  });

  test('returns 401 if user not authenticated', async () => {
    const req = new NextRequest('http://localhost/api/intent/sessions/session-1/issue-draft', {
      method: 'PATCH',
      headers: {
        'x-request-id': 'req-jkl',
      },
      body: JSON.stringify({
        patch: { title: 'Updated Title' },
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'session-1' }) });

    expect(res.status).toBe(401);
  });
});
