/**
 * AFU-9 Canonical API Route Definitions
 * 
 * This file defines all canonical API routes as TypeScript constants
 * to enforce type-safe route usage and prevent hardcoded strings.
 *
 * Registry contract (keep in sync with control-center/app/api):
 * - Add every new API route here if it is called indirectly or dynamically.
 * - repo:verify treats registry entries as intended references.
 * - If a route is removed or moved, update this registry or cleanup report will flag it.
 * - The goal is explicit, audited intent for the API surface.
 * 
 * Usage:
 * ```typescript
 * import { API_ROUTES } from '@/lib/api-routes';
 * 
 * // ✅ Good: Type-safe, canonical route
 * const response = await fetch(API_ROUTES.issues.list);
 * 
 * // ❌ Bad: Hardcoded string, no type safety
 * const response = await fetch('/api/issues');
 * ```
 * 
 * @see docs/API_ROUTES.md for complete API documentation
 */

/**
 * Canonical API Routes
 * 
 * All routes in this object are the official, canonical endpoints.
 * Do not use deprecated aliases or hardcoded strings.
 */
export const API_ROUTES = {
  // Authentication & Authorization
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
    forgotPassword: '/api/auth/forgot-password',
    resetPassword: '/api/auth/reset-password',
  },

  // Health & Monitoring
  health: {
    app: '/api/health',
    ready: '/api/ready',
    infrastructure: '/api/infrastructure/health',
    mcp: '/api/mcp/health',
    deps: '/api/deps/ready',
  },

  // MCP
  mcp: {
    config: '/api/mcp/config',
    verify: '/api/mcp/verify',
  },

  // Diagnostics
  diagnostics: {
    smokeKey: {
      allowlist: '/api/diagnostics/smoke-key/allowlist',
      seedAllowlist: '/api/diagnostics/smoke-key/allowlist/seed',
    },
  },

  // Webhooks (Canonical)
  webhooks: {
    github: '/api/webhooks/github', // ✅ Canonical
    events: {
      list: '/api/webhooks/events',
      get: (id: string) => `/api/webhooks/events/${id}`,
    },
  },

  // GitHub (server routes)
  github: {
    status: {
      sync: '/api/github/status/sync',
    },
    issues: {
      assignCopilot: (issueNumber: string) => `/api/github/issues/${issueNumber}/assign-copilot`,
    },
    prs: {
      checks: {
        prompt: (prNumber: string) => `/api/github/prs/${prNumber}/checks/prompt`,
        rerun: (prNumber: string) => `/api/github/prs/${prNumber}/checks/rerun`,
        stopDecision: (prNumber: string) => `/api/github/prs/${prNumber}/checks/stop-decision`,
        triage: (prNumber: string) => `/api/github/prs/${prNumber}/checks/triage`,
      },
      collectSummary: (prNumber: string) => `/api/github/prs/${prNumber}/collect-summary`,
      merge: (prNumber: string) => `/api/github/prs/${prNumber}/merge`,
      requestReviewAndWait: (prNumber: string) => `/api/github/prs/${prNumber}/request-review-and-wait`,
    },
  },

  // Workflows (Persistent - stored in DB)
  workflows: {
    list: '/api/workflows',
    get: (id: string) => `/api/workflows/${id}`,
    executions: (id: string) => `/api/workflows/${id}/executions`,
    trigger: (id: string) => `/api/workflows/${id}/trigger`,
  },

  // Workflow Execution (Ad-hoc - not stored)
  workflow: {
    execute: '/api/workflow/execute',
    executions: '/api/workflow/executions',
    execution: (id: string) => `/api/workflow/execution/${id}`,
  },

  // Executions Management
  executions: {
    get: (id: string) => `/api/executions/${id}`,
    pause: (id: string) => `/api/executions/${id}/pause`,
    resume: (id: string) => `/api/executions/${id}/resume`,
    paused: '/api/executions/paused',
  },

  // Approvals
  approvals: {
    list: '/api/approvals',
  },

  // Audit
  audit: {
    crGithub: '/api/audit/cr-github',
  },

  // Automation
  automation: {
    policy: {
      evaluate: '/api/automation/policy/evaluate',
    },
  },

  // AFU-9 Issues
  issues: {
    list: '/api/issues',
    create: '/api/issues',
    get: (id: string) => `/api/issues/${id}`,
    update: (id: string) => `/api/issues/${id}`,
    delete: (id: string) => `/api/issues/${id}`,
    activate: (id: string) => `/api/issues/${id}/activate`,
    handoff: (id: string) => `/api/issues/${id}/handoff`,
    selfPropel: (id: string) => `/api/issues/${id}/self-propel`,
    execution: (id: string) => `/api/issues/${id}/execution`,
    events: (id: string) => `/api/issues/${id}/events`,
    runs: (id: string) => `/api/issues/${id}/runs`,
    stateFlow: (id: string) => `/api/issues/${id}/state-flow`,
    new: '/api/issues/new',
    import: '/api/issues/import',
    activeCheck: '/api/issues/active-check',
  },

  // Loop
  loop: {
    issues: {
      events: (issueId: string) => `/api/loop/issues/${issueId}/events`,
      runNextStep: (issueId: string) => `/api/loop/issues/${issueId}/run-next-step`,
    },
  },

  // AFU-9 Runs (I201.x series) and S1-S3 Flow
  afu9: {
    github: {
      issues: '/api/afu9/github/issues',
    },
    issues: {
      list: '/api/afu9/issues',
      get: (id: string) => `/api/afu9/issues/${id}`,
      merge: (id: string) => `/api/afu9/issues/${id}/merge`,
      verdict: (id: string) => `/api/afu9/issues/${id}/verdict`,
    },
    runs: {
      start: (issueId: string) => `/api/afu9/issues/${issueId}/runs/start`,
      evidenceRefresh: (runId: string) => `/api/afu9/runs/${runId}/evidence/refresh`,
      verify: (runId: string) => `/api/afu9/runs/${runId}/verify`,
    },
    s1s3: {
      // E9.2-CONTROL-01: Canonical S1 Pick Endpoint
      pick: '/api/afu9/s1s3/issues/pick',
      issues: {
        list: '/api/afu9/s1s3/issues',
        implement: (id: string) => `/api/afu9/s1s3/issues/${id}/implement`,
        spec: (id: string) => `/api/afu9/s1s3/issues/${id}/spec`,
      },
      prs: {
        checks: (prNumber: string) => `/api/afu9/s1s3/prs/${prNumber}/checks`,
      },
    },
    timeline: '/api/afu9/timeline',
  },

  // Control (AFU-9)
  control: {
    afu9: {
      s1: {
        issues: {
          spec: (issueId: string) => `/api/control/afu9/s1/issues/${issueId}/spec`,
        },
      },
      s1s3: {
        issues: {
          spec: (id: string) => `/api/control/afu9/s1s3/issues/${id}/spec`,
        },
      },
    },
  },

  // Incidents
  incidents: {
    list: '/api/incidents',
    get: (id: string) => `/api/incidents/${id}`,
    classify: (id: string) => `/api/incidents/${id}/classify`,
  },

  // Ops Dashboard (E78.4, E80.1, E86.3, E88.2, E89.8)
  ops: {
    dashboard: '/api/ops/dashboard',
    kpis: '/api/ops/kpis', // E88.2: Automation KPI Dashboard
    migrations: '/api/ops/db/migrations',
    readiness: '/api/ops/readiness',
    whoami: '/api/whoami',
    capabilities: {
      manifest: '/api/ops/capabilities/manifest', // E89.8: Capabilities Registry
      probe: '/api/ops/capabilities/probe', // E89.8: Trigger health probe (staging-only)
    },
    db: {
      issues: {
        previewSetDone: '/api/ops/db/issues/preview-set-done',
        setDone: '/api/ops/db/issues/set-done',
      },
      migrationParity: '/api/ops/db/migration-parity',
    },
    issues: {
      sync: '/api/ops/issues/sync',
    },
    reports: {
      weekly: '/api/ops/reports/weekly',
    },
  },

  // KPIs
  kpis: {
    list: '/api/kpis',
    recompute: '/api/kpis/recompute',
  },

  // Admin (staging-only where noted)
  admin: {
    costControl: {
      settings: (env: string) => `/api/admin/cost-control/settings?env=${env}`,
      status: (env: string) => `/api/admin/cost-control/status?env=${env}`,
      settingsPatch: '/api/admin/cost-control/settings',
    },
    tools: {
      catalog: '/api/admin/tools/catalog',
    },
    runbooks: {
      list: '/api/admin/runbooks',
      get: (slug: string) => `/api/admin/runbooks/${slug}`,
    },
    activity: '/api/admin/activity',
    diagnoseMirrorStatus: '/api/admin/diagnose-mirror-status',
    smokeKey: {
      allowlist: '/api/admin/smoke-key/allowlist',
    },
  },

  // Drift
  drift: {
    applySuggestion: '/api/drift/apply-suggestion',
    audit: (issueId: string) => `/api/drift/audit/${issueId}`,
    detect: (issueId: string) => `/api/drift/detect/${issueId}`,
  },

  // Playbooks
  playbooks: {
    list: '/api/playbooks',
    runs: {
      get: (id: string) => `/api/playbooks/runs/${id}`,
    },
    postDeployVerify: {
      run: (env: string) => `/api/playbooks/post-deploy-verify/run?env=${env}`,
    },
  },

  // Runs
  runs: {
    get: (runId: string) => `/api/runs/${runId}`,
    execute: (runId: string) => `/api/runs/${runId}/execute`,
    rerun: (runId: string) => `/api/runs/${runId}/rerun`,
  },

  // Products
  products: {
    list: '/api/products',
    create: '/api/products',
    get: (id: string) => `/api/products/${id}`,
    update: (id: string) => `/api/products/${id}`,
    delete: (id: string) => `/api/products/${id}`,
    statistics: '/api/products/statistics',
    templates: '/api/products/templates',
  },

  // Repositories
  repositories: {
    list: '/api/repositories',
    create: '/api/repositories',
    get: (id: string) => `/api/repositories/${id}`,
    update: (id: string) => `/api/repositories/${id}`,
    delete: (id: string) => `/api/repositories/${id}`,
  },

  // Prompts Library
  prompts: {
    list: '/api/prompts',
    create: '/api/prompts',
    get: (id: string) => `/api/prompts/${id}`,
    update: (id: string) => `/api/prompts/${id}`,
    versions: {
      list: (id: string) => `/api/prompts/${id}/versions`,
      create: (id: string) => `/api/prompts/${id}/versions`,
    },
  },

  // Actions Library
  actions: {
    list: '/api/actions',
    create: '/api/actions',
    get: (id: string) => `/api/actions/${id}`,
    update: (id: string) => `/api/actions/${id}`,
    versions: {
      list: (id: string) => `/api/actions/${id}/versions`,
      create: (id: string) => `/api/actions/${id}/versions`,
    },
  },

  // Agents
  agents: {
    list: '/api/agents',
    get: (agentType: string) => `/api/agents/${agentType}`,
    execute: '/api/agent/execute',
  },

  // Lawbook (Governance)
  lawbook: {
    guardrails: '/api/lawbook/guardrails',
    memory: '/api/lawbook/memory',
    parameters: '/api/lawbook/parameters',
    versions: {
      list: (limit: number = 100) => `/api/lawbook/versions?limit=${limit}`,
      get: (versionId: string) => `/api/lawbook/versions/${versionId}`,
    },
    active: '/api/lawbook/active',
    validate: '/api/lawbook/validate',
    publish: '/api/lawbook/publish',
    activate: '/api/lawbook/activate',
    diff: '/api/lawbook/diff',
  },

  // Deploy Events & Status
  deployEvents: {
    list: '/api/deploy-events',
    create: '/api/deploy-events',
    internal: '/api/internal/deploy-events', // Internal webhook receiver
  },

  // Deploy Status Monitor
  deploy: {
    status: (env: string, force?: boolean) => {
      const queryParams = force ? `?env=${env}&force=true` : `?env=${env}`;
      return `/api/deploy/status${queryParams}`;
    },
  },

  // Observability
  observability: {
    logs: '/api/observability/logs',
    alarms: '/api/observability/alarms',
  },

  // Outcomes
  outcomes: {
    list: '/api/outcomes',
    get: (id: string) => `/api/outcomes/${id}`,
    generate: '/api/outcomes/generate',
  },

  // Remediation
  remediation: {
    runs: {
      audit: (id: string) => `/api/remediation/runs/${id}/audit`,
      export: (id: string) => `/api/remediation/runs/${id}/export`,
    },
  },

  // Touchpoints
  touchpoints: {
    list: '/api/touchpoints',
  },

  // Tuning
  tuning: {
    list: '/api/tuning',
    generate: '/api/tuning/generate',
  },

  // Versioned APIs - v1
  v1: {
    kpi: {
      aggregate: '/api/v1/kpi/aggregate',
      history: '/api/v1/kpi/history',
      factory: '/api/v1/kpi/factory',
      freshness: '/api/v1/kpi/freshness',
      products: '/api/v1/kpi/products',
      buildDeterminism: '/api/v1/kpi/build-determinism',
    },
    costs: {
      factory: '/api/v1/costs/factory',
      products: '/api/v1/costs/products',
      runs: '/api/v1/costs/runs',
      export: '/api/v1/costs/export',
    },
    factory: {
      status: '/api/v1/factory/status',
    },
  },

  // System
  system: {
    config: '/api/system/config',
    flagsEnv: '/api/system/flags-env',
    buildInfo: '/api/build-info',
    buildMetadata: '/api/build-metadata',
    metrics: '/api/metrics',
  },

  // Import
  import: {
    backlogFile: '/api/import/backlog-file',
  },

  // Integrations
  integrations: {
    afu9: {
      ingest: {
        run: '/api/integrations/afu9/ingest/run',
      },
    },
    github: {
      status: '/api/integrations/github/status',
      ingest: {
        issue: '/api/integrations/github/ingest/issue',
      },
      listTree: '/api/integrations/github/list-tree',
      readFile: '/api/integrations/github/read-file',
      runner: {
        dispatch: '/api/integrations/github/runner/dispatch',
        ingest: '/api/integrations/github/runner/ingest',
        poll: '/api/integrations/github/runner/poll',
      },
      searchCode: '/api/integrations/github/search-code',
      smoke: '/api/integrations/github/smoke',
    },
  },

  // Timeline (E72.4)
  timeline: {
    chain: (issueId: string, sourceSystem?: 'github' | 'afu9') => {
      const params = new URLSearchParams({ issueId });
      if (sourceSystem) {
        params.set('sourceSystem', sourceSystem);
      }
      return `/api/timeline/chain?${params.toString()}`;
    },
    unified: '/api/timeline/unified',
  },

  // INTENT Console (E73.1, E73.3, E73.4, E74.3, E81.2, E81.3, E89.5, E89.7, V09-I01, V09-I04)
  intent: {
    status: '/api/intent/status',
    capabilities: '/api/intent/capabilities',
    sessions: {
      list: '/api/intent/sessions',
      create: '/api/intent/sessions',
      get: (id: string) => `/api/intent/sessions/${id}`,
      mode: (id: string) => `/api/intent/sessions/${id}/mode`, // V09-I01
      workPlan: (id: string) => `/api/intent/sessions/${id}/work-plan`, // V09-I04
      compilePlanToDraft: (id: string) => `/api/intent/sessions/${id}/work-plan/compile-to-draft`, // V09-I05
      sources: (id: string) => `/api/intent/sessions/${id}/sources`, // E89.5
      contextPack: (id: string) => `/api/intent/sessions/${id}/context-pack`,
      contextPacks: (id: string) => `/api/intent/sessions/${id}/context-packs`,
      publishBatches: (id: string) => `/api/intent/sessions/${id}/publish-batches`, // E89.7
      crCommit: (id: string) => `/api/intent/sessions/${id}/cr/commit`,
      crVersions: (id: string) => `/api/intent/sessions/${id}/cr/versions`,
      githubIssue: (id: string) => `/api/intent/sessions/${id}/github-issue`,
      issueSet: {
        list: (id: string) => `/api/intent/sessions/${id}/issue-set`,
        generate: (id: string) => `/api/intent/sessions/${id}/issue-set/generate`,
        commit: (id: string) => `/api/intent/sessions/${id}/issue-set/commit`,
        publishExecute: (id: string) => `/api/intent/sessions/${id}/issue-set/publish/execute`,
      },
      uploads: (id: string) => `/api/intent/sessions/${id}/uploads`,
      upload: (id: string, uploadId: string) => `/api/intent/sessions/${id}/uploads/${uploadId}`,
    },
    messages: {
      create: (sessionId: string) => `/api/intent/sessions/${sessionId}/messages`,
    },
    contextPacks: {
      get: (id: string) => `/api/intent/context-packs/${id}`,
      byHash: (hash: string) => `/api/intent/context-packs/by-hash/${hash}`,
    },
    cr: {
      get: (sessionId: string) => `/api/intent/sessions/${sessionId}/cr`,
      save: (sessionId: string) => `/api/intent/sessions/${sessionId}/cr`,
      validate: (sessionId: string) => `/api/intent/sessions/${sessionId}/cr/validate`,
      diff: '/api/intent/cr/diff',
      versions: {
        get: (versionId: string) => `/api/intent/cr/versions/${versionId}`,
      },
    },
    // Issue Draft routes (E81.2, E81.3, I907)
    issueDraft: {
      get: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft`,
      save: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft`,
      validate: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft/validate`,
      commit: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft/commit`,
      versions: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft/versions`,
      publish: (sessionId: string) => `/api/intent/sessions/${sessionId}/issue-draft/versions/publish`, // I907
      preview: '/api/intent/issue-draft/preview',
    },
    issues: {
      create: (sessionId: string) => `/api/intent/sessions/${sessionId}/issues/create`,
      bindCr: (id: string) => `/api/intent/issues/${id}/bind-cr`,
      evidence: (id: string) => `/api/intent/issues/${id}/evidence`,
      publish: (id: string) => `/api/intent/issues/${id}/publish`,
      timeline: (id: string) => `/api/intent/issues/${id}/timeline`,
    },
  },
} as const;

/**
 * Deprecated route aliases.
 *
 * These are kept for backward compatibility tracking only.
 * The GitHub webhook endpoint is deactivated; do not use this in new code.
 */
export const DEPRECATED_ROUTES = {
  /**
   * @deprecated Use API_ROUTES.webhooks.github instead
   */
  githubWebhook: '/api/github/webhook',
} as const;

/**
 * Type helper to ensure route parameters are correctly typed
 */
export type RouteBuilder = (id: string) => string;

/**
 * Utility function to build query strings
 */
export function buildQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      searchParams.append(key, String(value));
    }
  });
  
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

/**
 * Maximum length for error message response body to prevent overly long error messages
 */
const ERROR_BODY_MAX_LENGTH = 200;

/**
 * Type-safe fetch wrapper that enforces canonical routes
 * 
 * Note: While this function accepts any string for flexibility with dynamic routes,
 * it's strongly recommended to only use values from API_ROUTES to ensure canonical
 * route usage. For stricter type safety, consider creating a union type of all
 * possible route values in future versions.
 * 
 * @example
 * ```typescript
 * const issues = await apiFetch(API_ROUTES.issues.list);
 * const issue = await apiFetch(API_ROUTES.issues.get('123'));
 * ```
 */
export async function apiFetch<T = unknown>(
  route: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(route, {
    ...options,
    credentials: options?.credentials ?? 'include',
  });

  if (!response.ok) {
    let errorDetails = response.statusText || 'Unknown error';
    
    // Try to get more detailed error info from response body
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorDetails = errorBody.length > ERROR_BODY_MAX_LENGTH
          ? errorBody.substring(0, ERROR_BODY_MAX_LENGTH) + '...' 
          : errorBody;
      }
    } catch {
      // If we can't read the body, use statusText
    }

    throw new Error(
      `API request to ${route} failed: ${response.status} ${errorDetails}`
    );
  }

  return response.json();
}
