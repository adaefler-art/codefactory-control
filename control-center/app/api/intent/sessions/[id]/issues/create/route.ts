import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getLatestCommittedVersion } from '@/lib/db/intentIssueDraftVersions';
import { ensureIssueForCommittedDraft, getAfu9IssueById, getPublicId } from '@/lib/db/afu9Issues';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';
import type { IssueDraft } from '@/lib/schemas/issueDraft';
import type { Afu9IssueInput } from '@/lib/contracts/afu9Issue';

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
    
    const draft = draftResult.data;
    
    // 2) Validate draft status
    if (draft.last_validation_status !== 'valid') {
      return jsonResponse({ 
        error: 'Draft validation required', 
        code: 'VALIDATION_REQUIRED',
        details: `Draft validation status is '${draft.last_validation_status}', expected 'valid'`
      }, { status: 409, requestId });
    }
    
    // 3) Load latest committed version
    const versionResult = await getLatestCommittedVersion(pool, sessionId, userId);
    if (!versionResult.success) {
      return errorResponse('Failed to check committed version', { status: 500, requestId, details: versionResult.error });
    }
    if (!versionResult.data) {
      return jsonResponse({ error: 'No committed version', code: 'NO_COMMITTED_VERSION' }, { status: 409, requestId });
    }
    
    const version = versionResult.data;
    
    // 4) Parse issue JSON from draft to extract fields
    let issueDraft: IssueDraft;
    try {
      issueDraft = draft.issue_json as IssueDraft;
    } catch (parseError) {
      return errorResponse('Failed to parse draft JSON', { 
        status: 500, 
        requestId, 
        details: parseError instanceof Error ? parseError.message : 'Invalid JSON' 
      });
    }
    
    // 5) Validate required fields
    if (!issueDraft.canonicalId) {
      return jsonResponse({ 
        error: 'Draft missing canonicalId', 
        code: 'MISSING_CANONICAL_ID' 
      }, { status: 400, requestId });
    }
    
    // 6) Map draft to AFU-9 Issue input
    const issueInput: Afu9IssueInput = {
      title: issueDraft.title,
      body: issueDraft.body,
      canonical_id: issueDraft.canonicalId,
      labels: issueDraft.labels || [],
      priority: issueDraft.priority,
      kpi_context: issueDraft.kpi ? {
        dcu: issueDraft.kpi.dcu,
        intent: issueDraft.kpi.intent,
      } : undefined,
    };
    
    // 7) Idempotent upsert: ensureIssueForCommittedDraft handles:
    //    - Checking if issue exists by canonical_id
    //    - Creating new issue if not exists
    //    - Timeline event ISSUE_CREATED (only on insert)
    //    - Returning existing issue if already created
    const createResult = await ensureIssueForCommittedDraft(
      pool,
      issueInput,
      sessionId,
      version.id
    );
    
    if (!createResult.success || !createResult.data) {
      return errorResponse('Failed to create AFU-9 Issue', { 
        status: 500, 
        requestId, 
        details: createResult.error || 'Unknown error' 
      });
    }
    
    const { issue: createdIssue, isNew } = createResult.data;
    
    // 8) Read-after-write gate: verify persistence
    const verifyResult = await getAfu9IssueById(pool, createdIssue.id);
    if (!verifyResult.success || !verifyResult.data) {
      console.error('[intent.afu9IssueCreate.readAfterWriteFail]', JSON.stringify({ 
        requestId, 
        sessionId, 
        issueId: createdIssue.id,
        canonicalId: issueDraft.canonicalId,
        error: verifyResult.error,
        timestamp: new Date().toISOString() 
      }));
      return errorResponse('Issue creation failed read-after-write check', { 
        status: 500, 
        requestId, 
        code: 'E_CREATE_NOT_PERSISTED',
        details: 'Issue was created but could not be read back from database' 
      });
    }
    
    // 9) Generate publicId from UUID
    const publicId = getPublicId(createdIssue.id);
    
    // 10) Success log and response
    console.log('[intent.afu9IssueCreate.success]', JSON.stringify({ 
      requestId, 
      sessionId, 
      canonicalId: issueDraft.canonicalId, 
      issueId: createdIssue.id,
      publicId,
      isNew,
      timestamp: new Date().toISOString() 
    }));
    
    return jsonResponse({ 
      state: 'AFU9_ISSUE_CREATED', 
      issueId: createdIssue.id, 
      publicId, 
      canonicalId: createdIssue.canonical_id,
      isNew, // Indicates if this was a new creation or existing issue
    }, { status: isNew ? 201 : 200, requestId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[intent.afu9IssueCreate.fail]', JSON.stringify({ requestId, sessionId, errorName, errorMessage, errorStack, timestamp: new Date().toISOString() }));
    return jsonResponse({ error: 'Failed to create AFU-9 Issue', timestamp: new Date().toISOString(), details: errorMessage || 'Unhandled error', requestId }, { status: 500, requestId });
  }
}
