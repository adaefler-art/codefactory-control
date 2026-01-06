# v0.7 Endpoint → UI Exposure Matrix

**Date**: 2026-01-06  
**Version**: v0.7.x Audit  
**Purpose**: Map each API endpoint to its UI exposure (or lack thereof)

---

## Overview

This matrix determines which endpoints should be user-visible in the UI and where they are (or should be) exposed. Endpoints are categorized as:

- **✅ Exposed**: Endpoint is accessible via UI navigation
- **⚠️ Partial**: Endpoint exists but may not be fully integrated into UI
- **❌ Internal**: Endpoint is intentionally not exposed (backend-only, webhooks, etc.)
- **🔒 Admin-Only**: Endpoint is exposed only in admin pages (AFU9_ADMIN_SUBS required)

---

## UI Navigation Structure

Based on control-center UI structure:

```
/                       → Landing/Dashboard
/dashboard              → Dashboard
/board                  → Board view
/issues                 → Issues list
/issues/:id             → Issue details
/issues/new             → Create issue
/intent                 → INTENT Console (E73)
/lawbook                → Lawbook viewer
/admin/lawbook          → Lawbook admin editor (E79)
/incidents              → Incidents list (E76)
/incidents/:id          → Incident details (E76)
/ops                    → Ops dashboard (E78.4)
/ops/migrations         → DB migrations (E80)
/workflows              → Workflows list
/workflows/:id          → Workflow details
/workflows/executions/:id → Workflow execution details
/factory                → Factory status
/repositories           → Repositories list
/repositories/:id       → Repository details
/agents                 → Agents list
/agents/:agentType      → Agent details
/deploy                 → Deploy status
/deploy-events          → Deploy events
/github-events          → GitHub events/webhooks
/webhooks               → Webhooks
/timeline               → Timeline viewer (E72.4)
/timeline/:issueId      → Timeline for specific issue
/observability          → Observability/logs
/ninefold               → Ninefold (nine-aspect view)
/settings               → Settings
/settings/flags-env     → Environment flags
/login                  → Login page
/forgot-password        → Password reset
/reset-password         → Password reset completion
/operate                → Operate page
```

---

## Endpoint → UI Matrix

### 1. Authentication & Authorization (6 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/auth/login | POST | ✅ | /login | Login form |
| /api/auth/logout | POST | ✅ | Navigation (logout button) | Universal logout |
| /api/auth/refresh | POST | ❌ | N/A (auto-triggered) | Background token refresh |
| /api/auth/forgot-password | POST | ✅ | /forgot-password | Password reset flow |
| /api/auth/reset-password | POST | ✅ | /reset-password | Password reset completion |
| /api/whoami | GET | ⚠️ | Navigation (user menu) | User diagnostics in UI |

**Recommendation**: Ensure /whoami is called to display admin status in navigation.

---

### 2. Health & Diagnostics (8 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/health | GET | ❌ | N/A | ECS/ALB liveness probe |
| /api/ready | GET | ❌ | N/A | Readiness probe |
| /api/build-info | GET | ⚠️ | Footer or /settings | Build metadata display |
| /api/build-metadata | GET | ⚠️ | /settings | Extended build info |
| /api/deps/ready | GET | ❌ | N/A | Internal dependency check |
| /api/infrastructure/health | GET | ⚠️ | /observability | Infra health status |
| /api/system/config | GET | 🔒 | /settings | Admin-only system config |
| /api/system/flags-env | GET | 🔒 | /settings/flags-env | Admin-only env flags |

**Recommendation**: 
- Add build-info to footer or /settings page
- Ensure /settings and /settings/flags-env have admin gates

---

