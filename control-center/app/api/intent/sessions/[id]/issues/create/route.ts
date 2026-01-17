import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getLatestCommittedVersion } from '@/lib/db/intentIssueDraftVersions';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

// Dummy helpers for afu9_issues and timeline/evidence (replace with real imports if available)
async function upsertAfu9Issue(pool: any, issue: any) {
  // Upsert by canonicalId
  // ...implementation...
  return { success: true, id: 'AFU9-123', publicId: 'I123', canonicalId: issue.canonicalId };
}
async function createTimelineEntry(pool: any, issueId: string, entry: any) {
  // ...implementation...
}
async function createEvidenceEntry(pool: any, issueId: string, entry: any) {
  // ...implementation...
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  let sessionId = 'unknown';
  try {
    const params = await context.params;
    sessionId = params?.id ?? 'unknown';
  } catch {}
  console.log('[intent.afu9IssueCreate.start]', JSON.stringify({ requestId, sessionId, method: 'POST', path: '/api/intent/sessions/[id]/issues/create', timestamp: new Date().toISOString() }));
  try {
    // Auth guard (reuse x-afu9-sub)
    const userId = request.headers.get('x-afu9-sub');
    if (!userId || !userId.trim()) {
      return errorResponse('Unauthorized', { status: 401, requestId, code: 'UNAUTHORIZED', details: 'Authentication required' });
    }
    const pool = getPool();
    // 1) Load draft
    const draftResult = await getIssueDraft(pool, sessionId, userId);
    if (!draftResult.success) {
      return errorResponse('Failed to check draft', { status: 500, requestId, details: draftResult.error });
    }
    if (!draftResult.data) {
      return jsonResponse({ error: 'No draft exists', code: 'NO_DRAFT' }, { status: 404, requestId });
    }
    // 2) Load latest committed version
    const versionResult = await getLatestCommittedVersion(pool, sessionId, userId);
    if (!versionResult.success) {
      return errorResponse('Failed to check committed version', { status: 500, requestId, details: versionResult.error });
    }
    if (!versionResult.data) {
      return jsonResponse({ error: 'No committed version', code: 'NO_COMMITTED_VERSION' }, { status: 409, requestId });
    }
    const draft = draftResult.data;
    const version = versionResult.data;
    // 3) Upsert AFU-9 Issue
    const issue = {
      canonicalId: draft.canonicalId,
      title: draft.title,
      body: draft.body,
      labels: draft.labels,
      type: draft.type,
      priority: draft.priority,
      status: 'CREATED',
      sourceVersion: version.version_number,
      sourceHash: version.hash,
    };
    const upsertResult = await upsertAfu9Issue(pool, issue);
    if (!upsertResult.success) {
      return errorResponse('Failed to create AFU-9 Issue', { status: 500, requestId, details: upsertResult.error });
    }
    // 4) Timeline/evidence (best-effort)
    try { await createTimelineEntry(pool, upsertResult.id, { type: 'CREATED', by: userId }); } catch {}
    try { await createEvidenceEntry(pool, upsertResult.id, { type: 'DRAFT_COMMITTED', version: version.version_number }); } catch {}
    // 5) Success log and response
    console.log('[intent.afu9IssueCreate.success]', JSON.stringify({ requestId, sessionId, canonicalId: issue.canonicalId, issueId: upsertResult.id, timestamp: new Date().toISOString() }));
    return jsonResponse({ state: 'AFU9_ISSUE_CREATED', issueId: upsertResult.id, publicId: upsertResult.publicId, canonicalId: upsertResult.canonicalId }, { status: 201, requestId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[intent.afu9IssueCreate.fail]', JSON.stringify({ requestId, sessionId, errorName, errorMessage, errorStack, timestamp: new Date().toISOString() }));
    return jsonResponse({ error: 'Failed to create AFU-9 Issue', timestamp: new Date().toISOString(), details: errorMessage || 'Unhandled error', requestId }, { status: 500, requestId });
  }
}
