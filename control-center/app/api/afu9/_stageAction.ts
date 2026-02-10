import { jsonResponse, getRouteHeaderValue } from '@/lib/api/response-helpers';
import { getControlResponseHeaders } from '../issues/_shared';

export type StageHeaderConfig = {
  requestId: string;
  routeHeaderValue?: string;
  handler: string;
  version?: string;
};

export type StageErrorPayload = {
  ok: false;
  errorCode: string;
  message: string;
  requestId: string;
  detailsSafe?: string;
  missingConfig?: string[];
  preconditionFailed?: string | null;
  upstreamStatus?: number;
  githubRequestId?: string;
  code?: string;
};

function resolveCommitSha(): string {
  const raw =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA;
  if (!raw) return 'unknown';
  return raw.slice(0, 7);
}

export function buildStageHeaders(config: StageHeaderConfig): Record<string, string> {
  return {
    ...getControlResponseHeaders(config.requestId, config.routeHeaderValue),
    'x-afu9-handler': config.handler,
    'x-afu9-handler-ver': config.version || 'v1',
    'x-afu9-commit': resolveCommitSha(),
    'x-cf-handler': config.handler,
  };
}

export function applyStageHeaders(response: Response, config: StageHeaderConfig): Response {
  response.headers.set('x-afu9-handler', config.handler);
  response.headers.set('x-afu9-handler-ver', config.version || 'v1');
  response.headers.set('x-afu9-commit', resolveCommitSha());
  response.headers.set('x-cf-handler', config.handler);
  return response;
}

export function stageErrorResponse(
  payload: StageErrorPayload,
  options: {
    status: number;
    headers: Record<string, string>;
    requestId: string;
  }
) {
  return jsonResponse(payload, {
    status: options.status,
    requestId: options.requestId,
    headers: {
      ...options.headers,
      'x-afu9-error-code': payload.errorCode || payload.code || 'UNKNOWN',
    },
  });
}

export function assertPrecondition(
  condition: boolean,
  payload: StageErrorPayload,
  options: {
    status?: number;
    headers: Record<string, string>;
    requestId: string;
  }
): Response | null {
  if (condition) return null;
  return stageErrorResponse(payload, {
    status: options.status ?? 409,
    headers: options.headers,
    requestId: options.requestId,
  });
}

export function getStageRouteHeaderValue(request: {
  method?: string;
  nextUrl?: { pathname?: string } | null;
  url?: string;
}): string {
  return getRouteHeaderValue(request);
}
