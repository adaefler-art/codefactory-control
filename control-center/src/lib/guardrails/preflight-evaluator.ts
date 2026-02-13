import { isRepoAllowed } from '@/lib/github/auth-wrapper';

export type GuardrailsPreflightRequest = {
  requestId?: string;
  operation?: string;
  repo?: string;
  actor?: string;
  capabilities?: string[];
  requiresConfig?: string[];
};

export type GuardrailsPreflightCheck = {
  id: string;
  status: 'ALLOW' | 'DENY' | 'SKIP';
  detail?: string;
};

export type GuardrailsPreflightErrorCode =
  | 'GUARDRAIL_REPO_NOT_ALLOWED'
  | 'GUARDRAIL_TOKEN_SCOPE_INVALID'
  | 'GUARDRAIL_CONFIG_MISSING';

export type GuardrailsPreflightDecision =
  | {
      outcome: 'noop';
      requestId: string;
    }
  | {
      outcome: 'deny';
      requestId: string;
      code: GuardrailsPreflightErrorCode;
      missingConfig?: string[];
      detailsSafe?: string;
    }
  | {
      outcome: 'allow';
      requestId: string;
      policyVersion: string;
      checks: GuardrailsPreflightCheck[];
    };

const POLICY_VERSION = 'v1';

function hasValue(value: string | undefined | null): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isGuardrailsEnabled(): boolean {
  const raw = process.env.AFU9_GUARDRAILS_ENABLED;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

function resolveMissingConfig(keys: string[]): string[] {
  return keys.filter((key) => !hasValue(process.env[key]));
}

function parseRepo(repo?: string): { owner: string; repo: string } | null {
  if (!repo) {
    return null;
  }
  const trimmed = repo.trim();
  if (!trimmed.includes('/')) {
    return null;
  }
  const [owner, name] = trimmed.split('/');
  if (!owner || !name) {
    return null;
  }
  return { owner: owner.trim(), repo: name.trim() };
}

function normalizeList(values?: string[]): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((entry) => String(entry).trim()).filter(Boolean);
}

export function evaluateGuardrailsPreflight(
  payload: GuardrailsPreflightRequest
): GuardrailsPreflightDecision {
  const requestId = payload.requestId?.trim() || 'unknown';

  if (!isGuardrailsEnabled()) {
    return { outcome: 'noop', requestId };
  }

  const operation = payload.operation?.trim() || '';
  const capabilities = normalizeList(payload.capabilities);
  const requiresConfig = normalizeList(payload.requiresConfig);

  const missingConfig = resolveMissingConfig(requiresConfig);
  if (missingConfig.length > 0) {
    return {
      outcome: 'deny',
      requestId,
      code: 'GUARDRAIL_CONFIG_MISSING',
      missingConfig,
      detailsSafe: `Missing required config: ${missingConfig.join(', ')}`,
    };
  }

  const repoParsed = parseRepo(payload.repo);
  if (repoParsed) {
    const allowed = isRepoAllowed(repoParsed.owner, repoParsed.repo);
    if (!allowed) {
      return {
        outcome: 'deny',
        requestId,
        code: 'GUARDRAIL_REPO_NOT_ALLOWED',
        detailsSafe: `Repo not allowlisted: ${repoParsed.owner}/${repoParsed.repo}`,
      };
    }
  } else if (payload.repo) {
    return {
      outcome: 'deny',
      requestId,
      code: 'GUARDRAIL_REPO_NOT_ALLOWED',
      detailsSafe: 'Repo not allowlisted: invalid repo format',
    };
  }

  const requiresWrite = operation === 'repo_write' || capabilities.includes('repo-write');
  const tokenScope = process.env.AFU9_GUARDRAILS_TOKEN_SCOPE?.trim().toLowerCase();
  if (requiresWrite && tokenScope === 'readonly') {
    return {
      outcome: 'deny',
      requestId,
      code: 'GUARDRAIL_TOKEN_SCOPE_INVALID',
      detailsSafe: 'Token scope does not allow repo-write operations',
    };
  }

  const checks: GuardrailsPreflightCheck[] = [
    {
      id: 'config-requirements',
      status: requiresConfig.length > 0 ? 'ALLOW' : 'SKIP',
    },
    {
      id: 'repo-allowlist',
      status: payload.repo ? 'ALLOW' : 'SKIP',
    },
    {
      id: 'token-scope',
      status: requiresWrite ? 'ALLOW' : 'SKIP',
    },
  ];

  return {
    outcome: 'allow',
    requestId,
    policyVersion: POLICY_VERSION,
    checks,
  };
}

export const GUARDRAILS_POLICY_VERSION = POLICY_VERSION;
