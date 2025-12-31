/**
 * Source Canonicalizer: Deterministic Ordering and Hashing
 * 
 * Provides stable canonicalization and SHA256 hashing for used_sources.
 * Issue E73.2: Sources Panel + used_sources Contract
 * 
 * GUARANTEES:
 * - Same sources in different order → same canonical form → same hash
 * - Duplicates removed deterministically
 * - Stable across Node.js versions and deployments
 */

import { createHash } from 'crypto';
import type { SourceRef, UsedSources } from '../schemas/usedSources';

/**
 * Generate a stable sort key for a SourceRef
 * 
 * Sort order:
 * 1. Primary: kind (alphabetical)
 * 2. Secondary: kind-specific stable fields
 */
function getSourceSortKey(source: SourceRef): string {
  const parts: string[] = [source.kind];

  switch (source.kind) {
    case 'file_snippet':
      parts.push(
        source.repo.owner,
        source.repo.repo,
        source.branch,
        source.path,
        String(source.startLine).padStart(10, '0'),
        String(source.endLine).padStart(10, '0'),
        source.snippetHash
      );
      break;

    case 'github_issue':
    case 'github_pr':
      parts.push(
        source.repo.owner,
        source.repo.repo,
        String(source.number).padStart(10, '0')
      );
      break;

    case 'afu9_artifact':
      parts.push(source.artifactType, source.artifactId);
      break;
  }

  return parts.join('|');
}

/**
 * Canonicalize used_sources array
 * 
 * Steps:
 * 1. Deduplicate by stringified content (exact match)
 * 2. Sort by stable sort key
 * 3. Return canonical array
 */
export function canonicalizeUsedSources(sources: UsedSources): UsedSources {
  if (!sources || sources.length === 0) {
    return [];
  }

  // Step 1: Deduplicate by JSON stringification (exact match)
  const seen = new Set<string>();
  const uniqueSources: SourceRef[] = [];

  for (const source of sources) {
    // Use deterministic JSON.stringify for dedup
    const key = JSON.stringify(source, Object.keys(source).sort());
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSources.push(source);
    }
  }

  // Step 2: Sort by stable sort key
  uniqueSources.sort((a, b) => {
    const keyA = getSourceSortKey(a);
    const keyB = getSourceSortKey(b);
    return keyA.localeCompare(keyB);
  });

  return uniqueSources;
}

/**
 * Compute SHA256 hash of canonical used_sources
 * 
 * Returns lowercase hex string (64 chars)
 */
export function hashUsedSources(sources: UsedSources): string {
  const canonical = canonicalizeUsedSources(sources);
  
  // Serialize to deterministic JSON
  const json = JSON.stringify(canonical);
  
  // Compute SHA256
  const hash = createHash('sha256');
  hash.update(json, 'utf8');
  return hash.digest('hex');
}

/**
 * Prepare used_sources for storage
 * 
 * Returns both canonical JSON and hash for database storage
 */
export function prepareUsedSourcesForStorage(sources: UsedSources | null | undefined): {
  canonical: UsedSources | null;
  hash: string | null;
} {
  if (!sources || sources.length === 0) {
    return { canonical: null, hash: null };
  }

  const canonical = canonicalizeUsedSources(sources);
  
  if (canonical.length === 0) {
    return { canonical: null, hash: null };
  }

  const hash = createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');

  return { canonical, hash };
}
