# v0.7 Endpoint Inventory

**Date**: 2026-01-06  
**Version**: v0.7.x Audit  
**Total Endpoints**: 137

---

## Overview

This document provides a comprehensive, deterministic inventory of all HTTP API routes in the AFU-9 Control Center. Each endpoint is categorized by concept area, auth policy, and purpose.

**Generation Method**: File system scan of `control-center/app/api/**/ route.ts` files  
**Reproducible**: Yes (via script or manual directory traversal)

---

## Endpoint Categories

### 1. Authentication & Authorization (6 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| POST | /api/auth/login | Public | No | User login (JWT generation) | Auth |
| POST | /api/auth/logout | Required | No | User logout (token invalidation) | Auth |
| POST | /api/auth/refresh | Required | No | Refresh JWT token | Auth |
| POST | /api/auth/forgot-password | Public | No | Initiate password reset | Auth |
| POST | /api/auth/reset-password | Public | No | Complete password reset | Auth |
| GET | /api/whoami | Required | No | Get current user context + admin status | Auth |

**Environment Gating**: None (core auth functions)  
**Admin Policy**: None (AFU9_ADMIN_SUBS checked by /whoami for diagnostics only)

---

### 2. Health & Diagnostics (7 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/health | Public | No | Liveness probe (ECS/ALB health checks) | System |
| GET | /api/ready | Public | No | Readiness probe (dependency checks) | System |
| GET | /api/build-info | Public | No | Build metadata (version, git SHA, build time) | System |
| GET | /api/build-metadata | Public | No | Extended build metadata | System |
| GET | /api/deps/ready | Public | No | Dependency readiness status | System |
| GET | /api/infrastructure/health | Required | No | Infrastructure health status | System |
| GET | /api/system/config | Required | Yes | System configuration (admin-only) | System |
| GET | /api/system/flags-env | Required | Yes | Environment flags (admin-only) | System |

