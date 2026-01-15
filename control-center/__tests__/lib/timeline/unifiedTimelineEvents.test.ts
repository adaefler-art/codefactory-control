/**
 * Unified Timeline Events Tests (E87.3)
 * 
 * Tests for unified timeline events:
 * - Schema validation (strict Zod schemas)
 * - Summary formatting (deterministic)
 * - Details sanitization (no secrets, bounded sizes)
 * - Backlinks generation
 * 
 * @jest-environment node
 */

import {
  UnifiedTimelineEventInputSchema,
  formatApprovalSummary,
  formatPolicySummary,
  formatPRSummary,
  formatIssuePublishSummary,
  sanitizeDetails,
  buildBacklinks,
  validateTimelineEventInput,
  TimelineQueryFilterSchema,
} from '../../../src/lib/timeline/unifiedTimelineEvents';

describe('UnifiedTimelineEvents - Schema Validation', () => {
  describe('UnifiedTimelineEventInputSchema', () => {
    test('validates valid event input', () => {
      const validInput = {
        event_type: 'approval_approved',
        timestamp: new Date().toISOString(),
        actor: 'user@example.com',
        session_id: '19eacd15-4925-4b53-90b8-99751843e19f',
        canonical_id: null,
        gh_issue_number: null,
        pr_number: 123,
        workflow_run_id: null,
        subject_type: 'pr',
        subject_identifier: 'owner/repo#123',
        request_id: 'req-123',
        lawbook_hash: null,
        evidence_hash: null,
        context_pack_id: null,
        links: {},
        summary: 'user@example.com approved merge for owner/repo#123',
        details: {},
      };

      const result = UnifiedTimelineEventInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    test('rejects invalid event_type', () => {
      const invalidInput = {
        event_type: 'invalid_event',
        timestamp: new Date().toISOString(),
        actor: 'user@example.com',
        subject_type: 'pr',
        subject_identifier: 'owner/repo#123',
        request_id: 'req-123',
        summary: 'test',
      };

      const result = UnifiedTimelineEventInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    test('rejects summary longer than 500 chars', () => {
      const invalidInput = {
        event_type: 'approval_approved',
        timestamp: new Date().toISOString(),
        actor: 'user@example.com',
        subject_type: 'pr',
        subject_identifier: 'owner/repo#123',
        request_id: 'req-123',
        summary: 'x'.repeat(501), // Too long
      };

      const result = UnifiedTimelineEventInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });

    test('accepts valid lawbook_hash (64 chars)', () => {
      const validInput = {
        event_type: 'approval_approved',
        timestamp: new Date().toISOString(),
        actor: 'user@example.com',
        subject_type: 'pr',
        subject_identifier: 'owner/repo#123',
        request_id: 'req-123',
        summary: 'test',
        lawbook_hash: 'a'.repeat(64), // Valid SHA-256 length
      };

      const result = UnifiedTimelineEventInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });
  });

  describe('TimelineQueryFilterSchema', () => {
    test('validates valid filter', () => {
      const validFilter = {
        session_id: '19eacd15-4925-4b53-90b8-99751843e19f',
        limit: 50,
        offset: 0,
      };

      const result = TimelineQueryFilterSchema.safeParse(validFilter);
      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(50);
    });

    test('applies default limit', () => {
      const filter = {
        session_id: '19eacd15-4925-4b53-90b8-99751843e19f',
      };

      const result = TimelineQueryFilterSchema.safeParse(filter);
      expect(result.success).toBe(true);
      expect(result.data?.limit).toBe(100); // Default
    });
  });
});

describe('UnifiedTimelineEvents - Deterministic Summary Formatting', () => {
  test('formatApprovalSummary is deterministic', () => {
    const summary1 = formatApprovalSummary('approved', 'merge', 'owner/repo#123', 'user@example.com');
    const summary2 = formatApprovalSummary('approved', 'merge', 'owner/repo#123', 'user@example.com');

    expect(summary1).toBe(summary2);
    expect(summary1).toBe('user@example.com approved merge for owner/repo#123');
  });

  test('formatPolicySummary truncates to 500 chars', () => {
    const longReason = 'x'.repeat(600);
    const summary = formatPolicySummary('allowed', 'action', 'target', longReason);

    expect(summary.length).toBeLessThanOrEqual(500);
  });

  test('formatPRSummary formats correctly', () => {
    const summary = formatPRSummary('pr_merged', 'owner/repo#123', 'user@example.com');

    expect(summary).toBe('user@example.com merged owner/repo#123');
  });

  test('formatIssuePublishSummary is deterministic', () => {
    const summary1 = formatIssuePublishSummary('create', 'owner/repo#789', 'CR-2026-01-02-001');
    const summary2 = formatIssuePublishSummary('create', 'owner/repo#789', 'CR-2026-01-02-001');

    expect(summary1).toBe(summary2);
  });
});

describe('UnifiedTimelineEvents - Security', () => {
  test('sanitizeDetails removes sensitive keys', () => {
    const details = {
      user: 'alice',
      password: 'secret123',
      apiKey: 'key-abc',
      token: 'token-xyz',
      normalField: 'value',
    };

    const sanitized = sanitizeDetails(details);

    expect(sanitized).not.toHaveProperty('password');
    expect(sanitized).not.toHaveProperty('apiKey');
    expect(sanitized).not.toHaveProperty('token');
    expect(sanitized).toHaveProperty('user', 'alice');
    expect(sanitized).toHaveProperty('normalField', 'value');
  });

  test('sanitizeDetails truncates long strings', () => {
    const details = {
      longField: 'x'.repeat(1500),
      shortField: 'short',
    };

    const sanitized = sanitizeDetails(details);

    expect(sanitized.longField.length).toBe(1000); // 997 + '...'
    expect(sanitized.longField).toContain('...');
    expect(sanitized.shortField).toBe('short');
  });
});

describe('UnifiedTimelineEvents - Backlinks', () => {
  test('buildBacklinks creates all link types', () => {
    const links = buildBacklinks({
      sessionId: '19eacd15-4925-4b53-90b8-99751843e19f',
      canonicalId: 'CR-2026-01-02-001',
      ghIssueNumber: 123,
      prNumber: 456,
      owner: 'adaefler-art',
      repo: 'codefactory-control',
    });

    expect(Object.keys(links).length).toBe(4);
    expect(links).toHaveProperty('afu9SessionUrl');
    expect(links).toHaveProperty('afu9IssueUrl');
    expect(links).toHaveProperty('ghIssueUrl');
    expect(links).toHaveProperty('ghPrUrl');
  });

  test('buildBacklinks handles empty params', () => {
    const links = buildBacklinks({});

    expect(links).toEqual({});
  });
});

describe('UnifiedTimelineEvents - Helper Functions', () => {
  test('validateTimelineEventInput validates correct input', () => {
    const input = {
      event_type: 'approval_approved',
      timestamp: new Date().toISOString(),
      actor: 'user@example.com',
      subject_type: 'pr',
      subject_identifier: 'owner/repo#123',
      request_id: 'req-123',
      summary: 'test summary',
    };

    const result = validateTimelineEventInput(input);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  test('validateTimelineEventInput returns error for invalid input', () => {
    const input = {
      event_type: 'invalid',
      timestamp: 'not-a-date',
    };

    const result = validateTimelineEventInput(input);

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});
