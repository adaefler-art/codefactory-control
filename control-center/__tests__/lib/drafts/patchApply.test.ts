/**
 * Unit tests for Issue Draft Patch Application (E86.5)
 * 
 * Tests:
 * - Whitelist validation (reject unknown fields)
 * - Deterministic array operations (append, remove, replaceAll)
 * - Idempotent patch application (same patch + draft = same hash)
 * - Stable sorting for labels and dependsOn
 * - Error codes for validation failures
 * 
 * @jest-environment node
 */

import { applyPatchToDraft, validatePatch } from '../../../src/lib/drafts/patchApply';
import type { IssueDraft } from '../../../src/lib/schemas/issueDraft';

describe('Issue Draft Patch Application', () => {
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

  describe('validatePatch', () => {
    test('accepts valid patch with allowed fields', () => {
      const patch = {
        title: 'New title',
        labels: ['new-label'],
      };
      const result = validatePatch(patch);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    test('rejects patch with unknown fields', () => {
      const patch = {
        title: 'New title',
        unknownField: 'value',
      };
      const result = validatePatch(patch);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].code).toBe('PATCH_FIELD_NOT_ALLOWED');
      expect(result.errors![0].field).toBe('unknownField');
    });

    test('rejects multiple unknown fields', () => {
      const patch = {
        title: 'New title',
        field1: 'value1',
        field2: 'value2',
      };
      const result = validatePatch(patch);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('applyPatchToDraft - basic fields', () => {
    test('updates title', () => {
      const patch = { title: 'Updated Title' };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.title).toBe('Updated Title');
      expect(result.diffSummary?.changedFields).toContain('title');
    });

    test('updates body', () => {
      const patch = { body: 'Updated body content for testing' };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.body).toBe('Updated body content for testing');
    });

    test('updates priority', () => {
      const patch = { priority: 'P0' };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.priority).toBe('P0');
    });
  });

  describe('applyPatchToDraft - array operations', () => {
    test('appends to labels', () => {
      const patch = {
        labels: { op: 'append', values: ['new-label', 'another-label'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.labels).toContain('new-label');
      expect(result.draft?.labels).toContain('another-label');
      expect(result.diffSummary?.addedItems).toBeGreaterThan(0);
    });

    test('removes from labels', () => {
      const patch = {
        labels: { op: 'remove', values: ['v0.8'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.labels).not.toContain('v0.8');
      expect(result.draft?.labels).toContain('epic:E86');
      expect(result.diffSummary?.removedItems).toBeGreaterThan(0);
    });

    test('replaces all labels', () => {
      const patch = {
        labels: { op: 'replaceAll', values: ['new-label-1', 'new-label-2'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.labels).toEqual(['new-label-1', 'new-label-2']);
    });

    test('appends to acceptanceCriteria', () => {
      const patch = {
        acceptanceCriteria: { op: 'append', values: ['Criterion 3'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.acceptanceCriteria).toHaveLength(3);
      expect(result.draft?.acceptanceCriteria).toContain('Criterion 3');
    });

    test('direct array replacement for labels', () => {
      const patch = {
        labels: ['label-a', 'label-b'],
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.labels).toContain('label-a');
      expect(result.draft?.labels).toContain('label-b');
    });
  });

  describe('applyPatchToDraft - determinism', () => {
    test('same patch produces same hash (idempotent)', () => {
      const patch = {
        title: 'Consistent Title',
        labels: { op: 'append', values: ['test-label'] },
      };

      const result1 = applyPatchToDraft(baseDraft, patch);
      const result2 = applyPatchToDraft(baseDraft, patch);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.afterHash).toBe(result2.afterHash);
      expect(result1.patchHash).toBe(result2.patchHash);
    });

    test('labels are sorted lexicographically after patch', () => {
      const patch = {
        labels: ['z-label', 'a-label', 'b-label'],
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.labels).toEqual(['a-label', 'b-label', 'z-label']);
    });

    test('labels are deduplicated after append', () => {
      const patch = {
        labels: { op: 'append', values: ['v0.8', 'new-label'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      // v0.8 already exists, should be deduped by normalization
      const labelCount = result.draft?.labels.filter(l => l === 'v0.8').length;
      expect(labelCount).toBe(1);
    });
  });

  describe('applyPatchToDraft - complex fields', () => {
    test('updates kpi', () => {
      const patch = {
        kpi: { dcu: 2, intent: 'Improve performance' },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.kpi?.dcu).toBe(2);
      expect(result.draft?.kpi?.intent).toBe('Improve performance');
    });

    test('updates guards', () => {
      const patch = {
        guards: { env: 'staging', prodBlocked: true },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.guards.env).toBe('staging');
    });

    test('updates verify', () => {
      const patch = {
        verify: {
          commands: ['npm run build', 'npm test'],
          expected: ['Build succeeds', 'Tests pass'],
        },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.draft?.verify.commands).toHaveLength(2);
      expect(result.draft?.verify.expected).toHaveLength(2);
    });
  });

  describe('applyPatchToDraft - error handling', () => {
    test('fails on unknown field in patch', () => {
      const patch = {
        unknownField: 'value',
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(false);
      expect(result.code).toBe('PATCH_VALIDATION_FAILED');
    });

    test('fails on invalid array operation index', () => {
      const patch = {
        labels: { op: 'replaceByIndex', index: 999, value: 'new-label' },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(false);
      expect(result.code).toBe('PATCH_APPLICATION_FAILED');
    });
  });

  describe('applyPatchToDraft - hash tracking', () => {
    test('returns beforeHash, afterHash, patchHash', () => {
      const patch = { title: 'New Title' };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.beforeHash).toBeDefined();
      expect(result.afterHash).toBeDefined();
      expect(result.patchHash).toBeDefined();
      expect(result.beforeHash).not.toBe(result.afterHash);
    });

    test('beforeHash matches for same input draft', () => {
      const patch1 = { title: 'Title 1' };
      const patch2 = { title: 'Title 2' };

      const result1 = applyPatchToDraft(baseDraft, patch1);
      const result2 = applyPatchToDraft(baseDraft, patch2);

      expect(result1.beforeHash).toBe(result2.beforeHash);
    });
  });

  describe('applyPatchToDraft - diffSummary', () => {
    test('tracks changed fields', () => {
      const patch = {
        title: 'New Title',
        priority: 'P0',
        labels: ['new-label'],
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.diffSummary?.changedFields).toContain('title');
      expect(result.diffSummary?.changedFields).toContain('priority');
      expect(result.diffSummary?.changedFields).toContain('labels');
    });

    test('tracks added items count', () => {
      const patch = {
        acceptanceCriteria: { op: 'append', values: ['AC 3', 'AC 4'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.diffSummary?.addedItems).toBe(2);
    });

    test('tracks removed items count', () => {
      const patch = {
        labels: { op: 'remove', values: ['v0.8', 'epic:E86'] },
      };
      const result = applyPatchToDraft(baseDraft, patch);

      expect(result.success).toBe(true);
      expect(result.diffSummary?.removedItems).toBe(2);
    });
  });
});
