/**
 * CR Diff Utility
 * 
 * Provides deterministic JSON diff between two CR versions.
 * Issue E74.4: CR Versioning + Diff
 */

export type DiffOperation = 
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; oldValue: unknown; newValue: unknown };

export interface CrDiff {
  from: {
    id: string;
    version: number;
    hash: string;
  };
  to: {
    id: string;
    version: number;
    hash: string;
  };
  operations: DiffOperation[];
}

/**
 * Compute a deterministic diff between two JSON objects
 * 
 * This produces a simplified diff output focusing on the most common operations.
 * Paths use JSON pointer notation (RFC 6901).
 * 
 * @param from Source object
 * @param to Target object
 * @param path Current path (for recursion)
 * @returns Array of diff operations
 */
function computeJsonDiff(
  from: unknown,
  to: unknown,
  path: string = ''
): DiffOperation[] {
  const operations: DiffOperation[] = [];
  
  // Same value (deep equality check)
  if (JSON.stringify(from) === JSON.stringify(to)) {
    return operations;
  }
  
  // Type change or primitive change
  if (typeof from !== typeof to || from === null || to === null || 
      typeof from !== 'object' || typeof to !== 'object') {
    if (from === undefined) {
      operations.push({ op: 'add', path, value: to });
    } else if (to === undefined) {
      operations.push({ op: 'remove', path });
    } else {
      operations.push({ op: 'replace', path, oldValue: from, newValue: to });
    }
    return operations;
  }
  
  // Array diff
  if (Array.isArray(from) && Array.isArray(to)) {
    const maxLen = Math.max(from.length, to.length);
    for (let i = 0; i < maxLen; i++) {
      const itemPath = `${path}/${i}`;
      if (i >= from.length) {
        operations.push({ op: 'add', path: itemPath, value: to[i] });
      } else if (i >= to.length) {
        operations.push({ op: 'remove', path: itemPath });
      } else {
        operations.push(...computeJsonDiff(from[i], to[i], itemPath));
      }
    }
    return operations;
  }
  
  // Object diff
  const fromObj = from as Record<string, unknown>;
  const toObj = to as Record<string, unknown>;
  
  // Get all keys (sorted for determinism)
  const allKeys = new Set([...Object.keys(fromObj), ...Object.keys(toObj)]);
  const sortedKeys = Array.from(allKeys).sort();
  
  for (const key of sortedKeys) {
    const keyPath = path ? `${path}/${escapeJsonPointer(key)}` : `/${escapeJsonPointer(key)}`;
    const fromVal = fromObj[key];
    const toVal = toObj[key];
    
    if (!(key in fromObj)) {
      operations.push({ op: 'add', path: keyPath, value: toVal });
    } else if (!(key in toObj)) {
      operations.push({ op: 'remove', path: keyPath });
    } else {
      operations.push(...computeJsonDiff(fromVal, toVal, keyPath));
    }
  }
  
  return operations;
}

/**
 * Escape special characters in JSON pointer tokens
 * Per RFC 6901: '~' becomes '~0' and '/' becomes '~1'
 */
function escapeJsonPointer(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Compute diff between two CR versions
 * 
 * @param fromVersion Source CR version
 * @param toVersion Target CR version
 * @returns Deterministic diff result
 */
export function computeCrDiff(
  fromVersion: { id: string; cr_json: unknown; cr_hash: string; cr_version: number },
  toVersion: { id: string; cr_json: unknown; cr_hash: string; cr_version: number }
): CrDiff {
  return {
    from: {
      id: fromVersion.id,
      version: fromVersion.cr_version,
      hash: fromVersion.cr_hash,
    },
    to: {
      id: toVersion.id,
      version: toVersion.cr_version,
      hash: toVersion.cr_hash,
    },
    operations: computeJsonDiff(fromVersion.cr_json, toVersion.cr_json),
  };
}
