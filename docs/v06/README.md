# AFU-9 v0.6 — Foundation Release Documentation

**Version:** v0.6  
**Status:** COMPLETE  
**Release Date:** 2025-12-30  
**Epic Coverage:** E61, E62, E63, E64, E65

---

## Overview

AFU-9 v0.6 establishes the foundation for autonomous code fabrication through issue lifecycle management, MCP-based debugging, and deployment guardrails. This release delivers the core infrastructure needed for end-to-end autonomous workflow execution.

**Key Achievement:** Complete issue-to-deployment pipeline with monitoring, debugging, and guardrails.

---

## Feature Coverage

### ✅ Epic E61 — Issue Lifecycle, Activation & GitHub Handoff

**Status:** COMPLETE  
**Purpose:** Enable controlled issue activation and GitHub integration

**Features:**
- Issue lifecycle state machine (OPEN → ACTIVATED → IN_PROGRESS → COMPLETED/FAILED)
- Activation semantics with `maxActive=1` enforcement
- GitHub handoff metadata and idempotent operations
- Events ledger for audit trail and state transitions

**Key Files:**
- `control-center/src/lib/issues/state-machine.ts` - State machine implementation
- `database/migrations/xxx_create_issues_events.sql` - Events ledger schema

**How to Use:**
```bash
# Activate an issue (enforces maxActive=1)
POST /api/issues/:id/activate

# View issue lifecycle events
GET /api/issues/:id/events
```

**Known Gaps:**
- Multi-issue activation requires manual queue management
- No auto-deactivation on failure (manual intervention required)

---

### ✅ Epic E62 — Control Center UX: Issue Liste & Detail

**Status:** COMPLETE  
**Purpose:** Provide intuitive UI for issue management

**Features:**
- Issue list with filtering (status, labels, assignee)
- Sorting (created, updated, priority)
- Issue detail view with activity timeline
- Real-time status updates via polling
- Action buttons (Activate, Close, Comment)

**Key Files:**
- `control-center/src/app/issues/page.tsx` - Issue list page
- `control-center/src/app/issues/[id]/page.tsx` - Issue detail page
- `control-center/src/components/issues/IssueList.tsx` - List component

**How to Use:**
1. Navigate to `/issues` in Control Center
2. Filter by status or labels
3. Click issue to view detail and timeline
4. Use action buttons to manage lifecycle

**Known Gaps:**
- Bulk operations not supported
- Advanced search limited to basic filters

---

### ✅ Epic E63 — MCP Server Zero-Copy Debugging MVP

**Status:** COMPLETE  
**Purpose:** Enable debugging workflows through MCP protocol

**Features:**
- Runs ledger database (tables: `runs`, `run_steps`, `run_artifacts`)
- RunSpec/RunResult contract definitions
- Issue UI Runs tab showing execution history
- Start, re-run, view logs, download artifacts
- Zero-copy debugging (direct artifact access)

**Key Files:**
- `database/migrations/xxx_create_runs_ledger.sql` - Runs ledger schema
- `mcp-servers/afu9-runner/src/contracts.ts` - RunSpec/RunResult contracts
- `control-center/src/app/issues/[id]/runs/page.tsx` - Runs tab UI

**How to Use:**
```bash
# Start a debug run
POST /api/issues/:id/runs
{
  "playbookId": "debug-workflow",
  "parameters": {}
}

# View run status
GET /api/runs/:runId

# Download artifacts
GET /api/runs/:runId/artifacts/:artifactId
```

**Known Gaps:**
- Live log streaming not implemented (poll-based only)
- Artifact retention policy not enforced (manual cleanup)
- No run cancellation support

---

### ✅ Epic E64 — Runner Adapter: GitHub Runner Execution

**Status:** COMPLETE  
**Purpose:** Execute workflows on GitHub Actions runners

**Features:**
- GitHub Actions runner adapter
- Workflow dispatch with parameter mapping
- Status polling and result ingestion
- Deploy determinism playbook (E64.2)
- Workflow run artifacts collection

**Key Files:**
- `control-center/src/lib/github-runner/adapter.ts` - Runner adapter
- `control-center/src/lib/github-runner/poller.ts` - Status polling
- `.github/workflows/deploy-determinism-check.yml` - Determinism playbook

**How to Use:**
```bash
# Dispatch workflow to GitHub Actions
POST /api/github/dispatch
{
  "workflow": "deploy-determinism-check.yml",
  "ref": "main",
  "inputs": { "environment": "staging" }
}

# Poll workflow status
GET /api/github/runs/:runId
```

**Known Gaps:**
- No webhook-based status updates (polling only, 30s interval)
- Limited error context on workflow failures
- No support for self-hosted runners

---

### ✅ Epic E65 — Deploy & Operate Guardrails

**Status:** COMPLETE  
**Purpose:** Monitor deployments and enforce operational guardrails

**Features:**
- Deploy status monitor with traffic light system (GREEN/YELLOW/RED)
- Post-deploy verification playbook
- Automated health checks (endpoint, database, metrics)
- Deploy status dashboard in Control Center
- Alert integration (CloudWatch → SNS)

**Key Files:**
- `control-center/src/lib/deploy-status/monitor.ts` - Status monitor
- `.github/workflows/post-deploy-verification.yml` - Verification playbook
- `control-center/src/app/deploy/status/page.tsx` - Status dashboard

