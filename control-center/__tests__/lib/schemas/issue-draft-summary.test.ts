/**
 * Tests for Issue Draft Summary Schema v1
 * 
 * V09-I03: Draft Awareness Snapshot v1 (Get Draft Summary)
 * 
 * Covers:
 * - Empty state returns exists:false + reason:"NO_DRAFT"
 * - Summary contains deterministic fields
 * - bodyHash is stable (first 12 chars)
 * - No PHI/Secrets in summary
 * 
 * @jest-environment node
 */

import {
  IssueDraftSummaryV1Schema,
  createEmptyDraftSummary,
  createDraftSummary,
  type IssueDraftSummaryV1,
} from '../../../src/lib/schemas/issueDraftSummary';

describe('IssueDraftSummaryV1Schema', () => {
  describe('Schema validation', () => {
    it('validates a complete summary', () => {
      const summary: IssueDraftSummaryV1 = {
        exists: true,
        canonicalId: 'E81.1',
        title: 'Test Issue',
        updatedAt: '2026-01-16T10:00:00Z',
        validationStatus: 'VALID',
        bodyHash: 'abc123def456',
      };

      const result = IssueDraftSummaryV1Schema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('validates an empty state summary', () => {
      const summary: IssueDraftSummaryV1 = {
        exists: false,
        reason: 'NO_DRAFT',
        validationStatus: 'UNKNOWN',
      };

      const result = IssueDraftSummaryV1Schema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('rejects invalid validationStatus', () => {
      const summary = {
        exists: true,
        validationStatus: 'MAYBE',
      };

      const result = IssueDraftSummaryV1Schema.safeParse(summary);
      expect(result.success).toBe(false);
    });

    it('rejects extra fields (strict mode)', () => {
      const summary = {
        exists: true,
        validationStatus: 'VALID',
        extraField: 'not allowed',
      };

      const result = IssueDraftSummaryV1Schema.safeParse(summary);
      expect(result.success).toBe(false);
    });

    it('accepts all validation statuses: VALID, INVALID, UNKNOWN', () => {
      const statuses = ['VALID', 'INVALID', 'UNKNOWN'] as const;
      
      statuses.forEach(status => {
        const summary: IssueDraftSummaryV1 = {
          exists: true,
          validationStatus: status,
        };

        const result = IssueDraftSummaryV1Schema.safeParse(summary);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('createEmptyDraftSummary', () => {
    it('returns empty state with exists:false and reason:NO_DRAFT', () => {
      const summary = createEmptyDraftSummary();

      expect(summary.exists).toBe(false);
      expect(summary.reason).toBe('NO_DRAFT');
      expect(summary.validationStatus).toBe('UNKNOWN');
      expect(summary.canonicalId).toBeUndefined();
      expect(summary.title).toBeUndefined();
      expect(summary.updatedAt).toBeUndefined();
      expect(summary.bodyHash).toBeUndefined();
    });

    it('creates deterministic empty state (stable)', () => {
      const summary1 = createEmptyDraftSummary();
      const summary2 = createEmptyDraftSummary();

      expect(summary1).toEqual(summary2);
    });
  });

  describe('createDraftSummary', () => {
    it('creates summary from draft data with valid status', () => {
      const draft = {
        issue_json: {
          canonicalId: 'E81.1',
          title: 'Test Issue Draft',
          body: 'Test body content',
        },
        issue_hash: 'abc123def456789',
        updated_at: '2026-01-16T10:00:00Z',
        last_validation_status: 'valid' as const,
      };

      const summary = createDraftSummary(draft);

      expect(summary.exists).toBe(true);
      expect(summary.canonicalId).toBe('E81.1');
      expect(summary.title).toBe('Test Issue Draft');
      expect(summary.updatedAt).toBe('2026-01-16T10:00:00Z');
      expect(summary.validationStatus).toBe('VALID');
      expect(summary.bodyHash).toBe('abc123def456'); // First 12 chars
      expect(summary.reason).toBeUndefined();
    });

    it('creates summary from draft data with invalid status', () => {
      const draft = {
        issue_json: {
          canonicalId: 'E81.2',
          title: 'Invalid Draft',
        },
        issue_hash: 'xyz789abc123def',
        updated_at: '2026-01-16T11:00:00Z',
        last_validation_status: 'invalid' as const,
      };

      const summary = createDraftSummary(draft);

      expect(summary.exists).toBe(true);
      expect(summary.validationStatus).toBe('INVALID');
      expect(summary.bodyHash).toBe('xyz789abc123'); // First 12 chars
    });

    it('creates summary from draft data with unknown status', () => {
      const draft = {
        issue_json: {
          canonicalId: 'E81.3',
          title: 'Unknown Status Draft',
        },
        issue_hash: 'def456ghi789jkl',
        updated_at: '2026-01-16T12:00:00Z',
        last_validation_status: 'unknown' as const,
      };

      const summary = createDraftSummary(draft);

      expect(summary.exists).toBe(true);
      expect(summary.validationStatus).toBe('UNKNOWN');
      expect(summary.bodyHash).toBe('def456ghi789'); // First 12 chars
    });

    it('handles missing canonicalId and title gracefully', () => {
      const draft = {
        issue_json: {
          body: 'Body without title or ID',
        },
        issue_hash: 'abc123',
        updated_at: '2026-01-16T13:00:00Z',
        last_validation_status: 'unknown' as const,
      };

      const summary = createDraftSummary(draft);

      expect(summary.exists).toBe(true);
      expect(summary.canonicalId).toBeUndefined();
      expect(summary.title).toBeUndefined();
      expect(summary.validationStatus).toBe('UNKNOWN');
    });

    it('handles invalid issue_json gracefully', () => {
      const draft = {
        issue_json: null,
        issue_hash: 'abc123',
        updated_at: '2026-01-16T14:00:00Z',
        last_validation_status: 'invalid' as const,
      };

      const summary = createDraftSummary(draft);

      expect(summary.exists).toBe(true);
      expect(summary.canonicalId).toBeUndefined();
      expect(summary.title).toBeUndefined();
      expect(summary.validationStatus).toBe('INVALID');
    });

    it('creates deterministic hash for same input (stable)', () => {
      const draft = {
        issue_json: {
          canonicalId: 'E81.1',
          title: 'Test',
        },
        issue_hash: 'abc123def456',
        updated_at: '2026-01-16T15:00:00Z',
        last_validation_status: 'valid' as const,
      };

      const summary1 = createDraftSummary(draft);
      const summary2 = createDraftSummary(draft);

      expect(summary1.bodyHash).toBe(summary2.bodyHash);
      expect(summary1).toEqual(summary2);
    });

    it('does not include PHI or secrets', () => {
      const draft = {
        issue_json: {
          canonicalId: 'E81.1',
          title: 'Test Issue with sensitive data',
          body: 'This contains PII: user@example.com, SSN: 123-45-6789',
          // Body with potential PII is hashed, not included in summary
        },
        issue_hash: 'sensitive123',
        updated_at: '2026-01-16T16:00:00Z',
        last_validation_status: 'valid' as const,
      };

      const summary = createDraftSummary(draft);

      // Summary should only contain safe fields
      expect(summary.canonicalId).toBe('E81.1');
      expect(summary.title).toBe('Test Issue with sensitive data');
      expect(summary.bodyHash).toBe('sensitive123'); // Hash only, not content
      
      // No body content in summary
      expect(Object.keys(summary)).not.toContain('body');
      expect(JSON.stringify(summary)).not.toContain('user@example.com');
      expect(JSON.stringify(summary)).not.toContain('123-45-6789');
    });
  });

  describe('Acceptance criteria validation', () => {
    it('meets AC: exists boolean is present', () => {
      const empty = createEmptyDraftSummary();
      const draft = createDraftSummary({
        issue_json: { canonicalId: 'E81.1' },
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(typeof empty.exists).toBe('boolean');
      expect(typeof draft.exists).toBe('boolean');
      expect(empty.exists).toBe(false);
      expect(draft.exists).toBe(true);
    });

    it('meets AC: canonicalId is optional string', () => {
      const withId = createDraftSummary({
        issue_json: { canonicalId: 'E81.1' },
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      const withoutId = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(withId.canonicalId).toBe('E81.1');
      expect(withoutId.canonicalId).toBeUndefined();
    });

    it('meets AC: title is optional string', () => {
      const withTitle = createDraftSummary({
        issue_json: { title: 'Test Title' },
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      const withoutTitle = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(withTitle.title).toBe('Test Title');
      expect(withoutTitle.title).toBeUndefined();
    });

    it('meets AC: updatedAt is optional datetime string', () => {
      const summary = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(summary.updatedAt).toBe('2026-01-16T17:00:00Z');
      
      // Validate it's a valid datetime
      const parsed = IssueDraftSummaryV1Schema.safeParse(summary);
      expect(parsed.success).toBe(true);
    });

    it('meets AC: validationStatus is VALID|INVALID|UNKNOWN', () => {
      const valid = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      const invalid = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'invalid',
      });

      const unknown = createDraftSummary({
        issue_json: {},
        issue_hash: 'abc123',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'unknown',
      });

      expect(valid.validationStatus).toBe('VALID');
      expect(invalid.validationStatus).toBe('INVALID');
      expect(unknown.validationStatus).toBe('UNKNOWN');
    });

    it('meets AC: bodyHash is optional string (first 12 chars)', () => {
      const summary = createDraftSummary({
        issue_json: {},
        issue_hash: 'abcdefghijklmnopqrstuvwxyz',
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(summary.bodyHash).toBe('abcdefghijkl');
      expect(summary.bodyHash?.length).toBe(12);
    });

    it('meets AC: empty state has exists:false + reason:NO_DRAFT', () => {
      const summary = createEmptyDraftSummary();

      expect(summary.exists).toBe(false);
      expect(summary.reason).toBe('NO_DRAFT');
      // Not an error - just a state
      expect(Object.keys(summary)).not.toContain('error');
      expect(Object.keys(summary)).not.toContain('code');
    });

    it('meets AC: deterministic hash (same body → same hash)', () => {
      const hash = 'abc123def456';
      
      const summary1 = createDraftSummary({
        issue_json: { title: 'Same' },
        issue_hash: hash,
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      const summary2 = createDraftSummary({
        issue_json: { title: 'Same' },
        issue_hash: hash,
        updated_at: '2026-01-16T17:00:00Z',
        last_validation_status: 'valid',
      });

      expect(summary1.bodyHash).toBe(summary2.bodyHash);
    });
  });
});
