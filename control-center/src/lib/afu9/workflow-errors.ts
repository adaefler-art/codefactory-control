import { NextResponse } from 'next/server';

export type Afu9Phase = 'preflight' | 'execute' | 'mapped' | 'success';
export type Afu9BlockedBy = 'STATE' | 'POLICY' | 'CONFIG' | 'UPSTREAM' | 'INTERNAL';

export const COMMON_AFU9_CODES = {
  ISSUE_NOT_FOUND: 'ISSUE_NOT_FOUND',
} as const;

export const S2_SPEC_CODES = {
  SPEC_NOT_READY: 'SPEC_NOT_READY',
  GITHUB_MIRROR_MISSING: 'GITHUB_MIRROR_MISSING',
  GUARDRAIL_REPO_NOT_ALLOWED: 'GUARDRAIL_REPO_NOT_ALLOWED',
  GUARDRAIL_CONFIG_MISSING: 'GUARDRAIL_CONFIG_MISSING',
  GITHUB_AUTH_MISSING: 'GITHUB_AUTH_MISSING',
  GITHUB_AUTH_INVALID: 'GITHUB_AUTH_INVALID',
  GITHUB_TARGET_NOT_FOUND: 'GITHUB_TARGET_NOT_FOUND',
  GITHUB_VALIDATION_FAILED: 'GITHUB_VALIDATION_FAILED',
  GITHUB_UPSTREAM_UNREACHABLE: 'GITHUB_UPSTREAM_UNREACHABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const S3_IMPLEMENT_CODES = {
  SPEC_NOT_READY: 'SPEC_NOT_READY',
  GITHUB_MIRROR_MISSING: 'GITHUB_MIRROR_MISSING',
  IMPLEMENT_TRIGGER_CONFIG_MISSING: 'IMPLEMENT_TRIGGER_CONFIG_MISSING',
  GUARDRAIL_REPO_NOT_ALLOWED: 'GUARDRAIL_REPO_NOT_ALLOWED',
  GUARDRAIL_CONFIG_MISSING: 'GUARDRAIL_CONFIG_MISSING',
  GITHUB_AUTH_MISSING: 'GITHUB_AUTH_MISSING',
  GITHUB_AUTH_INVALID: 'GITHUB_AUTH_INVALID',
  GITHUB_TARGET_NOT_FOUND: 'GITHUB_TARGET_NOT_FOUND',
  GITHUB_VALIDATION_FAILED: 'GITHUB_VALIDATION_FAILED',
  GITHUB_UPSTREAM_UNREACHABLE: 'GITHUB_UPSTREAM_UNREACHABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type Afu9Stage = 'S2' | 'S3';

const S2_ALLOWED = new Set<string>([
  ...Object.values(S2_SPEC_CODES),
  ...Object.values(COMMON_AFU9_CODES),
]);

const S3_ALLOWED = new Set<string>([
  ...Object.values(S3_IMPLEMENT_CODES),
  ...Object.values(COMMON_AFU9_CODES),
]);

function isAllowedCode(stage: Afu9Stage, code: string): boolean {
  return stage === 'S2' ? S2_ALLOWED.has(code) : S3_ALLOWED.has(code);
}

function resolveStatus(params: { code: string; blockedBy: Afu9BlockedBy }): number {
  if (params.code === COMMON_AFU9_CODES.ISSUE_NOT_FOUND) {
    return 404;
  }
  if (params.blockedBy === 'INTERNAL') {
    return 500;
  }
  if (params.blockedBy === 'UPSTREAM' && params.code === 'GITHUB_UPSTREAM_UNREACHABLE') {
    return 502;
  }
  return 409;
}

export function makeAfu9Error(params: {
  stage: Afu9Stage;
  code: string;
  phase: Afu9Phase;
  blockedBy: Afu9BlockedBy;
  nextAction: string;
  requestId: string;
  handler: string;
  missingConfig?: string[];
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}): NextResponse {
  if (!isAllowedCode(params.stage, params.code)) {
    throw new Error(`Unknown AFU9 error code: ${params.code}`);
  }

  const status = resolveStatus({ code: params.code, blockedBy: params.blockedBy });
  const body: Record<string, unknown> = {
    ok: false,
    code: params.code,
    phase: params.phase,
    blockedBy: params.blockedBy,
    nextAction: params.nextAction,
    requestId: params.requestId,
    ...(params.missingConfig && params.missingConfig.length > 0
      ? { missingConfig: params.missingConfig }
      : {}),
    ...(params.extraBody ?? {}),
  };

  const response = NextResponse.json(body, { status });
  response.headers.set('x-afu9-request-id', params.requestId);
  response.headers.set('x-afu9-handler', params.handler);
  response.headers.set('x-afu9-phase', params.phase);
  response.headers.set('x-afu9-blocked-by', params.blockedBy);
  response.headers.set('x-afu9-error-code', params.code);
  response.headers.set('cache-control', 'no-store');

  if (params.missingConfig && params.missingConfig.length > 0) {
    response.headers.set('x-afu9-missing-config', params.missingConfig.join(','));
  }

  if (params.extraHeaders) {
    Object.entries(params.extraHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }

  return response;
}