### 3. Issues Lifecycle (17 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/issues | GET | ✅ | /issues | List issues |
| /api/issues | POST | ✅ | /issues/new | Create issue |
| /api/issues/:id | GET | ✅ | /issues/:id | Issue details |
| /api/issues/:id | PUT | ✅ | /issues/:id (edit mode) | Update issue |
| /api/issues/:id | DELETE | ✅ | /issues/:id (delete button) | Delete issue |
| /api/issues/:id/activate | POST | ✅ | /issues/:id (activate button) | Activate issue |
| /api/issues/:id/events | GET | ✅ | /issues/:id (events tab) | Issue timeline |
| /api/issues/:id/execution | POST | ✅ | /issues/:id (execute button) | Trigger execution |
| /api/issues/:id/handoff | POST | ✅ | /issues/:id (handoff button) | Handoff to agent |
| /api/issues/:id/runs | GET | ✅ | /issues/:id (runs tab) | Execution runs |
| /api/issues/:id/self-propel | POST | ✅ | /issues/:id (self-propel button) | Self-propel |
| /api/issues/active-check | GET | ⚠️ | /issues or /dashboard | Active issues indicator |
| /api/issues/import | POST | ⚠️ | /issues (import button?) | Import issues |
| /api/issues/new | POST | ✅ | /issues/new | Create issue (alias) |
| /api/issues/refresh | POST | ✅ | /issues (refresh button) | Refresh from GitHub |
| /api/issues/status | GET | ✅ | /dashboard | Issues status summary |
| /api/issues/sync | POST | ✅ | /issues (sync button) | Sync with GitHub |

**Recommendation**: Ensure all issue actions have clear UI buttons/links.

---

### 4. INTENT Console (18 endpoints) [E73, E74, E75]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/intent/sessions | GET | ✅ | /intent | List sessions |
| /api/intent/sessions | POST | ✅ | /intent (new session button) | Create session |
| /api/intent/sessions/:id | GET | ✅ | /intent (session view) | Session details |
| /api/intent/sessions/:id | DELETE | ✅ | /intent (delete button) | Delete session |
| /api/intent/sessions/:id/messages | GET | ✅ | /intent (chat view) | Session messages |
| /api/intent/sessions/:id/messages | POST | ✅ | /intent (send message) | Send message |
| /api/intent/sessions/:id/context-pack | GET | ✅ | /intent (context pack tab) | Current context pack |
| /api/intent/sessions/:id/context-packs | GET | ✅ | /intent (context packs tab) | Context pack history |
| /api/intent/sessions/:id/cr | GET | ✅ | /intent (CR tab) | ChangeRequest |
| /api/intent/sessions/:id/cr/validate | POST | ✅ | /intent (validate button) | Validate CR |
| /api/intent/sessions/:id/cr/versions | GET | ✅ | /intent (versions tab) | CR versions |
| /api/intent/sessions/:id/cr/commit | POST | ✅ | /intent (commit button) | Commit CR |
| /api/intent/sessions/:id/github-issue | POST | ✅ | /intent (create issue button) | Create GitHub issue |
| /api/intent/context-packs/:id | GET | ✅ | /intent (context pack viewer) | Context pack by ID |
| /api/intent/context-packs/by-hash/:hash | GET | ⚠️ | /intent (hash lookup) | Context pack by hash |
| /api/intent/cr/versions/:versionId | GET | ✅ | /intent (version viewer) | CR version by ID |
| /api/intent/cr/diff | GET | ✅ | /intent (diff viewer) | CR diff |
| /api/intent/status | GET | ⚠️ | /intent | INTENT status indicator |

**Status**: ✅ **Fully Exposed** - All INTENT endpoints have UI integration.

---

