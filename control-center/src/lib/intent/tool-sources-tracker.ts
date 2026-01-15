/**
 * Tool Sources Tracker
 * 
 * Tracks INTENT tool invocations and converts them to SourceRef objects
 * for the used_sources contract.
 * 
 * Issue: E89.5 - INTENT "Sources" Integration
 * 
 * Responsibilities:
 * - Convert evidence tool responses to SourceRef objects
 * - Aggregate sources from multiple tool calls
 * - Provide clean API for tool executor integration
 */

import type { SourceRef, UsedSources } from '../schemas/usedSources';

/**
 * Tool invocation context for source tracking
 */
export interface ToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
}

/**
 * Helper: Generate snippet hash from SHA-256
 * Uses first 12 characters, falls back to 'unknown'
 */
function getSnippetHashFromSha256(sha256: string | undefined): string {
  return sha256?.substring(0, 12) || 'unknown';
}

/**
 * Helper: Deduplicate sources using JSON.stringify as key
 */
export function deduplicateSources(sources: SourceRef[]): SourceRef[] {
  const uniqueSourcesMap = new Map<string, SourceRef>();
  
  for (const source of sources) {
    const key = JSON.stringify(source);
    if (!uniqueSourcesMap.has(key)) {
      uniqueSourcesMap.set(key, source);
    }
  }

  return Array.from(uniqueSourcesMap.values());
}

/**
 * Convert a readFile tool invocation to a SourceRef
 */
function readFileToSourceRef(args: Record<string, unknown>, result: any): SourceRef | null {
  if (!result?.success || !result?.meta) {
    return null;
  }

  const { owner, repo, ref, path, startLine, endLine, sha256, snippetHash } = result.meta;

  // If no line range, use full file reference
  if (!startLine || !endLine) {
    return {
      kind: 'file_snippet',
      repo: { owner, repo },
      branch: ref || 'main',
      path,
      startLine: 1,
      endLine: result.meta.totalLines || 1,
      snippetHash: snippetHash || getSnippetHashFromSha256(sha256),
      contentSha256: sha256,
    };
  }

  return {
    kind: 'file_snippet',
    repo: { owner, repo },
    branch: ref || 'main',
    path,
    startLine,
    endLine,
    snippetHash: snippetHash || getSnippetHashFromSha256(sha256),
    contentSha256: sha256,
  };
}

/**
 * Convert a searchCode tool invocation to SourceRef objects
 * Returns one SourceRef per search result
 */
function searchCodeToSourceRefs(args: Record<string, unknown>, result: any): SourceRef[] {
  if (!result?.success || !result?.results || !Array.isArray(result.results)) {
    return [];
  }

  const { owner, repo, ref } = args;
  
  return result.results
    .filter((r: any) => r.path && r.sha)
    .map((r: any): SourceRef => ({
      kind: 'file_snippet',
      repo: { owner: owner as string, repo: repo as string },
      branch: (ref as string) || 'main',
      path: r.path,
      startLine: 1, // searchCode doesn't provide line ranges
      endLine: 1,
      snippetHash: getSnippetHashFromSha256(r.sha),
    }));
}

/**
 * Convert a tool invocation to SourceRef objects
 * 
 * @param invocation - Tool invocation with name, args, and result
 * @returns Array of SourceRef objects (empty if tool doesn't produce sources)
 */
export function toolInvocationToSourceRefs(invocation: ToolInvocation): SourceRef[] {
  const { toolName, args, result } = invocation;

  switch (toolName) {
    case 'readFile': {
      const sourceRef = readFileToSourceRef(args, result);
      return sourceRef ? [sourceRef] : [];
    }

    case 'searchCode': {
      return searchCodeToSourceRefs(args, result);
    }

    // Other tools don't produce sources (yet)
    case 'get_context_pack':
    case 'get_change_request':
    case 'save_change_request':
    case 'validate_change_request':
    case 'publish_to_github':
    case 'get_issue_draft':
    case 'save_issue_draft':
    case 'apply_issue_draft_patch':
    case 'validate_issue_draft':
    case 'commit_issue_draft':
    case 'get_issue_set':
    case 'generate_issue_set':
    case 'commit_issue_set':
    case 'export_issue_set_markdown':
    case 'publish_issues_to_github_batch':
    default:
      return [];
  }
}

/**
 * Aggregate sources from multiple tool invocations
 * Removes duplicates and sorts deterministically
 * 
 * @param invocations - Array of tool invocations
 * @returns Aggregated used_sources array
 */
export function aggregateToolSources(invocations: ToolInvocation[]): UsedSources {
  const allSources: SourceRef[] = [];

  for (const invocation of invocations) {
    const sources = toolInvocationToSourceRefs(invocation);
    allSources.push(...sources);
  }

  // Deduplicate using shared helper
  return deduplicateSources(allSources);
}

/**
 * Simple tracker class for accumulating tool invocations
 */
export class ToolSourcesTracker {
  private invocations: ToolInvocation[] = [];

  /**
   * Record a tool invocation
   */
  recordInvocation(toolName: string, args: Record<string, unknown>, result: unknown): void {
    this.invocations.push({ toolName, args, result });
  }

  /**
   * Get aggregated sources from all recorded invocations
   */
  getAggregatedSources(): UsedSources {
    return aggregateToolSources(this.invocations);
  }

  /**
   * Reset the tracker (clear all invocations)
   */
  reset(): void {
    this.invocations = [];
  }

  /**
   * Get raw invocations (for debugging)
   */
  getInvocations(): ToolInvocation[] {
    return [...this.invocations];
  }
}