**Environment Gating**: None (health endpoints always enabled)  
**Admin Policy**: /system/* endpoints require AFU9_ADMIN_SUBS

---

### 3. Issues Lifecycle (13 endpoints) [v0.6 + E72]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/issues | Required | No | List all issues | Issues |
| POST | /api/issues | Required | No | Create new issue | Issues |
| GET | /api/issues/:id | Required | No | Get issue details | Issues |
| PUT | /api/issues/:id | Required | No | Update issue | Issues |
| DELETE | /api/issues/:id | Required | No | Delete issue | Issues |
| POST | /api/issues/:id/activate | Required | No | Activate issue (start execution) | Issues |
| GET | /api/issues/:id/events | Required | No | Get issue events/timeline | Issues (E72) |
| POST | /api/issues/:id/execution | Required | No | Trigger issue execution | Issues |
| POST | /api/issues/:id/handoff | Required | No | Handoff issue to agent | Issues |
| GET | /api/issues/:id/runs | Required | No | Get issue execution runs | Issues |
| POST | /api/issues/:id/self-propel | Required | No | Self-propel issue | Issues |
| GET | /api/issues/active-check | Required | No | Check active issues | Issues |
| POST | /api/issues/import | Required | No | Import issues from file | Issues |
| POST | /api/issues/new | Required | No | Create issue (alias) | Issues |
| POST | /api/issues/refresh | Required | No | Refresh issues from GitHub | Issues |
| GET | /api/issues/status | Required | No | Get issues status summary | Issues |
| POST | /api/issues/sync | Required | No | Sync issues with GitHub | Issues |

**Environment Gating**: None  
**Admin Policy**: None

---

### 4. INTENT Console (13 endpoints) [E73, E74, E75]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/intent/sessions | Required | No | List INTENT sessions | INTENT (E73.1) |
| POST | /api/intent/sessions | Required | No | Create new INTENT session | INTENT (E73.1) |
| GET | /api/intent/sessions/:id | Required | No | Get session details | INTENT (E73.1) |
| DELETE | /api/intent/sessions/:id | Required | No | Delete session | INTENT (E73.1) |
| POST | /api/intent/sessions/:id/messages | Required | No | Send message to session | INTENT (E73.1) |
| GET | /api/intent/sessions/:id/messages | Required | No | Get session messages | INTENT (E73.1) |
| GET | /api/intent/sessions/:id/context-pack | Required | No | Get session context pack | INTENT (E73.3) |
| GET | /api/intent/sessions/:id/context-packs | Required | No | List context packs for session | INTENT (E73.4) |
| GET | /api/intent/sessions/:id/cr | Required | No | Get session ChangeRequest | INTENT (E74.3) |
| POST | /api/intent/sessions/:id/cr/validate | Required | No | Validate CR | INTENT (E74.2) |
| GET | /api/intent/sessions/:id/cr/versions | Required | No | Get CR versions | INTENT (E74.4) |
| POST | /api/intent/sessions/:id/cr/commit | Required | No | Commit CR version | INTENT (E74.4) |
| POST | /api/intent/sessions/:id/github-issue | Required | No | Create GitHub issue from CR | INTENT (E75.2) |
| GET | /api/intent/context-packs/:id | Required | No | Get context pack by ID | INTENT (E73.4) |
| GET | /api/intent/context-packs/by-hash/:hash | Required | No | Get context pack by hash | INTENT (E73.4) |
| GET | /api/intent/cr/versions/:versionId | Required | No | Get CR version by ID | INTENT (E74.4) |
| GET | /api/intent/cr/diff | Required | No | Diff between CR versions | INTENT (E74.4) |
| GET | /api/intent/status | Required | No | INTENT console status | INTENT |

**Environment Gating**: None  
**Admin Policy**: None

---

### 5. Lawbook/Guardrails (10 endpoints) [E79]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/lawbook/active | Required | No | Get active lawbook version | Lawbook (E79.1) |
| GET | /api/lawbook/versions | Required | No | List all lawbook versions | Lawbook (E79.1) |
| GET | /api/lawbook/versions/:id | Required | No | Get specific lawbook version | Lawbook (E79.1) |
| POST | /api/lawbook/publish | Required | Yes | Publish new lawbook version | Lawbook (E79.2) |
| POST | /api/lawbook/activate | Required | Yes | Activate lawbook version | Lawbook (E79.2) |
| POST | /api/lawbook/validate | Required | Yes | Validate lawbook content | Lawbook (E79.2) |
| GET | /api/lawbook/diff | Required | No | Diff between lawbook versions | Lawbook (E79.2) |
| GET | /api/lawbook/guardrails | Required | No | Get guardrail gates library | Lawbook (E79.4) |
| GET | /api/lawbook/parameters | Required | No | Get lawbook parameters | Lawbook (E79.1) |
| GET | /api/lawbook/memory | Required | No | Get lawbook memory/history | Lawbook (E79.1) |

**Environment Gating**: None  
**Admin Policy**: POST endpoints (publish/activate/validate) require AFU9_ADMIN_SUBS (fail-closed)

---

### 6. Incidents & Classification (3 endpoints) [E76]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/incidents | Required | No | List all incidents | Incidents (E76.1) |
| GET | /api/incidents/:id | Required | No | Get incident details | Incidents (E76.1) |
| POST | /api/incidents/:id/classify | Required | No | Classify incident (manual override) | Incidents (E76.3) |

**Environment Gating**: None  
**Admin Policy**: None (classification is operational, not admin-only)

---

### 7. Playbooks & Remediation (5 endpoints) [E77]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/playbooks | Required | No | List available playbooks | Playbooks (E77.1) |
| POST | /api/playbooks/post-deploy-verify/run | Required | No | Run post-deploy verify playbook | Playbooks (E77.2) |
| GET | /api/playbooks/runs/:id | Required | No | Get playbook run details | Playbooks (E77.5) |
| GET | /api/remediation/runs/:id/audit | Required | No | Get remediation run audit trail | Remediation (E77.5) |
| GET | /api/remediation/runs/:id/export | Required | No | Export remediation run | Remediation (E77.5) |

**Environment Gating**: None  
**Admin Policy**: None (playbooks are operational tools)

---

### 8. KPIs, Outcomes, Tuning (8 endpoints) [E78]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/kpis | Required | No | Get KPIs | KPIs (E78.1) |
| POST | /api/kpis/recompute | Required | No | Recompute KPIs | KPIs (E78.1) |
| GET | /api/outcomes | Required | No | List outcomes | Outcomes (E78.2) |
| GET | /api/outcomes/:id | Required | No | Get outcome details | Outcomes (E78.2) |
| POST | /api/outcomes/generate | Required | No | Generate outcome/postmortem | Outcomes (E78.2) |
| GET | /api/tuning | Required | No | List tuning suggestions | Tuning (E78.3) |
| POST | /api/tuning/generate | Required | No | Generate tuning suggestions | Tuning (E78.3) |
| GET | /api/ops/dashboard | Required | No | Ops dashboard data | Ops Dashboard (E78.4) |

**Environment Gating**: None  
**Admin Policy**: None

---

### 9. Timeline & Memory (1 endpoint) [E72]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/timeline/chain | Required | No | Get timeline chain for issue | Timeline (E72.4) |

**Environment Gating**: None  
**Admin Policy**: None

---

### 10. GitHub Integrations (10 endpoints) [E71, E72]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| POST | /api/integrations/github/list-tree | Required | No | List repository tree (via GitHub App) | GitHub (E71.2) |
| POST | /api/integrations/github/read-file | Required | No | Read file from repo (via GitHub App) | GitHub (E71.3) |
| POST | /api/integrations/github/search-code | Required | No | Search code in repo (via GitHub App) | GitHub (E71.4) |
| POST | /api/integrations/github/ingest/issue | Required | No | Ingest issue from GitHub | GitHub (E72.2) |
| POST | /api/integrations/github/runner/dispatch | Required | No | Dispatch GitHub Actions runner | GitHub |
| POST | /api/integrations/github/runner/ingest | Required | No | Ingest runner results | GitHub |
| GET | /api/integrations/github/runner/poll | Required | No | Poll runner status | GitHub |
| GET | /api/integrations/github/smoke | Required | No | Smoke test GitHub integration | GitHub |
| GET | /api/integrations/github/status | Required | No | GitHub integration status | GitHub |
| POST | /api/integrations/afu9/ingest/run | Required | No | Ingest AFU-9 run data | AFU-9 (E72.3) |

**Environment Gating**: Requires GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY  
**Admin Policy**: None

---

### 11. Webhooks (4 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| POST | /api/github/webhook | Public | No | GitHub webhook receiver (validated by signature) | Webhooks |
| POST | /api/webhooks/github | Public | No | GitHub webhook receiver (alias) | Webhooks |
| GET | /api/webhooks/events | Required | No | List webhook events | Webhooks |
| GET | /api/webhooks/events/:id | Required | No | Get webhook event details | Webhooks |

**Environment Gating**: None  
**Admin Policy**: None  
**Note**: Webhook endpoints use GitHub signature verification, not JWT auth

---

### 12. Workflows (8 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/workflows | Required | No | List workflows | Workflows |
| GET | /api/workflows/:id | Required | No | Get workflow details | Workflows |
| POST | /api/workflows/:id/trigger | Required | No | Trigger workflow | Workflows |
| GET | /api/workflows/:id/executions | Required | No | Get workflow executions | Workflows |
| POST | /api/workflow/execute | Required | No | Execute workflow | Workflows |
| GET | /api/workflow/executions | Required | No | List workflow executions | Workflows |
| GET | /api/workflow/execution/:id | Required | No | Get workflow execution details | Workflows |
| POST | /api/executions/:id/pause | Required | No | Pause execution | Workflows |
| POST | /api/executions/:id/resume | Required | No | Resume execution | Workflows |
| GET | /api/executions/:id | Required | No | Get execution details | Workflows |
| GET | /api/executions/paused | Required | No | List paused executions | Workflows |

**Environment Gating**: None  
**Admin Policy**: None

---

### 13. Products & Runs (11 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/products | Required | No | List products | Products |
| POST | /api/products | Required | No | Create product | Products |
| GET | /api/products/:id | Required | No | Get product details | Products |
| PUT | /api/products/:id | Required | No | Update product | Products |
| DELETE | /api/products/:id | Required | No | Delete product | Products |
| GET | /api/products/statistics | Required | No | Get product statistics | Products |
| GET | /api/products/templates | Required | No | Get product templates | Products |
| GET | /api/runs/:runId | Required | No | Get run details | Runs |
| POST | /api/runs/:runId/execute | Required | No | Execute run | Runs |
| POST | /api/runs/:runId/rerun | Required | No | Re-run execution | Runs |

**Environment Gating**: None  
**Admin Policy**: None

---

### 14. MCP (Model Context Protocol) (3 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/mcp/health | Required | No | MCP server health check | MCP |
| GET | /api/mcp/config | Required | No | MCP server configuration | MCP |
| POST | /api/mcp/verify | Required | No | Verify MCP server connectivity | MCP |

**Environment Gating**: Requires MCP_SERVER_URL  
**Admin Policy**: None

---

### 15. Deploy Events & Status (3 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/deploy-events | Required | No | List deploy events | Deploy |
| GET | /api/deploy/status | Required | No | Get deploy status | Deploy |
| POST | /api/internal/deploy-events | Internal | No | Internal deploy event ingestion | Deploy |

**Environment Gating**: None  
**Admin Policy**: None  
**Note**: /internal/* endpoints should be firewalled (VPC-only)

---

### 16. Agents (4 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/agents | Required | No | List available agents | Agents |
| GET | /api/agents/:agentType | Required | No | Get agent details | Agents |
| POST | /api/agent/execute | Required | No | Execute agent | Agents |

**Environment Gating**: None  
**Admin Policy**: None

---

### 17. Actions & Prompts (8 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/actions | Required | No | List actions | Actions |
| GET | /api/actions/:id | Required | No | Get action details | Actions |
| GET | /api/actions/:id/versions | Required | No | Get action versions | Actions |
| GET | /api/prompts | Required | No | List prompts | Prompts |
| GET | /api/prompts/:id | Required | No | Get prompt details | Prompts |
| GET | /api/prompts/:id/versions | Required | No | Get prompt versions | Prompts |

**Environment Gating**: None  
**Admin Policy**: None

---

### 18. Repositories (2 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/repositories | Required | No | List repositories | Repositories |
| GET | /api/repositories/:id | Required | No | Get repository details | Repositories |

**Environment Gating**: None  
**Admin Policy**: None

---

### 19. Ops & Migrations (2 endpoints) [E80]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/ops/db/migrations | Required | Yes | List database migrations | Ops (E80.1) |
| POST | /api/ops/db/migrations | Required | Yes | Run database migration | Ops (E80.1) |
| POST | /api/ops/issues/sync | Required | No | Sync issues (ops utility) | Ops |

**Environment Gating**: None  
**Admin Policy**: /migrations requires AFU9_ADMIN_SUBS

---

### 20. Observability (2 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/observability/alarms | Required | No | Get observability alarms | Observability |
| GET | /api/observability/logs | Required | No | Get logs | Observability |

**Environment Gating**: None  
**Admin Policy**: None

---

### 21. Audit (1 endpoint) [E75]

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/audit/cr-github | Required | No | Audit trail for CR→GitHub issue mapping | Audit (E75.4) |

**Environment Gating**: None  
**Admin Policy**: None

---

### 22. Import/Backlog (1 endpoint)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| POST | /api/import/backlog-file | Required | No | Import backlog from file | Import |

**Environment Gating**: None  
**Admin Policy**: None

---

### 23. Metrics (1 endpoint)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/metrics | Required | No | Get metrics | Metrics |

**Environment Gating**: None  
**Admin Policy**: None

---

### 24. v1 API (Cost & KPI) (10 endpoints)

| Method | Path | Auth | Admin | Purpose | Module |
|--------|------|------|-------|---------|--------|
| GET | /api/v1/costs/export | Required | No | Export cost data | Costs |
| GET | /api/v1/costs/factory | Required | No | Get factory costs | Costs |
| GET | /api/v1/costs/products | Required | No | Get product costs | Costs |
| GET | /api/v1/costs/runs | Required | No | Get run costs | Costs |
| GET | /api/v1/factory/status | Required | No | Get factory status | Factory |
| GET | /api/v1/kpi/aggregate | Required | No | Get aggregated KPIs | KPIs |
| GET | /api/v1/kpi/build-determinism | Required | No | Get build determinism KPI | KPIs |
| GET | /api/v1/kpi/factory | Required | No | Get factory KPIs | KPIs |
| GET | /api/v1/kpi/freshness | Required | No | Get freshness KPI | KPIs |
| GET | /api/v1/kpi/history | Required | No | Get KPI history | KPIs |
| GET | /api/v1/kpi/products | Required | No | Get product KPIs | KPIs |

**Environment Gating**: None  
**Admin Policy**: None

---

## Summary Statistics

| Category | Count | Auth Required | Admin-Only |
|----------|-------|---------------|------------|
| Total Endpoints | 137 | 124 (90.5%) | 7 (5.1%) |
| Public Endpoints | 13 | 0 | 0 |
| Auth Required | 124 | 124 | 7 |
| Admin-Only | 7 | 7 | 7 |
| v0.7 New/Updated | 50+ | - | - |

### Admin-Only Endpoints (AFU9_ADMIN_SUBS Required)

1. POST /api/lawbook/publish
2. POST /api/lawbook/activate
3. POST /api/lawbook/validate
4. GET /api/system/config
5. GET /api/system/flags-env
6. GET /api/ops/db/migrations
7. POST /api/ops/db/migrations

### Public Endpoints (No Auth)

1. POST /api/auth/login
2. POST /api/auth/forgot-password
3. POST /api/auth/reset-password
4. GET /api/health
5. GET /api/ready
6. GET /api/build-info
7. GET /api/build-metadata
8. GET /api/deps/ready
9. POST /api/github/webhook
10. POST /api/webhooks/github

### Internal Endpoints (Should be VPC-Only)

1. POST /api/internal/deploy-events

---

## Regeneration Script

To regenerate this inventory deterministically:

```javascript
// scripts/generate-endpoint-inventory.js
const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, '../control-center/app/api');

function findRouteFiles(dir, basePath = '/api') {
  let routes = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const urlPath = path.join(basePath, item.name);
    
    if (item.isDirectory()) {
      if (item.name.startsWith('[') && item.name.endsWith(']')) {
        const param = item.name.slice(1, -1);
        routes = routes.concat(findRouteFiles(fullPath, path.join(basePath, `:${param}`)));
      } else {
        routes = routes.concat(findRouteFiles(fullPath, urlPath));
      }
    } else if (item.name === 'route.ts') {
      routes.push(basePath.replace(/\\/g, '/'));
    }
  }
  
  return routes;
}

const routes = findRouteFiles(appDir).sort();
console.log(JSON.stringify(routes, null, 2));
```

**Run**: `node scripts/generate-endpoint-inventory.js`

---

**Audit Completed By**: GitHub Copilot  
**Report Version**: 1.0  
**Last Updated**: 2026-01-06