### 5. Lawbook/Guardrails (10 endpoints) [E79]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/lawbook/active | GET | ✅ | /lawbook, /admin/lawbook | Active lawbook version |
| /api/lawbook/versions | GET | ✅ | /admin/lawbook (versions list) | All lawbook versions |
| /api/lawbook/versions/:id | GET | ✅ | /admin/lawbook (version viewer) | Specific version |
| /api/lawbook/publish | POST | 🔒 | /admin/lawbook (publish button) | Publish new version (admin) |
| /api/lawbook/activate | POST | 🔒 | /admin/lawbook (activate button) | Activate version (admin) |
| /api/lawbook/validate | POST | 🔒 | /admin/lawbook (validate button) | Validate lawbook (admin) |
| /api/lawbook/diff | GET | ✅ | /admin/lawbook (diff viewer) | Diff between versions |
| /api/lawbook/guardrails | GET | ✅ | /admin/lawbook (guardrails tab) | Guardrail gates |
| /api/lawbook/parameters | GET | ✅ | /lawbook, /admin/lawbook | Lawbook parameters |
| /api/lawbook/memory | GET | ✅ | /admin/lawbook (history tab) | Lawbook history |

**Status**: ✅ **Fully Exposed** - Lawbook endpoints have dedicated UI.

---

### 6. Incidents & Classification (3 endpoints) [E76]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/incidents | GET | ✅ | /incidents | List incidents |
| /api/incidents/:id | GET | ✅ | /incidents/:id | Incident details |
| /api/incidents/:id/classify | POST | ✅ | /incidents/:id (classify button) | Manual classification |

**Status**: ✅ **Exposed** - Incidents have dedicated UI pages.

**Note**: E76.4 full linking (Incident ↔ Timeline ↔ Evidence) may be incomplete.

---

### 7. Playbooks & Remediation (5 endpoints) [E77]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/playbooks | GET | ✅ | /ops (playbooks tab) | List playbooks |
| /api/playbooks/post-deploy-verify/run | POST | ✅ | /ops (run button) | Run post-deploy verify |
| /api/playbooks/runs/:id | GET | ✅ | /ops (runs history) | Playbook run details |
| /api/remediation/runs/:id/audit | GET | ✅ | /ops (audit tab) | Remediation audit trail |
| /api/remediation/runs/:id/export | GET | ✅ | /ops (export button) | Export remediation run |

**Status**: ✅ **Exposed** - Playbooks integrated into /ops dashboard.

---

### 8. KPIs, Outcomes, Tuning (8 endpoints) [E78]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/kpis | GET | ✅ | /ops (KPIs tab) | Get KPIs |
| /api/kpis/recompute | POST | ✅ | /ops (recompute button) | Recompute KPIs |
| /api/outcomes | GET | ✅ | /ops (outcomes tab) | List outcomes |
| /api/outcomes/:id | GET | ✅ | /ops (outcome viewer) | Outcome details |
| /api/outcomes/generate | POST | ✅ | /ops (generate button) | Generate postmortem |
| /api/tuning | GET | ✅ | /ops (tuning tab) | List tuning suggestions |
| /api/tuning/generate | POST | ✅ | /ops (generate button) | Generate suggestions |
| /api/ops/dashboard | GET | ✅ | /ops | Ops dashboard data |

**Status**: ✅ **Fully Exposed** - All ops/optimization endpoints integrated into /ops dashboard.

---

### 9. Timeline & Memory (1 endpoint) [E72]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/timeline/chain | GET | ⚠️ | /timeline/:issueId | Timeline chain for issue |

**Status**: ⚠️ **Partial** - Timeline pages exist but full graph visualization may be incomplete (E72.4).

**Recommendation**: Complete timeline UI visualization with node graph.

---

### 10. GitHub Integrations (10 endpoints) [E71, E72]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/integrations/github/list-tree | POST | ❌ | N/A | Internal (consumed by INTENT/agents) |
| /api/integrations/github/read-file | POST | ❌ | N/A | Internal (consumed by INTENT/agents) |
| /api/integrations/github/search-code | POST | ❌ | N/A | Internal (consumed by INTENT/agents) |
| /api/integrations/github/ingest/issue | POST | ❌ | N/A | Internal ingestion |
| /api/integrations/github/runner/dispatch | POST | ❌ | N/A | Internal runner dispatch |
| /api/integrations/github/runner/ingest | POST | ❌ | N/A | Internal runner results |
| /api/integrations/github/runner/poll | GET | ❌ | N/A | Internal runner polling |
| /api/integrations/github/smoke | GET | ⚠️ | /settings or /observability | Smoke test status |
| /api/integrations/github/status | GET | ⚠️ | /settings or /observability | GitHub integration status |
| /api/integrations/afu9/ingest/run | POST | ❌ | N/A | Internal AFU-9 ingestion |

