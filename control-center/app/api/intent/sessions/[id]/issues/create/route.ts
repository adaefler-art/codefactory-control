import { NextRequest } from 'next/server';
import { getPool } from '@/lib/db';
import { getIssueDraft } from '@/lib/db/intentIssueDrafts';
import { getLatestCommittedVersion } from '@/lib/db/intentIssueDraftVersions';
import { ensureIssueForCommittedDraft, getPublicId, getAfu9IssueById, getAfu9IssueByCanonicalId } from '@/lib/db/afu9Issues';
import { IssueDraftSchema, type IssueDraft } from '@/lib/schemas/issueDraft';
import { getRequestId, jsonResponse, errorResponse } from '@/lib/api/response-helpers';

function parseIssueDraft(raw: unknown): { success: true; data: IssueDraft } | { success: false; error: string } {
  let candidate = raw;

  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch (error) {
      return { success: false, error: 'Draft JSON is not valid' };
    }
  }

  const parsed = IssueDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    return {
      success: false,
      error: firstError ? `${firstError.path.join('.') || 'draft'}: ${firstError.message}` : 'Draft validation failed',
    };
  }

  return { success: true, data: parsed.data };
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

    if (draft.last_validation_status !== 'valid') {
      return jsonResponse({ error: 'Draft is not valid', code: 'DRAFT_NOT_VALID' }, { status: 409, requestId });
    }

    const parsedDraft = parseIssueDraft(draft.issue_json);
    if (!parsedDraft.success) {
      return jsonResponse({ error: parsedDraft.error, code: 'DRAFT_INVALID_SCHEMA' }, { status: 422, requestId });
    }

    const issueDraft = parsedDraft.data;

    const issueInput = {
      title: issueDraft.title,
      body: issueDraft.body,
      labels: issueDraft.labels || [],
      priority: issueDraft.priority || null,
      canonical_id: issueDraft.canonicalId,
      kpi_context: issueDraft.kpi ? {
        dcu: issueDraft.kpi.dcu,
        intent: issueDraft.kpi.intent,
      } : null,
    };

    const ensureResult = await ensureIssueForCommittedDraft(
      pool,
      issueInput,
      sessionId,
      version.id,
      version.issue_hash
    );

    if (!ensureResult.success || !ensureResult.data) {
      return errorResponse('Failed to create AFU-9 Issue', { status: 500, requestId, details: ensureResult.error });
    }

    const { issue, isNew } = ensureResult.data;
    const canonicalId = issue.canonical_id || issueDraft.canonicalId;

    const verifyById = await getAfu9IssueById(pool, issue.id);
    if (!verifyById.success || !verifyById.data) {
      return jsonResponse({ error: 'E_CREATE_NOT_PERSISTED' }, { status: 500, requestId });
    }

    const verifyByCanonical = await getAfu9IssueByCanonicalId(pool, canonicalId);
    if (!verifyByCanonical.success || !verifyByCanonical.data || verifyByCanonical.data.id !== issue.id) {
      return jsonResponse({ error: 'E_CREATE_NOT_PERSISTED' }, { status: 500, requestId });
    }

    console.log(
      JSON.stringify({
        event: 'AFU9_ISSUE_CREATED',
        canonicalId,
        issueId: issue.id,
        sessionId,
        issue_hash: version.issue_hash || null,
        requestId,
        timestamp: new Date().toISOString(),
      })
    );
    console.log('[intent.afu9IssueCreate.success]', JSON.stringify({ requestId, sessionId, canonicalId, issueId: issue.id, timestamp: new Date().toISOString() }));
    return jsonResponse({ state: issue.status, issueId: issue.id, publicId: getPublicId(issue.id), canonicalId }, { status: isNew ? 201 : 200, requestId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[intent.afu9IssueCreate.fail]', JSON.stringify({ requestId, sessionId, errorName, errorMessage, errorStack, timestamp: new Date().toISOString() }));
    return jsonResponse({ error: 'Failed to create AFU-9 Issue', timestamp: new Date().toISOString(), details: errorMessage || 'Unhandled error', requestId }, { status: 500, requestId });
  }
}
