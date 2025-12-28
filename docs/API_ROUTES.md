# AFU-9 API Routes Documentation

**Last Updated:** 2025-12-28  
**Status:** Canonical Reference  
**Issue:** #3 - API Route Canonicalization

## Overview

This document provides a comprehensive list of all API routes in the AFU-9 Control Center. It identifies canonical routes, deprecated aliases, and provides a 1:1 mapping of all client-facing endpoints.

## Route Categories

### Authentication & Authorization

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/auth/login` | GET, POST | **Canonical** | User login endpoint |
| `/api/auth/logout` | POST, GET | **Canonical** | User logout endpoint |
| `/api/auth/refresh` | GET, POST | **Canonical** | Token refresh endpoint |
| `/api/auth/forgot-password` | POST | **Canonical** | Password reset request |
| `/api/auth/reset-password` | POST | **Canonical** | Password reset confirmation |

### Health & Monitoring

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/health` | GET | **Canonical** | Application health check |
| `/api/ready` | GET | **Canonical** | Readiness probe for load balancer |
| `/api/infrastructure/health` | GET | **Canonical** | Infrastructure health status |
| `/api/mcp/health` | GET | **Canonical** | MCP server health check |
| `/api/deps/ready` | GET | **Canonical** | Dependencies readiness check |
| `/api/metrics` | GET | **Canonical** | System metrics endpoint |

**Note:** Each health endpoint serves a different purpose and is not a duplicate.

### Webhooks

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/webhooks/github` | POST | **Canonical** | GitHub webhook handler (primary) |
| `/api/github/webhook` | POST | **DEPRECATED** | GitHub webhook handler (alias) |
| `/api/webhooks/events` | GET | **Canonical** | List webhook events |
| `/api/webhooks/events/[id]` | GET | **Canonical** | Get specific webhook event |

**Migration Notice:**
- ⚠️ `/api/github/webhook` is deprecated. Use `/api/webhooks/github` instead.
- Both routes currently point to the same handler but `/api/github/webhook` will be removed in v0.6.

### Workflows (Persistent)

These routes work with stored workflow definitions in the database.

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/workflows` | GET | **Canonical** | List all workflows |
| `/api/workflows/[id]` | GET | **Canonical** | Get workflow details |
| `/api/workflows/[id]/executions` | GET | **Canonical** | Get workflow execution history |
| `/api/workflows/[id]/trigger` | POST | **Canonical** | Trigger workflow execution |

### Workflow Execution (Ad-hoc)