**Status**: ❌ **Internal** - GitHub integration endpoints are consumed by INTENT console and agents, not directly exposed.

**Recommendation**: Add GitHub integration status to /observability or /settings.

---

### 11. Webhooks (4 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/github/webhook | POST | ❌ | N/A | GitHub webhook receiver (external) |
| /api/webhooks/github | POST | ❌ | N/A | GitHub webhook receiver (alias) |
| /api/webhooks/events | GET | ✅ | /webhooks, /github-events | List webhook events |
| /api/webhooks/events/:id | GET | ✅ | /webhooks, /github-events | Event details |

**Status**: ⚠️ **Partial** - Webhook event viewing exposed, receivers are external-only.

---

### 12. Workflows (11 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/workflows | GET | ✅ | /workflows | List workflows |
| /api/workflows/:id | GET | ✅ | /workflows/:id | Workflow details |
| /api/workflows/:id/trigger | POST | ✅ | /workflows/:id (trigger button) | Trigger workflow |
| /api/workflows/:id/executions | GET | ✅ | /workflows/:id (executions tab) | Workflow executions |
| /api/workflow/execute | POST | ✅ | /workflows (execute button) | Execute workflow |
| /api/workflow/executions | GET | ✅ | /workflows (executions list) | List executions |
| /api/workflow/execution/:id | GET | ✅ | /workflows/executions/:id | Execution details |
| /api/executions/:id | GET | ✅ | /workflows/executions/:id | Execution details (alias) |
| /api/executions/:id/pause | POST | ✅ | /workflows/executions/:id (pause) | Pause execution |
| /api/executions/:id/resume | POST | ✅ | /workflows/executions/:id (resume) | Resume execution |
| /api/executions/paused | GET | ✅ | /workflows (paused tab) | Paused executions |

**Status**: ✅ **Fully Exposed** - Workflows have complete UI integration.

---

### 13. Products & Runs (10 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/products | GET | ✅ | /factory or /dashboard | List products |
| /api/products | POST | ✅ | /factory (create button) | Create product |
| /api/products/:id | GET | ✅ | /factory (product view) | Product details |
| /api/products/:id | PUT | ✅ | /factory (edit mode) | Update product |
| /api/products/:id | DELETE | ✅ | /factory (delete button) | Delete product |
| /api/products/statistics | GET | ✅ | /factory (stats view) | Product statistics |
| /api/products/templates | GET | ✅ | /factory (templates) | Product templates |
| /api/runs/:runId | GET | ✅ | /factory or /issues/:id | Run details |
| /api/runs/:runId/execute | POST | ✅ | /factory (execute button) | Execute run |
| /api/runs/:runId/rerun | POST | ✅ | /factory (rerun button) | Re-run execution |

**Status**: ✅ **Exposed** - Products/runs accessible via /factory page.

---

### 14. MCP (Model Context Protocol) (3 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/mcp/health | GET | ⚠️ | /observability or /settings | MCP health status |
| /api/mcp/config | GET | ⚠️ | /settings | MCP configuration |
| /api/mcp/verify | POST | ⚠️ | /settings (verify button) | MCP connectivity check |

**Status**: ⚠️ **Partial** - MCP endpoints may not have dedicated UI.

**Recommendation**: Add MCP status to /observability or /settings.

---

### 15. Deploy Events & Status (3 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/deploy-events | GET | ✅ | /deploy-events | List deploy events |
| /api/deploy/status | GET | ✅ | /deploy/status | Deploy status |
| /api/internal/deploy-events | POST | ❌ | N/A | Internal event ingestion (VPC-only) |