**How to Use:**
```bash
# Check current deploy status
GET /api/deploy/status

# Trigger post-deploy verification
POST /api/deploy/verify
{
  "environment": "production",
  "deploymentId": "abc123"
}

# View deploy history
GET /api/deploy/history
```

**Deploy Status Logic:**
- **GREEN:** All health checks pass, no active alerts
- **YELLOW:** Minor issues detected (high latency, degraded performance)
- **RED:** Critical failures (endpoint down, database unreachable)

**Known Gaps:**
- Manual rollback required on RED status (no auto-rollback)
- Limited historical metrics (7-day retention)
- No canary deployment support

---

## How to Run

### Local Development

1. **Prerequisites**
   ```bash
   # Node.js 20.x, npm 10.x
   node --version  # v20.x.x
   npm --version   # 10.x.x
   ```

2. **Install dependencies**
   ```bash
   npm install
   npm --prefix control-center install
   ```

3. **Setup environment**
   ```bash
   cp control-center/.env.local.template control-center/.env.local
   # Edit .env.local:
   # - GITHUB_TOKEN (repo:issues scope)
   # - OPENAI_API_KEY
   # - DATABASE_URL (PostgreSQL)
   ```

4. **Setup database**
   ```bash
   # Run migrations
   cd database
   psql -U postgres -f migrations/001_initial_schema.sql
   psql -U postgres -f migrations/002_runs_ledger.sql
   psql -U postgres -f migrations/003_issue_events.sql
   ```

5. **Start Control Center**
   ```bash
   npm run dev:control-center
   # Access: http://localhost:3000
   ```

### Deployment to AWS

1. **Synthesize CloudFormation**
   ```bash
   npm run synth
   # Output: cdk.out/AFU9ControlStack.template.json
   ```

2. **Deploy infrastructure**
   ```bash
   npm run deploy
   # Creates: VPC, ECS, RDS, ALB, Secrets Manager
   ```

3. **Verify deployment**
   ```bash
   npm run determinism:check
   # Runs E64.2 playbook
   ```

4. **Monitor status**
   ```bash
   # Access deploy dashboard
   # URL: https://<your-domain>/deploy/status
   ```

See [Deployment Guide](../deploy/README.md) for detailed AWS setup.

---

## Known Gaps & Limitations

### Performance
- **Polling overhead:** 30s intervals for GitHub Actions status (webhook improvement planned for v0.7)
- **Database queries:** No query optimization for large issue lists (>1000 issues)
- **Log storage:** Artifacts stored in database (should migrate to S3 in v0.7)

### Functionality
- **Multi-repository:** Only single repository supported
- **Parallel runs:** maxActive=1 limit (no concurrent issue execution)
- **Context packs:** Not implemented (deferred to v0.7)
- **Advanced incident management:** Basic error capture only

### Operational
- **Manual rollback:** No automated rollback on deploy failures
- **Limited retention:** 7-day log/artifact retention (configurable in v0.7)
- **No canary deploys:** Full deployment only

---

## Testing v0.6

### Unit Tests
```bash
npm test
npm --prefix control-center test
```

### Integration Tests
```bash
# Test issue activation
npm run test:integration -- --grep "issue lifecycle"

# Test GitHub runner adapter
npm run test:integration -- --grep "runner adapter"
```

### End-to-End Test
```bash
# Full workflow: Issue → Activation → Run → Deploy → Verify
npm run test:e2e
```

### Manual Testing Checklist

- [ ] Create GitHub issue in target repository
- [ ] Activate issue via Control Center UI
- [ ] Verify issue state transition (OPEN → ACTIVATED)
- [ ] Trigger debug run from Runs tab
- [ ] Monitor run status (poll updates)
- [ ] Download run artifacts
- [ ] Check deploy status monitor (should be GREEN)
- [ ] Trigger post-deploy verification
- [ ] View deploy history

---

## Migration from v0.5

### Database Schema Changes
```sql
-- New tables in v0.6
CREATE TABLE runs (...);
CREATE TABLE run_steps (...);
CREATE TABLE run_artifacts (...);
CREATE TABLE issue_events (...);
```

### API Changes
- **Breaking:** `/api/workflows/execute` → `/api/issues/:id/runs` (new contract)
- **New endpoints:** `/api/deploy/status`, `/api/runs/:id`
- **Deprecated:** `/api/agents/run` (use MCP server instead)

### Configuration Changes
```bash
# New environment variables
MCP_SERVER_URL=http://localhost:3001  # MCP server endpoint
GITHUB_RUNNER_POLL_INTERVAL=30        # Polling interval (seconds)
DEPLOY_STATUS_ENABLED=true            # Enable deploy monitoring
```

---

## Related Documentation

- **[Release Notes](../releases/v0.6/RELEASE.md)** - Canonical v0.6 scope
- **[Architecture](../architecture/README.md)** - System architecture
- **[API Routes](../API_ROUTES.md)** - REST API reference
- **[Glossary](../canon/GLOSSARY.md)** - Terminology reference
- **[v0.6.5 Docs](../v065/README.md)** - Security hardening (next release)

---

## Support

- **Issues:** [GitHub Issues](https://github.com/adaefler-art/codefactory-control/issues)
- **Documentation:** This directory and [docs/](../)
- **Roadmap:** [v0.7 Backlog](../roadmaps/afu9_v0_7_backlog.md)

---

**Maintained by:** AFU-9 Team  
**Last Updated:** 2025-12-30  
**Status:** COMPLETE
