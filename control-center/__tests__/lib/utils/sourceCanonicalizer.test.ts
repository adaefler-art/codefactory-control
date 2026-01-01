/**
 * Tests for Source Canonicalizer
 * 
 * Validates deterministic ordering, deduplication, and hashing.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * @jest-environment node
 */

import {
  canonicalizeUsedSources,
  hashUsedSources,
  prepareUsedSourcesForStorage,
} from '../../../src/lib/utils/sourceCanonicalizer';
import type { UsedSources } from '../../../src/lib/schemas/usedSources';

describe('Source Canonicalizer', () => {
  describe('canonicalizeUsedSources', () => {
    test('returns empty array for null/undefined/empty input', () => {
      expect(canonicalizeUsedSources([])).toEqual([]);
      expect(canonicalizeUsedSources(null as any)).toEqual([]);
      expect(canonicalizeUsedSources(undefined as any)).toEqual([]);
    });

    test('sorts sources by kind alphabetically', () => {
      const sources: UsedSources = [
        {
          kind: 'github_pr',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
        {
          kind: 'afu9_artifact',
          artifactType: 'verdict',
          artifactId: 'v1',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'test', repo: 'repo' },
          branch: 'main',
          path: 'file.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'abc',
        },
      ];

      const canonical = canonicalizeUsedSources(sources);
      
      expect(canonical[0].kind).toBe('afu9_artifact');
      expect(canonical[1].kind).toBe('file_snippet');
      expect(canonical[2].kind).toBe('github_pr');
    });

    test('sorts file_snippet sources by repo, path, and line numbers', () => {
      const sources: UsedSources = [
        {
          kind: 'file_snippet',
          repo: { owner: 'test', repo: 'repo' },
          branch: 'main',
          path: 'z.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'abc',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'test', repo: 'repo' },
          branch: 'main',
          path: 'a.ts',
          startLine: 1,
          endLine: 10,
          snippetHash: 'def',
        },
        {
          kind: 'file_snippet',
          repo: { owner: 'test', repo: 'repo' },
          branch: 'main',
          path: 'a.ts',
          startLine: 20,
          endLine: 30,
          snippetHash: 'ghi',
        },
      ];

      const canonical = canonicalizeUsedSources(sources);
      
      expect(canonical[0].path).toBe('a.ts');
      expect((canonical[0] as any).startLine).toBe(1);
      expect(canonical[1].path).toBe('a.ts');
      expect((canonical[1] as any).startLine).toBe(20);
      expect(canonical[2].path).toBe('z.ts');
    });

    test('removes exact duplicates', () => {
      const sources: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 123,
          title: 'Test Issue',
        },
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 123,
          title: 'Test Issue',
        },
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 456,
        },
      ];

      const canonical = canonicalizeUsedSources(sources);
      
      expect(canonical).toHaveLength(2);
      expect(canonical[0].number).toBe(123);
      expect(canonical[1].number).toBe(456);
    });
  });

  describe('hashUsedSources', () => {
    test('produces same hash for same sources in different order', () => {
      const sources1: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
        {
          kind: 'github_pr',
          repo: { owner: 'test', repo: 'repo' },
          number: 2,
        },
      ];

      const sources2: UsedSources = [
        {
          kind: 'github_pr',
          repo: { owner: 'test', repo: 'repo' },
          number: 2,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
      ];

      const hash1 = hashUsedSources(sources1);
      const hash2 = hashUsedSources(sources2);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex format
    });

    test('produces different hashes for different sources', () => {
      const sources1: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
      ];

      const sources2: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 2,
        },
      ];

      const hash1 = hashUsedSources(sources1);
      const hash2 = hashUsedSources(sources2);

      expect(hash1).not.toBe(hash2);
    });

    test('handles duplicates before hashing', () => {
      const sources1: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
      ];

      const sources2: UsedSources = [
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
      ];

      const hash1 = hashUsedSources(sources1);
      const hash2 = hashUsedSources(sources2);

      expect(hash1).toBe(hash2);
    });
  });

  describe('prepareUsedSourcesForStorage', () => {
    test('returns null for empty/null/undefined input', () => {
      expect(prepareUsedSourcesForStorage(null)).toEqual({ canonical: null, hash: null });
      expect(prepareUsedSourcesForStorage(undefined)).toEqual({ canonical: null, hash: null });
      expect(prepareUsedSourcesForStorage([])).toEqual({ canonical: null, hash: null });
    });

    test('returns canonical sources and hash for valid input', () => {
      const sources: UsedSources = [
        {
          kind: 'github_pr',
          repo: { owner: 'test', repo: 'repo' },
          number: 2,
        },
        {
          kind: 'github_issue',
          repo: { owner: 'test', repo: 'repo' },
          number: 1,
        },
      ];

      const result = prepareUsedSourcesForStorage(sources);

      expect(result.canonical).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.canonical).toHaveLength(2);
      expect(result.canonical![0].kind).toBe('github_issue'); // Sorted
      expect(result.canonical![1].kind).toBe('github_pr');
      expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('canonical form is deterministic', () => {
      const sources: UsedSources = [
        {
          kind: 'file_snippet',
          repo: { owner: 'org', repo: 'repo' },
          branch: 'main',
          path: 'file.ts',
          startLine: 10,
          endLine: 20,
          snippetHash: 'abc123',
        },
        {
          kind: 'github_issue',
          repo: { owner: 'org', repo: 'repo' },
          number: 5,
          title: 'Issue Title',
        },
      ];

      const result1 = prepareUsedSourcesForStorage(sources);
      const result2 = prepareUsedSourcesForStorage([...sources].reverse());

      expect(result1.hash).toBe(result2.hash);
      expect(JSON.stringify(result1.canonical)).toBe(JSON.stringify(result2.canonical));
    });
  });
});
