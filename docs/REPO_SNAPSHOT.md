### 1. Repo Identity
- Repository name: codefactory-control (control-center app)
- Primary purpose: Next.js-based web interface and API layer for the AFU-9 Control Center, providing UI pages and server-side routes for workflows, issues, observability, and integrations.
- Intended role in the overall Codefactory system: Central control UI + API gateway for AFU-9 operations (issues, workflows, monitoring, integrations), as described in the control-center README.

---

### 2. Runtime & Deployment
- Runtime type: Next.js 16 (App Router) on Node.js 20 with React 19; server-side API routes under app/api.
- Deployment target(s): Docker (standalone output) with AWS ECS deployment workflows; CDK and ECS workflows present.
- Environment separation: staging/production flow in workflows; production write controls via ENABLE_PROD; runtime checks via /api/ready; environment set by NODE_ENV and deployment env utilities.
- Entry points:
  - npm scripts: dev, build, start (control-center/package.json)
  - Docker CMD: node server.js (control-center/Dockerfile)
  - API entrypoints: app/api/**/route.ts

---

### 3. Folder & Module Structure
- Top-level (depth 1):
  - app/ (Next.js App Router pages and API routes)
  - src/ (core server-side logic, services, integrations, contracts)
  - public/ (static assets)
  - runtime/ (runtime workflow artifacts)
  - docs/ (control-center docs)
  - lib/ (shared libraries)
  - __tests__/ (Jest tests)
  - instrumentation.ts, proxy.ts, prebuild.js (runtime/build helpers)
- Key folders:
  - app/api/ (API routes; see docs/API_ROUTES.md for canonical list)
  - src/lib/contracts/ and src/lib/schemas/ (TS contracts and Zod schemas)
  - src/lib/db/ (PostgreSQL access layer)
  - src/lib/github/, src/lib/ecs/, src/lib/mcp-* (external integrations)
  - src/lawbook/ and src/lib/lawbook/ (governance/lawbook assets)

---

### 4. External Dependencies & Integrations
- External services referenced:
  - GitHub (Octokit, webhooks)
  - OpenAI (openai SDK)
  - Anthropic (Claude SDK)
  - DeepSeek (OpenAI-compatible API)
  - AWS (Cognito, ECS, CloudWatch, SQS, Secrets Manager)
  - PostgreSQL (pg)
  - MCP servers (GitHub, deploy, observability, runner)
- SDKs/APIs used (from package.json):
  - octokit, @octokit/webhooks
  - openai, @anthropic-ai/sdk
  - @aws-sdk/client-ecs, client-cloudwatch, client-sqs, client-secrets-manager, client-cognito-identity-provider
  - pg, jose, zod, uuid
- Required environment variables (names only, observed in config/code):
  - GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_WEBHOOK_SECRET
  - OPENAI_API_KEY, OPENAI_MODEL
  - DEEPSEEK_API_KEY
  - ANTHROPIC_API_KEY
  - COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_ISSUER_URL
  - LANDING_PAGE_URL
  - AFU9_DEBUG_MODE
  - AFU9_AUTH_COOKIE, AFU9_UNAUTH_REDIRECT, AFU9_GROUPS_CLAIM
  - AFU9_STAGE_GROUP_PROD, AFU9_STAGE_GROUP_STAGING, AFU9_STAGE_GROUP_DEV, AFU9_DEFAULT_STAGE
  - NEXT_PUBLIC_APP_URL
  - DATABASE_ENABLED, DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD
  - MCP_GITHUB_URL, MCP_DEPLOY_URL, MCP_OBSERVABILITY_URL, MCP_RUNNER_URL
  - AFU9_ENABLE_SELF_PROPELLING
  - ENABLE_PROD
  - NEXT_BUILD_ID, BUILD_COMMIT_HASH, GITHUB_SHA, BUILD_VERSION, BUILD_ENV, BUILD_TIMESTAMP

---

### 5. Existing API / Contract Surface
- API routes: Next.js API routes in app/api/**; canonical list documented in docs/API_ROUTES.md (auth, health, webhooks, workflows, issues, repositories, prompts/actions, lawbook, observability, KPIs, costs, factory status, system, etc.).
- Contracts: Defines internal TS contracts and Zod schemas in src/lib/contracts/ and src/lib/schemas/; these are used by API handlers and services.
- Data access layer: src/lib/db/ for PostgreSQL-backed persistence.

---

### 6. Current Health / Readiness Signals
- /api/health: liveness probe; always returns 200 with build info and flags (control-center/app/api/health/route.ts).
- /api/ready: readiness probe; checks environment and database configuration; optionally checks MCP servers; returns 503 when required dependencies fail (control-center/app/api/ready/route.ts).
- /api/build-info and /api/build-metadata: build metadata endpoints (documented in docs/API_ROUTES.md).
- Hard gates observed:
  - Production write gating via ENABLE_PROD in src/lib/utils/prod-control.ts.
  - Readiness requires DATABASE_* when DATABASE_ENABLED=true.

---

### 7. CI / Automation
- GitHub Actions workflows present (file → workflow name from YAML):
  - .github/workflows/afu9-runner-guards.yml → AFU-9 Runner Regression Guards
  - .github/workflows/auto-assign-deploy-failure-issues.yml → Auto-assign Deploy Failure Issues
  - .github/workflows/build-determinism.yml → Build Determinism Check
  - .github/workflows/debug-deploy-failures.yml → AFU-9 Debug Agent
  - .github/workflows/deploy-cdk-stack-dispatch.yml → Deploy CDK Stack (Manual)
  - .github/workflows/deploy-cdk-stack.yml → Deploy CDK Stack with Diff Gate
  - .github/workflows/deploy-control-center-fast.yml → Deploy Control Center (Fast)
  - .github/workflows/deploy-database-stack.yml → Deploy Database Stack
  - .github/workflows/deploy-ecs.yml → Deploy AFU-9 to ECS
  - .github/workflows/dispatch-smoke-test.yml → Dispatch Smoke Test
  - .github/workflows/health-check-contract.yml → Health Check Contract Tests
  - .github/workflows/mcp-start.yml → MCP Start (manual)
  - .github/workflows/migration-parity.yml → Migration Parity Check
  - .github/workflows/repo-verify.yml → repo-verify
  - .github/workflows/security-gates.yml → Security Gates
  - .github/workflows/security-validation.yml → Security Validation
  - .github/workflows/sync-check.yml → Sync Check
- Workflow documentation: .github/workflows/README.md (details for deploy-ecs and legacy v0.1 workflow).
- Repo quality gates (from package.json scripts): lint (eslint), test (jest), build (next build), repo-verify via workflow.

---

### 8. Obvious Gaps or Inconsistencies (Observed, Not Opinion)
- next.config.ts sets typescript.ignoreBuildErrors = true, so TypeScript type errors do not fail builds.
- docs/API_ROUTES.md marks /api/github/webhook as deprecated but still present as an alias route.

---

### 9. Summary for v0.1 Planning
- Provides a Next.js control UI plus a broad server-side API surface for AFU-9 operations (issues, workflows, observability, governance).
- Integrates with GitHub, AWS (Cognito/ECS/etc.), PostgreSQL, and multiple LLM providers (OpenAI/Anthropic/DeepSeek).
- Includes health/readiness endpoints and build metadata endpoints suitable for deployment health checks.
- Includes CI/CD workflows for ECS deploys and various guard/validation checks.
- Does not expose a formal OpenAPI spec; contracts are internal TS/Zod definitions only.