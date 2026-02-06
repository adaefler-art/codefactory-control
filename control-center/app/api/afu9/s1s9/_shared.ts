import { getPool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordTimelineEvent } from '@/lib/db/unifiedTimelineEvents';

type ResponseProvider = () => Promise<Response>;

type ScopeName = 's1s9' | 's1s3';

type ScopeFallbackOptions = {
  primary: ResponseProvider;
  fallback: ResponseProvider;
  primaryScope: ScopeName;
  fallbackScope: ScopeName;
  requestedScope?: ScopeName;
  issueId?: string;
};

const log = logger.withComponent('afu9-scope');

type ScopeHeaderParams = {
  requestedScope: ScopeName;
  resolvedScope: ScopeName;
  errorCode?: string | null;
};

export function buildAfu9ScopeHeaders(params: ScopeHeaderParams): Record<string, string> {
  const headers: Record<string, string> = {
    'x-afu9-scope-requested': params.requestedScope,
    'x-afu9-scope-resolved': params.resolvedScope,
  };

  if (params.errorCode) {
    headers['x-afu9-error-code'] = params.errorCode;
  }

  return headers;
}

export async function isIssueNotFound(response: Response): Promise<boolean> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return false;
  }

  try {
    const body = await response.clone().json();
    return Boolean(body && typeof body === 'object' && body.errorCode === 'issue_not_found');
  } catch {
    return false;
  }
}

async function getErrorCode(response: Response): Promise<string | null> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    const body = await response.clone().json();
    return typeof body?.errorCode === 'string' ? body.errorCode : null;
  } catch {
    return null;
  }
}

async function applyAfu9ScopeHeaders(
  response: Response,
  params: ScopeHeaderParams
): Promise<Response> {
  response.headers.set('x-afu9-scope-requested', params.requestedScope);
  response.headers.set('x-afu9-scope-resolved', params.resolvedScope);

  if (params.errorCode) {
    response.headers.set('x-afu9-error-code', params.errorCode);
  } else {
    response.headers.delete('x-afu9-error-code');
  }

  return response;
}

async function emitScopeMismatchEvent(params: {
  issueId?: string;
  requestId: string;
  requestedScope: ScopeName;
  resolvedScope: ScopeName;
  errorCode?: string | null;
}): Promise<void> {
  if (!params.issueId) {
    return;
  }

  const pool = getPool();

  try {
    await recordTimelineEvent(pool, {
      event_type: 'issue_updated',
      timestamp: new Date().toISOString(),
      actor: 'control-center',
      subject_type: 'afu9_issue',
      subject_identifier: params.issueId,
      request_id: params.requestId,
      summary: 'AFU9 scope resolved via fallback',
      details: {
        requestedScope: params.requestedScope,
        resolvedScope: params.resolvedScope,
        errorCode: params.errorCode || undefined,
      },
    });
  } catch (error) {
    log.warn('Failed to emit AFU9 scope fallback event', {
      issueId: params.issueId,
      requestId: params.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function withAfu9ScopeFallback(options: ScopeFallbackOptions): Promise<Response> {
  const primaryResponse = await options.primary();
  const needsFallback = await isIssueNotFound(primaryResponse);
  const requestedScope = options.requestedScope ?? options.primaryScope;
  const requestId =
    primaryResponse.headers.get('x-afu9-request-id') ||
    primaryResponse.headers.get('x-request-id') ||
    'unknown';

  if (!needsFallback) {
    const errorCode = await getErrorCode(primaryResponse);
    return applyAfu9ScopeHeaders(primaryResponse, {
      requestedScope,
      resolvedScope: options.primaryScope,
      errorCode,
    });
  }

  const fallbackResponse = await options.fallback();
  const errorCode = await getErrorCode(fallbackResponse);
  const resolvedScope = options.fallbackScope;

  if (requestedScope !== resolvedScope) {
    log.info('AFU9 scope resolved via fallback', {
      requestId,
      issueId: options.issueId,
      requestedScope,
      resolvedScope,
      errorCode: errorCode || undefined,
    });

    await emitScopeMismatchEvent({
      issueId: options.issueId,
      requestId,
      requestedScope,
      resolvedScope,
      errorCode,
    });
  }

  return applyAfu9ScopeHeaders(fallbackResponse, {
    requestedScope,
    resolvedScope,
    errorCode,
  });
}