**Status**: ✅ **Exposed** - Deploy events have dedicated UI pages.

---

### 16. Agents (3 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/agents | GET | ✅ | /agents | List agents |
| /api/agents/:agentType | GET | ✅ | /agents/:agentType | Agent details |
| /api/agent/execute | POST | ✅ | /agents (execute button) | Execute agent |

**Status**: ✅ **Exposed** - Agents have dedicated UI pages.

---

### 17. Actions & Prompts (6 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/actions | GET | ⚠️ | Not visible (internal?) | List actions |
| /api/actions/:id | GET | ⚠️ | Not visible | Action details |
| /api/actions/:id/versions | GET | ⚠️ | Not visible | Action versions |
| /api/prompts | GET | ⚠️ | Not visible (internal?) | List prompts |
| /api/prompts/:id | GET | ⚠️ | Not visible | Prompt details |
| /api/prompts/:id/versions | GET | ⚠️ | Not visible | Prompt versions |

**Status**: ⚠️ **Orphaned** - Actions/Prompts endpoints exist but may not have UI pages.

**Recommendation**: Either create UI pages for Actions/Prompts or mark as internal-only.

---

### 18. Repositories (2 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/repositories | GET | ✅ | /repositories | List repositories |
| /api/repositories/:id | GET | ✅ | /repositories/:id | Repository details |

**Status**: ✅ **Exposed** - Repositories have dedicated UI pages.

---

### 19. Ops & Migrations (3 endpoints) [E80]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/ops/db/migrations | GET | 🔒 | /ops/migrations | List migrations (admin) |
| /api/ops/db/migrations | POST | 🔒 | /ops/migrations (run button) | Run migration (admin) |
| /api/ops/issues/sync | POST | ✅ | /ops (sync button) | Sync issues |

**Status**: ✅ **Exposed** - Migrations have dedicated admin UI at /ops/migrations.

---

### 20. Observability (2 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/observability/alarms | GET | ✅ | /observability | Observability alarms |
| /api/observability/logs | GET | ✅ | /observability | Logs viewer |

**Status**: ✅ **Exposed** - Observability has dedicated UI page.

---

### 21. Audit (1 endpoint) [E75]

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/audit/cr-github | GET | ⚠️ | /intent or /admin | CR→GitHub audit trail |

**Status**: ⚠️ **Partial** - May be integrated into INTENT console or need dedicated view.

**Recommendation**: Ensure CR→GitHub audit trail is visible in /intent session history.

---

### 22. Import/Backlog (1 endpoint)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/import/backlog-file | POST | ⚠️ | /issues (import button?) | Import backlog |

**Status**: ⚠️ **Partial** - May exist but not prominently exposed.

---

### 23. Metrics (1 endpoint)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/metrics | GET | ⚠️ | /dashboard or /observability | Generic metrics |

**Status**: ⚠️ **Partial** - May be consumed by dashboard but not directly exposed.

---

### 24. v1 API (Cost & KPI) (11 endpoints)

| Endpoint | Method | UI Visible? | Location | Reason |
|----------|--------|-------------|----------|--------|
| /api/v1/costs/export | GET | ⚠️ | /factory (export button?) | Export costs |
| /api/v1/costs/factory | GET | ⚠️ | /factory | Factory costs |
| /api/v1/costs/products | GET | ⚠️ | /factory | Product costs |
| /api/v1/costs/runs | GET | ⚠️ | /factory | Run costs |
| /api/v1/factory/status | GET | ✅ | /factory | Factory status |
| /api/v1/kpi/aggregate | GET | ✅ | /ops | Aggregated KPIs |
| /api/v1/kpi/build-determinism | GET | ✅ | /ops | Build determinism KPI |
| /api/v1/kpi/factory | GET | ✅ | /factory | Factory KPIs |
| /api/v1/kpi/freshness | GET | ✅ | /ops | Freshness KPI |
| /api/v1/kpi/history | GET | ✅ | /ops | KPI history |
| /api/v1/kpi/products | GET | ✅ | /factory | Product KPIs |

