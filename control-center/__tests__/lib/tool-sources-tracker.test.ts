/**
 * Tests for Tool Sources Tracker
 * 
 * Validates conversion of tool invocations to SourceRef objects.
 * Issue E89.5: INTENT "Sources" Integration
 * 
 * @jest-environment node
 */

import {
  toolInvocationToSourceRefs,
  aggregateToolSources,
  ToolSourcesTracker,
} from '../../src/lib/intent/tool-sources-tracker';
import type { SourceRef } from '../../src/lib/schemas/usedSources';

describe('Tool Sources Tracker', () => {
  describe('toolInvocationToSourceRefs', () => {
    test('converts readFile result to file_snippet SourceRef', () => {
      const invocation = {
        toolName: 'readFile',
        args: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          ref: 'main',
          path: 'src/lib/utils.ts',
          startLine: 10,
          endLine: 50,
        },
        result: {
          success: true,
          content: 'function foo() { ... }',
          meta: {
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            ref: 'main',
            path: 'src/lib/utils.ts',
            startLine: 10,
            endLine: 50,
            totalLines: 100,
            sha256: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
            snippetHash: 'abc123def456',
            encoding: 'utf-8',
            truncated: false,
            blobSha: 'blob123',
            generatedAt: '2025-01-15T20:00:00Z',
          },
        },
      };

      const sources = toolInvocationToSourceRefs(invocation);

      expect(sources).toHaveLength(1);
      expect(sources[0]).toEqual({
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'src/lib/utils.ts',
        startLine: 10,
        endLine: 50,
        snippetHash: 'abc123def456',
        contentSha256: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
      });
    });

    test('converts readFile without line range to full file reference', () => {
      const invocation = {
        toolName: 'readFile',
        args: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          path: 'README.md',
        },
        result: {
          success: true,
          content: '# README',
          meta: {
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            ref: 'main',
            path: 'README.md',
            startLine: null,
            endLine: null,
            totalLines: 200,
            sha256: 'xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyz789xyza',
            snippetHash: 'xyz789xyz789',
            encoding: 'utf-8',
            truncated: false,
            blobSha: 'blob456',
            generatedAt: '2025-01-15T20:00:00Z',
          },
        },
      };

      const sources = toolInvocationToSourceRefs(invocation);

      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'README.md',
        startLine: 1,
        endLine: 200,
      });
    });

    test('converts searchCode results to multiple file_snippet SourceRefs', () => {
      const invocation = {
        toolName: 'searchCode',
        args: {
          owner: 'adaefler-art',
          repo: 'codefactory-control',
          ref: 'main',
          query: 'function execute',
        },
        result: {
          success: true,
          results: [
            { path: 'src/lib/executor.ts', sha: 'sha111' },
            { path: 'src/lib/runner.ts', sha: 'sha222' },
          ],
          meta: {
            resultCount: 2,
            sha256: 'searchhash123',
          },
        },
      };

      const sources = toolInvocationToSourceRefs(invocation);

      expect(sources).toHaveLength(2);
      expect(sources[0]).toEqual({
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'src/lib/executor.ts',
        startLine: 1,
        endLine: 1,
        snippetHash: 'sha111',
      });
      expect(sources[1]).toEqual({
        kind: 'file_snippet',
        repo: { owner: 'adaefler-art', repo: 'codefactory-control' },
        branch: 'main',
        path: 'src/lib/runner.ts',
        startLine: 1,
        endLine: 1,
        snippetHash: 'sha222',
      });
    });

    test('returns empty array for failed tool calls', () => {
      const invocation = {
        toolName: 'readFile',
        args: { owner: 'test', repo: 'test', path: 'test.ts' },
        result: {
          success: false,
          error: 'File not found',
        },
      };

      const sources = toolInvocationToSourceRefs(invocation);
      expect(sources).toEqual([]);
    });

    test('returns empty array for non-evidence tools', () => {
      const invocation = {
        toolName: 'get_context_pack',
        args: {},
        result: {
          success: true,
          pack: { id: 'pack-123' },
        },
      };

      const sources = toolInvocationToSourceRefs(invocation);
      expect(sources).toEqual([]);
    });
  });

  describe('aggregateToolSources', () => {
    test('aggregates sources from multiple tool invocations', () => {
      const invocations = [
        {
          toolName: 'readFile',
          args: { owner: 'org', repo: 'repo', path: 'file1.ts' },
          result: {
            success: true,
            meta: {
              owner: 'org',
              repo: 'repo',
              ref: 'main',
              path: 'file1.ts',
              startLine: 1,
              endLine: 10,
              sha256: 'hash1',
              snippetHash: 'hash1short',
              encoding: 'utf-8',
              truncated: false,
              blobSha: null,
              generatedAt: '2025-01-15T20:00:00Z',
            },
          },
        },
        {
          toolName: 'readFile',
          args: { owner: 'org', repo: 'repo', path: 'file2.ts' },
          result: {
            success: true,
            meta: {
              owner: 'org',
              repo: 'repo',
              ref: 'main',
              path: 'file2.ts',
              startLine: 5,
              endLine: 15,
              sha256: 'hash2',
              snippetHash: 'hash2short',
              encoding: 'utf-8',
              truncated: false,
              blobSha: null,
              generatedAt: '2025-01-15T20:00:00Z',
            },
          },
        },
      ];

      const sources = aggregateToolSources(invocations);
      expect(sources).toHaveLength(2);
    });

    test('deduplicates identical sources', () => {
      const invocations = [
        {
          toolName: 'readFile',
          args: { owner: 'org', repo: 'repo', path: 'file.ts' },
          result: {
            success: true,
            meta: {
              owner: 'org',
              repo: 'repo',
              ref: 'main',
              path: 'file.ts',
              startLine: 1,
              endLine: 10,
              sha256: 'hash1',
              snippetHash: 'hash1short',
              encoding: 'utf-8',
              truncated: false,
              blobSha: null,
              generatedAt: '2025-01-15T20:00:00Z',
            },
          },
        },
        {
          toolName: 'readFile',
          args: { owner: 'org', repo: 'repo', path: 'file.ts' },
          result: {
            success: true,
            meta: {
              owner: 'org',
              repo: 'repo',
              ref: 'main',
              path: 'file.ts',
              startLine: 1,
              endLine: 10,
              sha256: 'hash1',
              snippetHash: 'hash1short',
              encoding: 'utf-8',
              truncated: false,
              blobSha: null,
              generatedAt: '2025-01-15T20:00:00Z',
            },
          },
        },
      ];

      const sources = aggregateToolSources(invocations);
      expect(sources).toHaveLength(1);
    });

    test('handles empty invocations array', () => {
      const sources = aggregateToolSources([]);
      expect(sources).toEqual([]);
    });
  });

  describe('ToolSourcesTracker', () => {
    test('tracks tool invocations and returns aggregated sources', () => {
      const tracker = new ToolSourcesTracker();

      tracker.recordInvocation('readFile', { owner: 'org', repo: 'repo', path: 'file1.ts' }, {
        success: true,
        meta: {
          owner: 'org',
          repo: 'repo',
          ref: 'main',
          path: 'file1.ts',
          startLine: 1,
          endLine: 10,
          sha256: 'hash1',
          snippetHash: 'hash1short',
          encoding: 'utf-8',
          truncated: false,
          blobSha: null,
          generatedAt: '2025-01-15T20:00:00Z',
        },
      });

      tracker.recordInvocation('readFile', { owner: 'org', repo: 'repo', path: 'file2.ts' }, {
        success: true,
        meta: {
          owner: 'org',
          repo: 'repo',
          ref: 'main',
          path: 'file2.ts',
          startLine: 1,
          endLine: 20,
          sha256: 'hash2',
          snippetHash: 'hash2short',
          encoding: 'utf-8',
          truncated: false,
          blobSha: null,
          generatedAt: '2025-01-15T20:00:00Z',
        },
      });

      const sources = tracker.getAggregatedSources();
      expect(sources).toHaveLength(2);
    });

    test('resets tracker clears invocations', () => {
      const tracker = new ToolSourcesTracker();

      tracker.recordInvocation('readFile', { owner: 'org', repo: 'repo', path: 'file.ts' }, {
        success: true,
        meta: {
          owner: 'org',
          repo: 'repo',
          ref: 'main',
          path: 'file.ts',
          startLine: 1,
          endLine: 10,
          sha256: 'hash1',
          snippetHash: 'hash1short',
          encoding: 'utf-8',
          truncated: false,
          blobSha: null,
          generatedAt: '2025-01-15T20:00:00Z',
        },
      });

      expect(tracker.getAggregatedSources()).toHaveLength(1);

      tracker.reset();

      expect(tracker.getAggregatedSources()).toEqual([]);
    });

    test('getInvocations returns copy of invocations', () => {
      const tracker = new ToolSourcesTracker();

      tracker.recordInvocation('readFile', { owner: 'org', repo: 'repo' }, { success: true });

      const invocations = tracker.getInvocations();
      expect(invocations).toHaveLength(1);

      // Modify returned array should not affect tracker
      invocations.push({
        toolName: 'fake',
        args: {},
        result: {},
      });

      expect(tracker.getInvocations()).toHaveLength(1);
    });
  });
});
