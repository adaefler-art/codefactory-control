export type PreflightDecision = {
  ok: false;
  status: 409;
  code: string;
  blockedBy: 'STATE' | 'POLICY' | 'CONFIG';
  phase: 'preflight';
  nextAction: string;
  missingConfig?: string[];
  detailsSafe?: string;
};

type GuardrailResult = {
  allowed: boolean;
  code?: string;
  missingConfig?: string[];
  detailsSafe?: string;
};

type S2PreflightContext = {
  issueExists: boolean;
  repoFullName?: string | null;
  githubIssueNumber?: number | null;
  specReady?: boolean;
  guardrailResult?: GuardrailResult | null;
};

type S3PreflightContext = {
  repoFullName?: string | null;
  githubIssueNumber?: number | null;
  specReady?: boolean;
  triggerConfigMissing?: string[];
  guardrailResult?: GuardrailResult | null;
  authMissingConfig?: string[];
};

const PRECONDITION_STATUS = 409 as const;
const PRECONDITION_PHASE = 'preflight' as const;

function buildDecision(params: {
  code: string;
  blockedBy: 'STATE' | 'POLICY' | 'CONFIG';
  nextAction: string;
  missingConfig?: string[];
  detailsSafe?: string;
}): PreflightDecision {
  return {
    ok: false,
    status: PRECONDITION_STATUS,
    code: params.code,
    blockedBy: params.blockedBy,
    phase: PRECONDITION_PHASE,
    nextAction: params.nextAction,
    missingConfig: params.missingConfig,
    detailsSafe: params.detailsSafe,
  };
}

export function decideS2Preflight(ctx: S2PreflightContext): PreflightDecision | null {
  if (!ctx.issueExists) {
    return null;
  }

  if (!ctx.repoFullName || !ctx.githubIssueNumber) {
    return buildDecision({
      code: 'GITHUB_MIRROR_MISSING',
      blockedBy: 'STATE',
      nextAction: 'Link GitHub issue (S1) or restore mirror metadata',
    });
  }

  if (!ctx.specReady) {
    return buildDecision({
      code: 'SPEC_NOT_READY',
      blockedBy: 'STATE',
      nextAction: 'Complete and save S2 spec',
    });
  }

  if (ctx.guardrailResult && !ctx.guardrailResult.allowed) {
    if (ctx.guardrailResult.code === 'GUARDRAIL_REPO_NOT_ALLOWED') {
      return buildDecision({
        code: 'GUARDRAIL_REPO_NOT_ALLOWED',
        blockedBy: 'POLICY',
        nextAction: 'Allowlist repo for repo-write',
        detailsSafe: ctx.guardrailResult.detailsSafe,
      });
    }

    return buildDecision({
      code: 'GUARDRAIL_CONFIG_MISSING',
      blockedBy: 'CONFIG',
      nextAction: 'Set required config in runtime',
      missingConfig: ctx.guardrailResult.missingConfig,
      detailsSafe: ctx.guardrailResult.detailsSafe,
    });
  }

  return null;
}

export function decideS3Preflight(ctx: S3PreflightContext): PreflightDecision | null {
  if (!ctx.repoFullName || !ctx.githubIssueNumber) {
    return buildDecision({
      code: 'GITHUB_MIRROR_MISSING',
      blockedBy: 'STATE',
      nextAction: 'Link GitHub issue (S1) or restore mirror metadata',
    });
  }

  if (!ctx.specReady) {
    return buildDecision({
      code: 'SPEC_NOT_READY',
      blockedBy: 'STATE',
      nextAction: 'Complete and save S2 spec',
    });
  }

  if (ctx.guardrailResult && !ctx.guardrailResult.allowed) {
    if (ctx.guardrailResult.code === 'GUARDRAIL_REPO_NOT_ALLOWED') {
      return buildDecision({
        code: 'GUARDRAIL_REPO_NOT_ALLOWED',
        blockedBy: 'POLICY',
        nextAction: 'Allowlist repo for repo-write',
        detailsSafe: ctx.guardrailResult.detailsSafe,
      });
    }

    return buildDecision({
      code: 'GUARDRAIL_CONFIG_MISSING',
      blockedBy: 'CONFIG',
      nextAction: 'Set required config in runtime',
      missingConfig: ctx.guardrailResult.missingConfig,
      detailsSafe: ctx.guardrailResult.detailsSafe,
    });
  }

  if (ctx.authMissingConfig && ctx.authMissingConfig.length > 0) {
    return buildDecision({
      code: 'GITHUB_AUTH_MISSING',
      blockedBy: 'CONFIG',
      nextAction: 'Configure GitHub App auth for writes',
      missingConfig: ctx.authMissingConfig,
    });
  }

  if (ctx.triggerConfigMissing && ctx.triggerConfigMissing.length > 0) {
    return buildDecision({
      code: 'IMPLEMENT_TRIGGER_CONFIG_MISSING',
      blockedBy: 'CONFIG',
      nextAction: 'Configure implement trigger label/comment',
      missingConfig: ctx.triggerConfigMissing,
    });
  }

  return null;
}
