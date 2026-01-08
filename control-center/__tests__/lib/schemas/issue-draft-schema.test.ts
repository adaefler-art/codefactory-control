/**
 * Tests for Issue Draft Schema v1
 * Issue E81.1: Issue Draft Schema v1 + Validator (Zod) + Examples
 * 
 * Test coverage:
 * - Valid examples pass validation
 * - Missing required fields fail
 * - Unknown fields rejected (strict mode)
 * - Bounds violations caught (DoS-safe)
 * - Canonical ID format validation
 * - Label deduplication and sorting
 * - Error ordering determinism
 */

import {
  IssueDraftSchema,
  validateIssueDraft,
  normalizeIssueDraft,
  EXAMPLE_MINIMAL_ISSUE_DRAFT,
  EXAMPLE_FULL_ISSUE_DRAFT,
  ISSUE_DRAFT_VERSION,
  CanonicalIdSchema,
  type IssueDraft,
} from '../../../src/lib/schemas/issueDraft';

describe('IssueDraftSchema', () => {
  describe('Valid Examples', () => {
    it('should validate minimal example', () => {
      const result = IssueDraftSchema.parse(EXAMPLE_MINIMAL_ISSUE_DRAFT);
      expect(result).toEqual(EXAMPLE_MINIMAL_ISSUE_DRAFT);
    });

    it('should validate full example', () => {
      const result = IssueDraftSchema.parse(EXAMPLE_FULL_ISSUE_DRAFT);
      expect(result).toEqual(EXAMPLE_FULL_ISSUE_DRAFT);
    });

    it('should validate issue draft with all required fields', () => {
      const draft: IssueDraft = {
        issueDraftVersion: '1.0',
        title: 'Test Issue',
        body: 'Canonical-ID: I811\n\nTest body content here.',
        type: 'issue',
        canonicalId: 'I811',
        labels: ['test'],
        dependsOn: [],
        priority: 'P2',
        acceptanceCriteria: ['AC1'],
        verify: {
          commands: ['test'],
          expected: ['pass'],
        },
        guards: {
          env: 'development',
          prodBlocked: true,
        },
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result).toEqual(draft);
    });

    it('should validate epic type', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        type: 'epic',
        canonicalId: 'E81.1',
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result.type).toBe('epic');
    });

    it('should validate all priority levels', () => {
      const priorities: Array<'P0' | 'P1' | 'P2'> = ['P0', 'P1', 'P2'];
      
      for (const priority of priorities) {
        const draft: IssueDraft = {
          ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
          priority,
        };
        const result = IssueDraftSchema.parse(draft);
        expect(result.priority).toBe(priority);
      }
    });

    it('should validate all KPI DCU values', () => {
      const dcuValues: Array<0.5 | 1 | 2> = [0.5, 1, 2];
      
      for (const dcu of dcuValues) {
        const draft: IssueDraft = {
          ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
          kpi: { dcu },
        };
        const result = IssueDraftSchema.parse(draft);
        expect(result.kpi?.dcu).toBe(dcu);
      }
    });

    it('should validate KPI with intent string', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        kpi: {
          dcu: 1,
          intent: 'Improve developer experience',
        },
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result.kpi?.intent).toBe('Improve developer experience');
    });

    it('should validate both environment types', () => {
      const environments: Array<'staging' | 'development'> = ['staging', 'development'];
      
      for (const env of environments) {
        const draft: IssueDraft = {
          ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
          guards: {
            env,
            prodBlocked: true,
          },
        };
        const result = IssueDraftSchema.parse(draft);
        expect(result.guards.env).toBe(env);
      }
    });
  });

  describe('Required Fields', () => {
    it('should reject missing issueDraftVersion', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).issueDraftVersion;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing title', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).title;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing body', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).body;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing type', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).type;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing canonicalId', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).canonicalId;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing labels', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).labels;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing dependsOn', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).dependsOn;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing priority', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).priority;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing acceptanceCriteria', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).acceptanceCriteria;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing verify', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).verify;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject missing guards', () => {
      const draft = { ...EXAMPLE_MINIMAL_ISSUE_DRAFT };
      delete (draft as any).guards;

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject empty acceptanceCriteria array', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        acceptanceCriteria: [],
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/At least one acceptance criterion is required/);
    });

    it('should reject empty verify commands array', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: [],
          expected: ['pass'],
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject empty verify expected array', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['test'],
          expected: [],
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });
  });

  describe('Strict Mode (Unknown Fields)', () => {
    it('should reject unknown top-level field', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        unknownField: 'value',
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/Unrecognized key/);
    });

    it('should reject unknown field in kpi', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        kpi: {
          dcu: 1,
          unknownField: 'value',
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/Unrecognized key/);
    });

    it('should reject unknown field in verify', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['test'],
          expected: ['pass'],
          unknownField: 'value',
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/Unrecognized key/);
    });

    it('should reject unknown field in guards', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        guards: {
          env: 'development',
          prodBlocked: true,
          unknownField: 'value',
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/Unrecognized key/);
    });
  });

  describe('Bounds Validation (DoS-safe)', () => {
    it('should reject title exceeding 200 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: 'a'.repeat(201),
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/must not exceed 200 characters/);
    });

    it('should accept title at 200 characters', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: 'a'.repeat(200),
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result.title.length).toBe(200);
    });

    it('should reject body less than 10 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        body: 'short',
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/must be at least 10 characters/);
    });

    it('should reject body exceeding 10000 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        body: 'a'.repeat(10001),
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow(/must not exceed 10000 characters/);
    });

    it('should reject labels array exceeding 50 items', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: Array(51).fill('label'),
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should accept labels array at 50 items', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: Array(50).fill('').map((_, i) => `label${i}`),
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result.labels.length).toBe(50);
    });

    it('should reject dependsOn array exceeding 20 items', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        dependsOn: Array(21).fill('I811'),
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject acceptanceCriteria array exceeding 20 items', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        acceptanceCriteria: Array(21).fill('AC'),
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject verify commands exceeding 10 items', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: Array(11).fill('test'),
          expected: ['pass'],
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject verify expected exceeding 10 items', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['test'],
          expected: Array(11).fill('pass'),
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject individual label exceeding 100 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['a'.repeat(101)],
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject individual AC exceeding 1000 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        acceptanceCriteria: ['a'.repeat(1001)],
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject verify command exceeding 500 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['a'.repeat(501)],
          expected: ['pass'],
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject KPI intent exceeding 200 characters', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        kpi: {
          intent: 'a'.repeat(201),
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });
  });

  describe('Canonical ID Format Validation', () => {
    describe('Valid formats', () => {
      it('should accept I8xx format (I811)', () => {
        const result = CanonicalIdSchema.parse('I811');
        expect(result).toBe('I811');
      });

      it('should accept I8xx format (I899)', () => {
        const result = CanonicalIdSchema.parse('I899');
        expect(result).toBe('I899');
      });

      it('should accept E81.x format (E81.1)', () => {
        const result = CanonicalIdSchema.parse('E81.1');
        expect(result).toBe('E81.1');
      });

      it('should accept E81.x format (E81.99)', () => {
        const result = CanonicalIdSchema.parse('E81.99');
        expect(result).toBe('E81.99');
      });

      it('should accept CID:I8xx format', () => {
        const result = CanonicalIdSchema.parse('CID:I811');
        expect(result).toBe('CID:I811');
      });

      it('should accept CID:E81.x format', () => {
        const result = CanonicalIdSchema.parse('CID:E81.1');
        expect(result).toBe('CID:E81.1');
      });
    });

    describe('Invalid formats', () => {
      it('should reject empty canonical ID', () => {
        expect(() => CanonicalIdSchema.parse('')).toThrow(/Canonical ID is required/);
      });

      it('should reject I7xx format (wrong epic)', () => {
        expect(() => CanonicalIdSchema.parse('I711')).toThrow(/must match format/);
      });

      it('should reject I9xx format (wrong epic)', () => {
        expect(() => CanonicalIdSchema.parse('I911')).toThrow(/must match format/);
      });

      it('should reject E71.x format (wrong epic)', () => {
        expect(() => CanonicalIdSchema.parse('E71.1')).toThrow(/must match format/);
      });

      it('should reject E82.x format (wrong epic)', () => {
        expect(() => CanonicalIdSchema.parse('E82.1')).toThrow(/must match format/);
      });

      it('should reject plain text', () => {
        expect(() => CanonicalIdSchema.parse('some-issue')).toThrow(/must match format/);
      });

      it('should reject UUID format', () => {
        expect(() => CanonicalIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toThrow(/must match format/);
      });

      it('should reject invalid CID prefix', () => {
        expect(() => CanonicalIdSchema.parse('CID:I711')).toThrow(/must match format/);
      });

      it('should reject canonical ID exceeding 50 characters', () => {
        expect(() => CanonicalIdSchema.parse('CID:' + 'I811'.repeat(20))).toThrow(/must not exceed 50 characters/);
      });
    });
  });

  describe('Label Deduplication and Sorting', () => {
    it('should deduplicate identical labels', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['test', 'duplicate', 'test', 'duplicate'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.labels).toEqual(['duplicate', 'test']);
    });

    it('should sort labels lexicographically', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['zebra', 'alpha', 'beta', 'delta'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.labels).toEqual(['alpha', 'beta', 'delta', 'zebra']);
    });

    it('should handle mixed case labels (case-sensitive)', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['Test', 'test', 'TEST'],
      };

      const normalized = normalizeIssueDraft(draft);
      // Should keep all three as they differ by case
      // Note: localeCompare sorts uppercase before lowercase for same letters
      expect(normalized.labels.length).toBe(3);
      expect(normalized.labels).toContain('TEST');
      expect(normalized.labels).toContain('Test');
      expect(normalized.labels).toContain('test');
    });

    it('should trim whitespace from labels', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['  test  ', ' label ', 'tag'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.labels).toEqual(['label', 'tag', 'test']);
    });

    it('should remove empty labels after trimming', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['test', '   ', '', 'label'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.labels).toEqual(['label', 'test']);
    });

    it('should produce stable sort (deterministic)', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['c', 'a', 'b', 'd'],
      };

      // Run normalization multiple times
      const result1 = normalizeIssueDraft(draft);
      const result2 = normalizeIssueDraft(draft);
      const result3 = normalizeIssueDraft(draft);

      expect(result1.labels).toEqual(result2.labels);
      expect(result2.labels).toEqual(result3.labels);
      expect(result1.labels).toEqual(['a', 'b', 'c', 'd']);
    });
  });

  describe('DependsOn Deduplication and Sorting', () => {
    it('should deduplicate identical dependsOn entries', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        dependsOn: ['I811', 'E81.1', 'I811', 'E81.1'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.dependsOn).toEqual(['E81.1', 'I811']);
    });

    it('should sort dependsOn lexicographically', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        dependsOn: ['I819', 'E81.2', 'I811', 'E81.1'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.dependsOn).toEqual(['E81.1', 'E81.2', 'I811', 'I819']);
    });

    it('should trim whitespace from dependsOn', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        dependsOn: ['  I811  ', ' E81.1 '],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.dependsOn).toEqual(['E81.1', 'I811']);
    });
  });

  describe('Normalization', () => {
    it('should trim all string fields', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: '  Title  ',
        body: '  Body content  ',
        canonicalId: '  I811  ',
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.title).toBe('Title');
      expect(normalized.body).toBe('Body content');
      expect(normalized.canonicalId).toBe('I811');
    });

    it('should trim acceptanceCriteria items', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        acceptanceCriteria: ['  AC1  ', '  AC2  '],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.acceptanceCriteria).toEqual(['AC1', 'AC2']);
    });

    it('should trim verify commands and expected', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['  npm test  ', '  npm build  '],
          expected: ['  pass  ', '  success  '],
        },
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.verify.commands).toEqual(['npm test', 'npm build']);
      expect(normalized.verify.expected).toEqual(['pass', 'success']);
    });

    it('should trim KPI intent if present', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        kpi: {
          dcu: 1,
          intent: '  Improve quality  ',
        },
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.kpi?.intent).toBe('Improve quality');
    });

    it('should preserve acceptanceCriteria order (user intent)', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        acceptanceCriteria: ['Third', 'First', 'Second'],
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.acceptanceCriteria).toEqual(['Third', 'First', 'Second']);
    });

    it('should preserve verify commands order (execution order)', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        verify: {
          commands: ['npm build', 'npm test', 'npm lint'],
          expected: ['pass', 'pass', 'pass'],
        },
      };

      const normalized = normalizeIssueDraft(draft);
      expect(normalized.verify.commands).toEqual(['npm build', 'npm test', 'npm lint']);
    });
  });

  describe('Validation Function', () => {
    it('should validate and normalize valid draft', () => {
      const draft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: ['z-label', 'a-label', 'z-label'], // duplicates + unsorted
      };

      const result = validateIssueDraft(draft);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.labels).toEqual(['a-label', 'z-label']); // deduped + sorted
      }
    });

    it('should return errors for invalid draft', () => {
      const draft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: '', // invalid: too short
      };

      const result = validateIssueDraft(draft);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].path).toBe('title');
      }
    });

    it('should sort errors by path lexicographically', () => {
      const draft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: '', // invalid
        body: 'short', // invalid
        canonicalId: 'invalid', // invalid
      };

      const result = validateIssueDraft(draft);

      expect(result.success).toBe(false);
      if (!result.success) {
        // Errors should be sorted by path
        const paths = result.errors.map(e => e.path);
        const sortedPaths = [...paths].sort();
        expect(paths).toEqual(sortedPaths);
      }
    });

    it('should bound error count to 100 (DoS-safe)', () => {
      // Create draft with many errors
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        labels: Array(60).fill(''), // 60 empty labels (invalid)
      };

      const result = validateIssueDraft(draft);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeLessThanOrEqual(100);
      }
    });

    it('should not include stack traces in errors', () => {
      const draft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        title: '',
      };

      const result = validateIssueDraft(draft);

      expect(result.success).toBe(false);
      if (!result.success) {
        for (const error of result.errors) {
          expect(error).toHaveProperty('path');
          expect(error).toHaveProperty('message');
          expect(error).not.toHaveProperty('stack');
        }
      }
    });

    it('should handle completely invalid input', () => {
      const result = validateIssueDraft(null);

      expect(result.success).toBe(false);
    });

    it('should handle non-object input', () => {
      const result = validateIssueDraft('not an object');

      expect(result.success).toBe(false);
    });

    it('should handle array input', () => {
      const result = validateIssueDraft([]);

      expect(result.success).toBe(false);
    });
  });

  describe('Type Validation', () => {
    it('should reject invalid issue type', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        type: 'story', // invalid type
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject invalid priority', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        priority: 'P3', // invalid priority
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject invalid environment', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        guards: {
          env: 'production', // invalid env
          prodBlocked: true,
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject invalid KPI DCU value', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        kpi: {
          dcu: 3, // invalid DCU
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject guards without prodBlocked', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        guards: {
          env: 'development',
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject guards with prodBlocked=false', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        guards: {
          env: 'development',
          prodBlocked: false,
        },
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });
  });

  describe('Version Validation', () => {
    it('should accept version 1.0', () => {
      const draft: IssueDraft = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issueDraftVersion: '1.0',
      };

      const result = IssueDraftSchema.parse(draft);
      expect(result.issueDraftVersion).toBe('1.0');
    });

    it('should reject invalid version', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issueDraftVersion: '2.0',
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });

    it('should reject version as number', () => {
      const draft: any = {
        ...EXAMPLE_MINIMAL_ISSUE_DRAFT,
        issueDraftVersion: 1.0,
      };

      expect(() => IssueDraftSchema.parse(draft)).toThrow();
    });
  });
});
