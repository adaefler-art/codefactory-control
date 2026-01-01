/**
 * Tests for CR Diff Utility
 * Issue E74.4: CR Versioning + Diff
 */

import { computeCrDiff } from '@/lib/utils/crDiff';
import { EXAMPLE_MINIMAL_CR } from '@/lib/schemas/changeRequest';

describe('CR Diff Utility', () => {
  const baseVersion = {
    id: 'v1',
    cr_json: EXAMPLE_MINIMAL_CR,
    cr_hash: 'hash1',
    cr_version: 1,
  };

  describe('computeCrDiff', () => {
    it('should return empty operations for identical CRs', () => {
      const toVersion = {
        id: 'v2',
        cr_json: EXAMPLE_MINIMAL_CR,
        cr_hash: 'hash1', // Same hash
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      expect(diff.from.id).toBe('v1');
      expect(diff.to.id).toBe('v2');
      expect(diff.operations).toEqual([]);
    });

    it('should detect title change', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'Updated Title',
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      expect(diff.operations.length).toBeGreaterThan(0);
      const titleOp = diff.operations.find(op => op.path === '/title');
      expect(titleOp).toBeDefined();
      expect(titleOp?.op).toBe('replace');
    });

    it('should detect added field', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        newField: 'new value',
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      const addOp = diff.operations.find(op => op.path === '/newField');
      expect(addOp).toBeDefined();
      expect(addOp?.op).toBe('add');
      if (addOp?.op === 'add') {
        expect(addOp.value).toBe('new value');
      }
    });

    it('should detect removed field', () => {
      const modifiedCr = { ...EXAMPLE_MINIMAL_CR };
      delete (modifiedCr as any).motivation;

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      const removeOp = diff.operations.find(op => op.path === '/motivation');
      expect(removeOp).toBeDefined();
      expect(removeOp?.op).toBe('remove');
    });

    it('should detect array element changes', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        evidence: [
          ...EXAMPLE_MINIMAL_CR.evidence,
          {
            type: 'user_validation',
            details: 'New evidence item',
          },
        ],
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      // Should detect addition to evidence array
      const evidenceOps = diff.operations.filter(op => op.path.startsWith('/evidence/'));
      expect(evidenceOps.length).toBeGreaterThan(0);
    });

    it('should be deterministic (same input produces same output)', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'Modified Title',
        description: 'Modified Description',
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff1 = computeCrDiff(baseVersion, toVersion);
      const diff2 = computeCrDiff(baseVersion, toVersion);

      expect(JSON.stringify(diff1)).toBe(JSON.stringify(diff2));
    });

    it('should handle nested object changes', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        evidence: [
          {
            ...EXAMPLE_MINIMAL_CR.evidence[0],
            details: 'Modified details',
          },
        ],
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      const detailsOp = diff.operations.find(op => op.path.includes('/details'));
      expect(detailsOp).toBeDefined();
    });

    it('should use JSON pointer format for paths', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        'field/with/slashes': 'value',
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(baseVersion, toVersion);

      // Paths should escape special characters
      const op = diff.operations.find(op => op.path.includes('~1'));
      expect(op).toBeDefined();
    });

    it('should sort object keys for determinism', () => {
      const cr1 = {
        z: 'value',
        a: 'value',
        m: 'value',
      };

      const cr2 = {
        a: 'modified',
        m: 'value',
        z: 'value',
      };

      const v1 = {
        id: 'v1',
        cr_json: cr1,
        cr_hash: 'hash1',
        cr_version: 1,
      };

      const v2 = {
        id: 'v2',
        cr_json: cr2,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(v1, v2);

      // Operations should be in sorted order
      expect(diff.operations.length).toBe(1);
      expect(diff.operations[0].path).toBe('/a');
    });
  });

  describe('Edge cases', () => {
    it('should handle null values', () => {
      const cr1 = { field: null };
      const cr2 = { field: 'value' };

      const v1 = {
        id: 'v1',
        cr_json: cr1,
        cr_hash: 'hash1',
        cr_version: 1,
      };

      const v2 = {
        id: 'v2',
        cr_json: cr2,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(v1, v2);

      expect(diff.operations.length).toBe(1);
      expect(diff.operations[0].op).toBe('replace');
    });

    it('should handle empty arrays', () => {
      const cr1 = { items: [] };
      const cr2 = { items: ['item1'] };

      const v1 = {
        id: 'v1',
        cr_json: cr1,
        cr_hash: 'hash1',
        cr_version: 1,
      };

      const v2 = {
        id: 'v2',
        cr_json: cr2,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(v1, v2);

      expect(diff.operations.length).toBe(1);
      expect(diff.operations[0].op).toBe('add');
      expect(diff.operations[0].path).toBe('/items/0');
    });

    it('should handle empty objects', () => {
      const cr1 = { nested: {} };
      const cr2 = { nested: { field: 'value' } };

      const v1 = {
        id: 'v1',
        cr_json: cr1,
        cr_hash: 'hash1',
        cr_version: 1,
      };

      const v2 = {
        id: 'v2',
        cr_json: cr2,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      const diff = computeCrDiff(v1, v2);

      expect(diff.operations.length).toBe(1);
      expect(diff.operations[0].op).toBe('add');
      expect(diff.operations[0].path).toBe('/nested/field');
    });
  });

  describe('Determinism - Repeated runs', () => {
    it('should produce identical diff arrays for 5 repeated runs', () => {
      const modifiedCr = {
        ...EXAMPLE_MINIMAL_CR,
        title: 'Modified Title',
        motivation: 'Updated motivation',
        evidence: [
          ...EXAMPLE_MINIMAL_CR.evidence,
          {
            kind: 'user_validation',
            details: 'Additional evidence',
          },
        ],
      };

      const toVersion = {
        id: 'v2',
        cr_json: modifiedCr,
        cr_hash: 'hash2',
        cr_version: 2,
      };

      // Run diff 5 times
      const results = [];
      for (let i = 0; i < 5; i++) {
        const diff = computeCrDiff(baseVersion, toVersion);
        results.push(JSON.stringify(diff));
      }

      // All results should be identical
      const firstResult = results[0];
      for (let i = 1; i < 5; i++) {
        expect(results[i]).toBe(firstResult);
      }
    });
  });
});