These routes handle direct workflow execution without persisting definitions.

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/workflow/execute` | POST | **Canonical** | Execute workflow with inline definition |
| `/api/workflow/executions` | GET | **Canonical** | List recent executions |
| `/api/workflow/execution/[id]` | GET | **Canonical** | Get execution status |

**Note:** `/api/workflow/*` (singular) and `/api/workflows/*` (plural) serve different purposes:
- **`/api/workflows/*`** - Persistent workflows stored in DB
- **`/api/workflow/*`** - Ad-hoc workflow execution

These are **NOT** duplicates.

### Executions Management

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/executions/[id]` | GET | **Canonical** | Get execution details |
| `/api/executions/[id]/pause` | POST | **Canonical** | Pause workflow execution |
| `/api/executions/[id]/resume` | POST | **Canonical** | Resume paused execution |
| `/api/executions/paused` | GET | **Canonical** | List paused executions |

### AFU-9 Issues

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/issues` | GET, POST | **Canonical** | List/create AFU-9 issues |
| `/api/issues/new` | GET, PATCH | **Canonical** | New issue form data |
| `/api/issues/import` | POST | **Canonical** | Bulk import issues |
| `/api/issues/active-check` | GET | **Canonical** | Check for active issue |
| `/api/issues/[id]` | GET, PATCH, DELETE | **Canonical** | Issue CRUD operations |
| `/api/issues/[id]/activate` | POST | **Canonical** | Activate issue (set as ACTIVE) |
| `/api/issues/[id]/handoff` | POST | **Canonical** | Handoff issue to GitHub |
| `/api/issues/[id]/self-propel` | POST | **Canonical** | Trigger self-propelling workflow |
| `/api/issues/[id]/execution` | GET | **Canonical** | Get issue execution details |
| `/api/issues/[id]/events` | GET | **Canonical** | Get issue event history |

### Products

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/products` | GET, POST | **Canonical** | List/create products |
| `/api/products/[id]` | GET, PUT, DELETE | **Canonical** | Product CRUD operations |
| `/api/products/statistics` | GET | **Canonical** | Product statistics |
| `/api/products/templates` | GET | **Canonical** | Product templates |

### Repositories

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/repositories` | GET, POST | **Canonical** | List/create repositories |
| `/api/repositories/[id]` | GET, DELETE, PATCH | **Canonical** | Repository CRUD operations |

### Prompts Library

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/prompts` | GET, POST | **Canonical** | List/create prompts |
| `/api/prompts/[id]` | GET, PATCH | **Canonical** | Prompt CRUD operations |
| `/api/prompts/[id]/versions` | GET, POST | **Canonical** | Prompt version management |

### Actions Library

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/actions` | GET, POST | **Canonical** | List/create actions |
| `/api/actions/[id]` | GET, PATCH | **Canonical** | Action CRUD operations |
| `/api/actions/[id]/versions` | GET, POST | **Canonical** | Action version management |

### Agents

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/agents` | GET | **Canonical** | List available agents |
| `/api/agents/[agentType]` | GET | **Canonical** | Get specific agent details |
| `/api/agent/execute` | POST | **Canonical** | Execute agent task |

### Lawbook (Governance)

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/lawbook/guardrails` | GET | **Canonical** | Get guardrail definitions |
| `/api/lawbook/memory` | GET | **Canonical** | Get lawbook memory entries |
| `/api/lawbook/parameters` | GET | **Canonical** | Get lawbook parameters |

### Deploy Events

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/deploy-events` | GET, POST | **Canonical** | Public deploy events endpoint |
| `/api/internal/deploy-events` | POST | **Canonical** | Internal deploy events webhook |

**Note:** Both endpoints are canonical but serve different purposes:
- **`/api/deploy-events`** - Public API for UI/external consumers
- **`/api/internal/deploy-events`** - Internal webhook receiver (requires auth bypass)

These are **NOT** duplicates.

### Observability

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/observability/logs` | GET | **Canonical** | Query application logs |
| `/api/observability/alarms` | GET | **Canonical** | Get alarm status |

### KPIs (v1 API)

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/v1/kpi/aggregate` | GET | **Canonical** | Aggregated KPI data |
| `/api/v1/kpi/history` | GET, POST | **Canonical** | KPI historical data |
| `/api/v1/kpi/factory` | GET, POST, PUT, DELETE | **Canonical** | Factory KPIs |
| `/api/v1/kpi/freshness` | GET, POST | **Canonical** | Data freshness KPIs |
| `/api/v1/kpi/products` | GET, POST | **Canonical** | Product-specific KPIs |
| `/api/v1/kpi/build-determinism` | GET | **Canonical** | Build determinism metrics |

### Cost Attribution (v1 API)

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/v1/costs/factory` | GET | **Canonical** | Factory-wide cost data |
| `/api/v1/costs/products` | GET | **Canonical** | Per-product cost breakdown |
| `/api/v1/costs/runs` | GET | **Canonical** | Per-run cost data |
| `/api/v1/costs/export` | GET | **Canonical** | Export cost data (CSV/JSON) |

### Factory Status (v1 API)

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/v1/factory/status` | GET, POST, PUT, DELETE, PATCH | **Canonical** | Factory status operations |

### System

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/system/config` | GET | **Canonical** | System configuration |
| `/api/build-info` | GET | **Canonical** | Build information |
| `/api/build-metadata` | GET | **Canonical** | Build metadata |

### Import

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/import/backlog-file` | POST | **Canonical** | Import backlog from file |

### Integrations

| Route | Methods | Status | Description |
|-------|---------|--------|-------------|
| `/api/integrations/github/status` | GET | **Canonical** | GitHub integration status |

## Route Naming Conventions

### Established Patterns

1. **RESTful Resource Naming**
   - Collections: `/api/issues`, `/api/workflows`, `/api/products`
   - Single resource: `/api/issues/[id]`, `/api/workflows/[id]`
   - Actions on resources: `/api/issues/[id]/activate`, `/api/workflows/[id]/trigger`

2. **Versioned APIs**
   - V1 APIs use `/api/v1/*` prefix
   - Examples: `/api/v1/kpi/*`, `/api/v1/costs/*`

3. **Namespaced Routes**
   - Auth: `/api/auth/*`
   - Webhooks: `/api/webhooks/*`
   - Internal: `/api/internal/*`
   - System: `/api/system/*`
   - Observability: `/api/observability/*`

4. **Singular vs Plural**
   - **Plural** for collections and persistent resources: `/api/workflows`
   - **Singular** for singletons or non-persistent operations: `/api/workflow/execute`

## Deprecated Routes

### Immediate Deprecation (v0.5)

| Deprecated Route | Canonical Alternative | Removal Target |
|-----------------|----------------------|----------------|
| `/api/github/webhook` | `/api/webhooks/github` | v0.6 |

### Migration Guide

#### Webhook Route Migration

**Before:**
```typescript
// Old code using deprecated route
await fetch('/api/github/webhook', {
  method: 'POST',
  headers: { 'X-GitHub-Event': 'push' },
  body: JSON.stringify(payload)
});
```

**After:**
```typescript
// New code using canonical route
await fetch('/api/webhooks/github', {
  method: 'POST',
  headers: { 'X-GitHub-Event': 'push' },
  body: JSON.stringify(payload)
});
```

## Client Usage Contract

### Requirements

1. **1:1 Mapping**: Each client action MUST map to exactly one API route
2. **No Aliases**: Clients MUST NOT use deprecated routes
3. **Version Awareness**: Versioned APIs (`/api/v1/*`) MUST include version in all calls
4. **Explicit Paths**: No dynamic route construction that could bypass canonical routes

### Verification

All client-side API calls can be verified using:

```bash
# Check for deprecated routes in client code
grep -r "/api/github/webhook" control-center/app
grep -r "/api/github/webhook" control-center/src

# Should return no results (except in this documentation)
```

## Implementation Notes

### Route Handler Organization

- Each route is implemented in `control-center/app/api/**route.ts`
- Route structure follows Next.js App Router conventions
- Dynamic segments use `[paramName]` syntax

### Middleware & Authentication

- Public routes are defined in `control-center/lib/auth/middleware-public-routes.ts`
- All routes except public routes require authentication
- Rate limiting applied per route category

### Testing

- Route tests located in `control-center/__tests__/api/**`
- Each canonical route MUST have integration tests
- Deprecated routes SHOULD have migration tests

## Compliance Checklist

- [x] All API routes documented
- [x] Deprecated aliases identified
- [ ] Client code updated to use canonical routes only
- [ ] Tests verify no usage of deprecated routes
- [ ] Documentation is current and complete
- [ ] Migration guide provided for deprecated routes

## Related Documents

- [AFU-9 Issues API](./AFU9-ISSUES-API.md) - Detailed AFU-9 Issues API reference
- [API Boundary Normalization](./architecture/API_BOUNDARY_NORMALIZATION.md) - Output contract safety patterns
- [KPI API](./v04/KPI_API.md) - KPI endpoints specification
- [Factory Status API](./v04/FACTORY_STATUS_API.md) - Factory status endpoints

## Maintenance

This document MUST be updated when:
1. New API routes are added
2. Existing routes are deprecated
3. Route patterns or conventions change
4. Breaking changes are introduced

**Responsibility:** All PRs adding/modifying API routes MUST update this document.
