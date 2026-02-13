import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/api/response-helpers';
import {
  evaluateGuardrailsPreflight,
  GUARDRAILS_POLICY_VERSION,
  type GuardrailsPreflightCheck,
  type GuardrailsPreflightErrorCode,
  type GuardrailsPreflightRequest,
} from '@/lib/guardrails/preflight-evaluator';

type PreflightSuccessResponse = {
  ok: true;
  allowed: true;
  requestId: string;
  policyVersion: string;
  checks: PreflightCheck[];
};

type PreflightErrorResponse = {
  ok: false;
  allowed: false;
  code: GuardrailsPreflightErrorCode;
  requestId: string;
  missingConfig?: string[];
  detailsSafe?: string;
};

const HANDLER_MARKER = 'guardrails-preflight';

function buildHeaders(requestId: string, missingConfig: string[]): Headers {
  const headers = new Headers();
  headers.set('x-afu9-request-id', requestId);
  headers.set('x-afu9-handler', HANDLER_MARKER);
  headers.set('x-afu9-phase', 'preflight');
  headers.set('x-afu9-missing-config', missingConfig.length ? missingConfig.join(',') : '');
  return headers;
}

function respondNoop(requestId: string): NextResponse {
  const headers = buildHeaders(requestId, []);
  return new NextResponse(null, { status: 204, headers });
}

function respondError(params: {
  status: number;
  code: GuardrailsPreflightErrorCode;
  requestId: string;
  missingConfig?: string[];
  detailsSafe?: string;
}): NextResponse {
  const body: PreflightErrorResponse = {
    ok: false,
    allowed: false,
    code: params.code,
    requestId: params.requestId,
    missingConfig: params.missingConfig,
    detailsSafe: params.detailsSafe,
  };
  const headers = buildHeaders(params.requestId, params.missingConfig ?? []);
  return NextResponse.json(body, { status: params.status, headers });
}

function respondSuccess(params: {
  requestId: string;
  checks: GuardrailsPreflightCheck[];
  policyVersion: string;
}): NextResponse {
  const body: PreflightSuccessResponse = {
    ok: true,
    allowed: true,
    requestId: params.requestId,
    policyVersion: params.policyVersion,
    checks: params.checks,
  };
  const headers = buildHeaders(params.requestId, []);
  return NextResponse.json(body, { status: 200, headers });
}

export async function POST(request: NextRequest) {
  let payload: GuardrailsPreflightRequest = {};
  try {
    payload = (await request.json()) as GuardrailsPreflightRequest;
  } catch {
    payload = {};
  }

  const requestId = payload.requestId?.trim() || getRequestId(request);
  const decision = evaluateGuardrailsPreflight({ ...payload, requestId });

  if (decision.outcome === 'noop') {
    return respondNoop(decision.requestId);
  }

  if (decision.outcome === 'deny') {
    return respondError({
      status: 409,
      code: decision.code,
      requestId: decision.requestId,
      missingConfig: decision.missingConfig,
      detailsSafe: decision.detailsSafe,
    });
  }

  return respondSuccess({
    requestId: decision.requestId,
    checks: decision.checks,
    policyVersion: decision.policyVersion || GUARDRAILS_POLICY_VERSION,
  });
}
