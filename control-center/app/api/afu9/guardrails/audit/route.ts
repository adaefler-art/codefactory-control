import { NextRequest, NextResponse } from 'next/server';
import { getRequestId } from '@/lib/api/response-helpers';

export type GuardrailFinding = {
  level: 'critical' | 'warn' | 'info';
  code: string;
  messageSafe: string;
  detailsSafe?: string;
};

export type GuardrailSummary = {
  critical: number;
  warn: number;
  info: number;
};

type GuardrailAuditResponse = {
  ok: true;
  ts: string;
  summary: GuardrailSummary;
  findings: GuardrailFinding[];
};

const HANDLER_MARKER = 'guardrails.audit';

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function buildHeaders(requestId: string): Headers {
  const headers = new Headers();
  headers.set('x-afu9-request-id', requestId);
  headers.set('x-afu9-handler', HANDLER_MARKER);
  headers.set('cache-control', 'no-store');
  return headers;
}

function parseAllowlistStatus(): GuardrailFinding {
  const raw = process.env.GITHUB_REPO_ALLOWLIST;
  if (!hasValue(raw)) {
    return {
      level: 'warn',
      code: 'REPO_ALLOWLIST_MISSING',
      messageSafe: 'Repo allowlist not configured',
    };
  }
  try {
    const parsed = JSON.parse(raw as string) as { allowlist?: unknown };
    const entries = Array.isArray(parsed.allowlist) ? parsed.allowlist : [];
    if (entries.length === 0) {
      return {
        level: 'warn',
        code: 'REPO_ALLOWLIST_EMPTY',
        messageSafe: 'Repo allowlist configured but empty',
      };
    }
    return {
      level: 'info',
      code: 'REPO_ALLOWLIST_CONFIGURED',
      messageSafe: 'Repo allowlist configured',
    };
  } catch (error) {
    return {
      level: 'warn',
      code: 'REPO_ALLOWLIST_INVALID',
      messageSafe: 'Repo allowlist invalid format',
    };
  }
}

function parseTokenScopeStatus(): GuardrailFinding {
  const tokenScope = process.env.AFU9_GUARDRAILS_TOKEN_SCOPE?.trim().toLowerCase();
  if (!hasValue(tokenScope)) {
    return {
      level: 'warn',
      code: 'TOKEN_SCOPE_MISSING',
      messageSafe: 'Token scope policy not configured',
    };
  }
  return {
    level: 'info',
    code: 'TOKEN_SCOPE_CONFIGURED',
    messageSafe: 'Token scope policy configured',
  };
}

function parseSecretRedactionStatus(): GuardrailFinding {
  const redactionMode = process.env.AFU9_SECRET_REDACTION?.trim().toLowerCase();
  if (!hasValue(redactionMode)) {
    return {
      level: 'warn',
      code: 'SECRET_REDACTION_MISSING',
      messageSafe: 'No secret redaction policy configured',
    };
  }
  return {
    level: 'info',
    code: 'SECRET_REDACTION_CONFIGURED',
    messageSafe: 'Secret redaction policy configured',
  };
}

function parseEgressAllowlistStatus(): GuardrailFinding {
  const egressAllowlist = process.env.AFU9_EGRESS_ALLOWLIST?.trim();
  if (!hasValue(egressAllowlist)) {
    return {
      level: 'warn',
      code: 'EGRESS_ALLOWLIST_NOT_IMPLEMENTED',
      messageSafe: 'Egress allowlist not implemented',
    };
  }
  return {
    level: 'info',
    code: 'EGRESS_ALLOWLIST_CONFIGURED',
    messageSafe: 'Egress allowlist configured',
  };
}

function buildGithubAppAuthStatus(): GuardrailFinding {
  return {
    level: 'info',
    code: 'GITHUB_APP_AUTH_REQUIRED',
    messageSafe: 'GitHub App authentication required for write operations',
  };
}

function buildSummary(findings: GuardrailFinding[]): GuardrailSummary {
  return findings.reduce<GuardrailSummary>(
    (acc, finding) => {
      acc[finding.level] += 1;
      return acc;
    },
    { critical: 0, warn: 0, info: 0 }
  );
}

export function buildGuardrailsAuditSnapshot() {
  const findings = [
    parseAllowlistStatus(),
    parseTokenScopeStatus(),
    parseSecretRedactionStatus(),
    parseEgressAllowlistStatus(),
    buildGithubAppAuthStatus(),
  ];

  return {
    ts: new Date().toISOString(),
    summary: buildSummary(findings),
    findings,
  };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const snapshot = buildGuardrailsAuditSnapshot();
  const body: GuardrailAuditResponse = {
    ok: true,
    ...snapshot,
  };

  const headers = buildHeaders(requestId);
  return NextResponse.json(body, { status: 200, headers });
}
