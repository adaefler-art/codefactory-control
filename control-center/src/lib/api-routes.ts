/**
 * AFU-9 Canonical API Route Definitions
 * 
 * This file defines all canonical API routes as TypeScript constants
 * to enforce type-safe route usage and prevent hardcoded strings.
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

  // Webhooks (Canonical)
  webhooks: {
    github: '/api/webhooks/github', // ✅ Canonical
    events: {
      list: '/api/webhooks/events',
      get: (id: string) => `/api/webhooks/events/${id}`,
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
    new: '/api/issues/new',
    import: '/api/issues/import',
    activeCheck: '/api/issues/active-check',
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
  },

  // Deploy Events
  deployEvents: {
    list: '/api/deploy-events',
    create: '/api/deploy-events',
    internal: '/api/internal/deploy-events', // Internal webhook receiver
  },

  // Observability
  observability: {
    logs: '/api/observability/logs',
    alarms: '/api/observability/alarms',
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
    github: {
      status: '/api/integrations/github/status',
    },
  },
} as const;

/**
 * Deprecated routes for backward compatibility tracking.
 * DO NOT USE these routes in new code.
 * 
 * @deprecated These routes will be removed in future versions
 */
export const DEPRECATED_ROUTES = {
  /**
   * @deprecated Use API_ROUTES.webhooks.github instead
   * @removal v0.6
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
