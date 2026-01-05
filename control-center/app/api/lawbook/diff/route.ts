/**
 * POST /api/lawbook/diff
 * 
 * Compare two lawbook versions and return deterministic diff.
 * Diff is computed using JSON pointers with stable path ordering.
 * 
 * SECURITY: The x-afu9-sub header is set by proxy.ts after server-side JWT verification.
 * Client-provided x-afu9-* headers are stripped by proxy.ts (lines 415-419) to prevent spoofing.
 * This route trusts x-afu9-sub because it can only come from verified middleware.
 * 
 * AUTH POLICY: All authenticated users allowed (read-only operation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLawbookVersionById } from '@/lib/db/lawbook';
import { withApi } from '@/lib/http/withApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DiffChange {
  path: string;
  changeType: 'added' | 'removed' | 'modified';
  before: unknown;
  after: unknown;
}

/**
 * Compute deterministic diff between two JSON objects
 * Returns changes sorted by path for stability
 */
function computeDiff(before: any, after: any, basePath: string = ''): DiffChange[] {
  const changes: DiffChange[] = [];
  
  // Collect all keys from both objects
  const allKeys = new Set<string>();
  
  if (typeof before === 'object' && before !== null && !Array.isArray(before)) {
    Object.keys(before).forEach(k => allKeys.add(k));
  }
  
  if (typeof after === 'object' && after !== null && !Array.isArray(after)) {
    Object.keys(after).forEach(k => allKeys.add(k));
  }
  
  // Handle primitive or array values
  if (
    typeof before !== 'object' || before === null || Array.isArray(before) ||
    typeof after !== 'object' || after === null || Array.isArray(after)
  ) {
    // Stringify for comparison
    const beforeStr = JSON.stringify(before);
    const afterStr = JSON.stringify(after);
    
    if (beforeStr !== afterStr) {
      changes.push({
        path: basePath || '$',
        changeType: 'modified',
        before,
        after,
      });
    }
    return changes;
  }
  
  // Process each key
  const sortedKeys = Array.from(allKeys).sort();
  
  for (const key of sortedKeys) {
    const path = basePath ? `${basePath}.${key}` : key;
    const beforeVal = before[key];
    const afterVal = after[key];
    
    const beforeHasKey = key in before;
    const afterHasKey = key in after;
    
    if (!beforeHasKey && afterHasKey) {
      // Added
      changes.push({
        path,
        changeType: 'added',
        before: undefined,
        after: afterVal,
      });
    } else if (beforeHasKey && !afterHasKey) {
      // Removed
      changes.push({
        path,
        changeType: 'removed',
        before: beforeVal,
        after: undefined,
      });
    } else if (beforeHasKey && afterHasKey) {
      // Check if modified
      const beforeType = typeof beforeVal;
      const afterType = typeof afterVal;
      
      if (beforeType !== afterType) {
        // Type changed
        changes.push({
          path,
          changeType: 'modified',
          before: beforeVal,
          after: afterVal,
        });
      } else if (beforeType === 'object' && beforeVal !== null && afterVal !== null) {
        // Recurse for nested objects
        const nestedChanges = computeDiff(beforeVal, afterVal, path);
        changes.push(...nestedChanges);
      } else {
        // Primitive comparison
        if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
          changes.push({
            path,
            changeType: 'modified',
            before: beforeVal,
            after: afterVal,
          });
        }
      }
    }
  }
  
  return changes;
}

export const POST = withApi(async (request: NextRequest) => {
  // AUTH CHECK (401-first): Verify x-afu9-sub header from middleware
  const userId = request.headers.get('x-afu9-sub');
  if (!userId || !userId.trim()) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Authentication required' },
      { status: 401 }
    );
  }

  let body: any;
  
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { versionId1, versionId2 } = body;

  if (!versionId1 || typeof versionId1 !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid versionId1' },
      { status: 400 }
    );
  }

  if (!versionId2 || typeof versionId2 !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid versionId2' },
      { status: 400 }
    );
  }

  // Fetch both versions
  const [version1, version2] = await Promise.all([
    getLawbookVersionById(versionId1),
    getLawbookVersionById(versionId2),
  ]);

  if (!version1) {
    return NextResponse.json(
      { error: `Version not found: ${versionId1}` },
      { status: 404 }
    );
  }

  if (!version2) {
    return NextResponse.json(
      { error: `Version not found: ${versionId2}` },
      { status: 404 }
    );
  }

  // Compute diff (deterministic, sorted by path)
  const changes = computeDiff(version1.lawbook_json, version2.lawbook_json);

  return NextResponse.json(
    {
      version1: {
        id: version1.id,
        lawbookVersion: version1.lawbook_version,
        lawbookHash: version1.lawbook_hash,
      },
      version2: {
        id: version2.id,
        lawbookVersion: version2.lawbook_version,
        lawbookHash: version2.lawbook_hash,
      },
      changes,
      changeCount: changes.length,
    },
    { status: 200 }
  );
}, {
  mapError: (error, requestId) => ({
    error: 'Failed to compute lawbook diff',
    details: error instanceof Error ? error.message : 'Unknown error',
  }),
});
