/**
 * Tests for get_issue_draft_summary tool
 * 
 * V09-I03: Draft Awareness Snapshot v1 (Get Draft Summary)
 * 
 * Covers:
 * - Returns summary with exists:true when draft exists
 * - Returns summary with exists:false + reason:NO_DRAFT when no draft
 * - Handles database errors gracefully
 * 
 * @jest-environment node
 */

import { executeIntentTool, type ToolContext } from '../../src/lib/intent-agent-tool-executor';
import * as intentIssueDrafts from '../../src/lib/db/intentIssueDrafts';

jest.mock('../../src/lib/db', () => ({
  getPool: jest.fn(() => ({})),
}));

jest.mock('../../src/lib/db/intentIssueDrafts');
jest.mock('../../src/lib/db/toolExecutionAudit', () => ({
  logToolExecution: jest.fn(() => Promise.resolve()),
}));

describe('get_issue_draft_summary tool', () => {
  const mockGetIssueDraft = intentIssueDrafts.getIssueDraft as jest.MockedFunction<
    typeof intentIssueDrafts.getIssueDraft
  >;

  const context: ToolContext = {
    userId: 'user-123',
    sessionId: 'session-456',
    triggerType: 'AUTO_ALLOWED',
    conversationMode: 'FREE',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns summary with exists:true when draft exists', async () => {
    const mockDraft = {
      id: 'draft-789',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: {
        canonicalId: 'E81.1',
        title: 'Test Issue Draft',
        body: 'Test body content',
      },
      issue_hash: 'abc123def456789',
      last_validation_status: 'valid' as const,
      last_validation_at: '2026-01-16T12:00:00Z',
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.exists).toBe(true);
    expect(parsed.summary.canonicalId).toBe('E81.1');
    expect(parsed.summary.title).toBe('Test Issue Draft');
    expect(parsed.summary.updatedAt).toBe('2026-01-16T12:00:00Z');
    expect(parsed.summary.validationStatus).toBe('VALID');
    expect(parsed.summary.bodyHash).toBe('abc123def456'); // First 12 chars
  });

  it('returns summary with exists:false when no draft exists', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.exists).toBe(false);
    expect(parsed.summary.reason).toBe('NO_DRAFT');
    expect(parsed.summary.validationStatus).toBe('UNKNOWN');
    expect(parsed.summary.canonicalId).toBeUndefined();
    expect(parsed.summary.title).toBeUndefined();
  });

  it('returns error when database operation fails', async () => {
    mockGetIssueDraft.mockResolvedValue({ success: false, error: 'Database error' });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBe('Database error');
    expect(parsed.code).toBe('ISSUE_DRAFT_GET_FAILED');
  });

  it('maps validation status correctly: valid -> VALID', async () => {
    const mockDraft = {
      id: 'draft-1',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { canonicalId: 'E81.1' },
      issue_hash: 'abc123',
      last_validation_status: 'valid' as const,
      last_validation_at: '2026-01-16T12:00:00Z',
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.summary.validationStatus).toBe('VALID');
  });

  it('maps validation status correctly: invalid -> INVALID', async () => {
    const mockDraft = {
      id: 'draft-2',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { canonicalId: 'E81.2' },
      issue_hash: 'def456',
      last_validation_status: 'invalid' as const,
      last_validation_at: '2026-01-16T12:00:00Z',
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.summary.validationStatus).toBe('INVALID');
  });

  it('maps validation status correctly: unknown -> UNKNOWN', async () => {
    const mockDraft = {
      id: 'draft-3',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { canonicalId: 'E81.3' },
      issue_hash: 'ghi789',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.summary.validationStatus).toBe('UNKNOWN');
  });

  it('handles draft without canonicalId gracefully', async () => {
    const mockDraft = {
      id: 'draft-4',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { body: 'Some content without ID' },
      issue_hash: 'jkl012',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.summary.exists).toBe(true);
    expect(parsed.summary.canonicalId).toBeUndefined();
  });

  it('handles draft without title gracefully', async () => {
    const mockDraft = {
      id: 'draft-5',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { canonicalId: 'E81.4' },
      issue_hash: 'mno345',
      last_validation_status: 'unknown' as const,
      last_validation_at: null,
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.summary.exists).toBe(true);
    expect(parsed.summary.title).toBeUndefined();
  });

  it('truncates bodyHash to 12 characters', async () => {
    const longHash = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const mockDraft = {
      id: 'draft-6',
      session_id: 'session-456',
      created_at: '2026-01-16T10:00:00Z',
      updated_at: '2026-01-16T12:00:00Z',
      issue_json: { canonicalId: 'E81.5' },
      issue_hash: longHash,
      last_validation_status: 'valid' as const,
      last_validation_at: '2026-01-16T12:00:00Z',
      last_validation_result: null,
    };

    mockGetIssueDraft.mockResolvedValue({ success: true, data: mockDraft });

    const result = await executeIntentTool('get_issue_draft_summary', {}, context);
    const parsed = JSON.parse(result);

    expect(parsed.summary.bodyHash).toBe('abcdefghijkl');
    expect(parsed.summary.bodyHash.length).toBe(12);
  });

  it('is not blocked by tool gating (read-only operation)', async () => {
    // get_issue_draft_summary is NOT a draft-mutating tool
    mockGetIssueDraft.mockResolvedValue({ success: true, data: null });

    const freeContext: ToolContext = {
      userId: 'user-123',
      sessionId: 'session-456',
      triggerType: 'AUTO_ALLOWED',
      conversationMode: 'FREE',
    };

    const result = await executeIntentTool('get_issue_draft_summary', {}, freeContext);
    const parsed = JSON.parse(result);

    // Should succeed, not blocked
    expect(parsed.success).toBe(true);
    expect(parsed.code).not.toBe('DRAFT_TOOL_BLOCKED_IN_FREE_MODE');
  });
});