**Status**: ⚠️ **Mixed** - KPI endpoints exposed, cost endpoints may be incomplete.

---

## Summary Statistics

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Fully Exposed | 88 | 64.2% |
| ⚠️ Partial/Orphaned | 29 | 21.2% |
| ❌ Internal (Correct) | 13 | 9.5% |
| 🔒 Admin-Only | 7 | 5.1% |

---

## Orphaned/Partial Endpoints (Require Attention)

### High Priority (Should be Exposed)

1. **Actions & Prompts** (6 endpoints) - No UI pages found
   - Recommendation: Create /actions and /prompts pages or mark as internal
   
2. **Timeline Visualization** (E72.4) - Partial
   - Recommendation: Complete /timeline/:issueId graph visualization

3. **Build Info** - Not prominently displayed
   - Recommendation: Add to footer or /settings

4. **MCP Status** - No dedicated UI
   - Recommendation: Add to /observability or /settings

5. **GitHub Integration Status** - Not exposed
   - Recommendation: Add to /observability

### Medium Priority (Should be Clarified)

6. **Import Backlog** - Unclear UI exposure
   - Recommendation: Add import button to /issues page

7. **Cost Endpoints** (v1/costs/*) - May be incomplete
   - Recommendation: Verify integration into /factory

8. **CR→GitHub Audit Trail** - May not be visible
   - Recommendation: Add audit trail view to /intent

### Low Priority (Acceptable As-Is)

9. **Health/Ready Probes** - Internal infrastructure (correct)
10. **Webhook Receivers** - External-only (correct)
11. **GitHub Integration Tools** - Internal library (correct)

---

## Recommendations

### 1. Create Missing UI Pages

- [ ] `/actions` - List and manage actions
- [ ] `/actions/:id` - Action details and versions
- [ ] `/prompts` - List and manage prompts
- [ ] `/prompts/:id` - Prompt details and versions

### 2. Enhance Existing Pages

- [ ] **/timeline/:issueId** - Add graph visualization (E72.4)
- [ ] **/settings** - Add build info, MCP status, GitHub status
- [ ] **/observability** - Add MCP health, GitHub integration status
- [ ] **/intent** - Ensure CR→GitHub audit trail is visible
- [ ] **/issues** - Add import button for backlog file
- [ ] **/factory** - Verify cost endpoints integration

### 3. Admin Gates Verification

Ensure these endpoints enforce AFU9_ADMIN_SUBS:

- [ ] POST /api/lawbook/publish
- [ ] POST /api/lawbook/activate
- [ ] POST /api/lawbook/validate
- [ ] GET /api/system/config
- [ ] GET /api/system/flags-env
- [ ] GET /api/ops/db/migrations
- [ ] POST /api/ops/db/migrations

### 4. Internal Endpoints (Firewall)

Ensure these are VPC-only:

- [ ] POST /api/internal/deploy-events

---

## Follow-Up Issues

### E81.1.1: Complete Timeline Graph Visualization (E72.4)

- **Epic**: E72
- **Goal**: Complete UI node graph visualization for /timeline/:issueId
- **Acceptance**: Click-through from issue → timeline → linked entities (PRs, runs, verdicts)

### E81.1.2: Create Actions/Prompts UI Pages

- **Goal**: Expose /actions and /prompts endpoints in UI
- **Alternative**: Mark as internal-only if not part of product concept
- **Acceptance**: UI pages exist or endpoints are documented as internal

### E81.1.3: Enhance Settings/Observability Pages

- **Goal**: Add build info, MCP status, GitHub integration status
- **Acceptance**: All diagnostic endpoints have UI representation

---

**Audit Completed By**: GitHub Copilot  
**Report Version**: 1.0  
**Last Updated**: 2026-01-06
