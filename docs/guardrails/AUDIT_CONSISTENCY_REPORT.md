# AFU-9 Consistency Audit – Phase 1 (Read-Only)

Date: 2025-12-25
Scope: Repo-wide technical consistency
Mode: Observation only

## 1. API Handler Wrapping
- Observed Pattern A: API route handlers are exported via a wrapper (`withApi`) that catches unhandled errors and returns a structured JSON error payload.
- Observed Pattern B: API route handlers are exported as plain `export async function GET/POST/...` with local try/catch (or no wrapper-level standardization).
- Files where they occur: control-center/src/lib/http/withApi.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/lawbook/guardrails/route.ts; control-center/app/api/lawbook/memory/route.ts; control-center/app/api/lawbook/parameters/route.ts; control-center/app/api/issues/route.ts; control-center/app/api/issues/new/route.ts; control-center/app/api/repositories/route.ts; control-center/app/api/v1/costs/export/route.ts

## 2. API Error Envelope Shape
- Observed Pattern A: Error responses use an `error` field plus an optional secondary field such as `details` (string/array) or `message`, without a top-level `success` flag.
- Observed Pattern B: Error responses include a top-level `success: false` flag (often paired with `error`, optional `details`, and optional `timestamp`).
- Files where they occur: control-center/app/api/issues/route.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/issues/new/route.ts; control-center/app/api/repositories/route.ts; control-center/app/api/repositories/[id]/route.ts; control-center/app/api/v1/costs/export/route.ts; control-center/app/api/v1/kpi/build-determinism/route.ts; control-center/app/api/auth/login/route.ts; control-center/app/api/auth/logout/route.ts; control-center/app/api/auth/refresh/route.ts; control-center/app/api/auth/forgot-password/route.ts; control-center/app/api/auth/reset-password/route.ts

## 3. API Success Payload Shape (Wrapper vs Bare)
- Observed Pattern A: “Resource” endpoints return a bare JSON object representing the resource (no wrapper key such as `issue`), while list endpoints return `{ items, total, ... }` style payloads.
- Observed Pattern B: “Resource” endpoints return a wrapper object with a named key (e.g., `{ repository: {...} }`, `{ action: {...} }`).
- Files where they occur: control-center/app/api/issues/[id]/route.ts; control-center/app/api/issues/route.ts; control-center/app/api/issues/new/route.ts; control-center/app/api/repositories/route.ts; control-center/app/api/repositories/[id]/route.ts; control-center/app/api/actions/route.ts; control-center/app/api/actions/[id]/route.ts; control-center/app/api/prompts/route.ts; control-center/app/api/prompts/[id]/route.ts

## 4. API Request Type Usage
- Observed Pattern A: API handlers type the request as `NextRequest` (and frequently rely on `request.nextUrl.searchParams`).
- Observed Pattern B: API handlers type the request as the standard `Request` (or omit `request` entirely in `GET` signatures).
- Files where they occur: control-center/app/api/issues/route.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/issues/new/route.ts; control-center/app/api/v1/costs/export/route.ts; control-center/app/api/v1/kpi/build-determinism/route.ts; control-center/app/api/repositories/route.ts; control-center/app/api/repositories/[id]/route.ts

## 5. Request-ID Propagation & Route Logging
- Observed Pattern A: Routes generate/request an ID and set `x-request-id` on responses, with structured JSON logging helpers (`logAuthRoute`, `logRequest`).
- Observed Pattern B: Routes do not set `x-request-id`; logging is ad-hoc (e.g., `console.error(...)`, or conditional dev logging).
- Files where they occur: control-center/app/api/issues/new/route.ts; control-center/app/api/auth/login/route.ts; control-center/app/api/auth/logout/route.ts; control-center/app/api/auth/refresh/route.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/issues/route.ts; control-center/app/api/repositories/route.ts; control-center/src/lib/http/withApi.ts

## 6. Auth Route Response Negotiation
- Observed Pattern A: Auth routes branch response type based on `Accept` (browser clients receive redirects; API clients receive JSON).
- Observed Pattern B: Non-auth API routes consistently return JSON (no `Accept`-based redirect behavior).
- Files where they occur: control-center/app/api/auth/login/route.ts; control-center/app/api/auth/logout/route.ts; control-center/app/api/issues/route.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/repositories/route.ts

## 7. DB Pool Acquisition & Injection
- Observed Pattern A: Call sites import `getPool()` and then issue queries directly via `pool.query(...)`.
- Observed Pattern B: Service classes accept a `Pool` in the constructor and call `this.db.query(...)` (sometimes defaulting to `getPool()` when no pool is passed).
- Files where they occur: control-center/src/lib/db.ts; control-center/app/api/issues/route.ts; control-center/app/api/issues/[id]/route.ts; control-center/app/api/issues/new/route.ts; control-center/app/api/repositories/route.ts; control-center/app/api/repositories/[id]/route.ts; control-center/src/lib/product-service.ts; control-center/src/lib/action-registry-service.ts

## 8. DB Transaction Handling
- Observed Pattern A: Multi-statement operations use explicit transactions via `pool.connect()`, `BEGIN/COMMIT/ROLLBACK`, and `client.release()`.
- Observed Pattern B: Operations use single-statement queries via `pool.query(...)` without explicit transaction scaffolding in the calling layer.
- Files where they occur: control-center/src/lib/action-registry-service.ts; control-center/app/api/repositories/route.ts; control-center/app/api/issues/route.ts; control-center/src/lib/db/afu9Issues.ts

## 9. Ops Scripts: Strict Mode & Failure Behavior (Bash)
- Observed Pattern A: Bash scripts use strict mode (`set -euo pipefail`) and parse `--flag value` style CLI arguments.
- Observed Pattern B: Bash scripts use `set -e` (or no strict mode) and accept positional arguments for configuration.
- Files where they occur: scripts/preflight.sh; scripts/health-check.sh; scripts/create-v05-issues.sh; scripts/smoke-test.sh; scripts/smoke-test-staging.sh

## 10. Ops Scripts: Language & Output Style
- Observed Pattern A: PowerShell scripts use cmdlet-style helpers, colored output helpers, and comment-based help blocks.
- Observed Pattern B: Bash scripts use `echo`/`curl`/`jq` style pipelines and shell error modes.
- Files where they occur: scripts/aws-auth-doctor.ps1; scripts/ecs_debug.ps1; scripts/ecs_diagnose.ps1; scripts/run-debug.ps1; scripts/health-check.sh; scripts/preflight.sh; scripts/smoke-test.sh; scripts/deploy-migrations.sh

## 11. Client Routing Params Handling (App Pages)
- Observed Pattern A: Client pages treat `params` as a Promise and resolve with React’s `use(params)`.
- Observed Pattern B: Client pages accept `params` as a plain object, or a union (`Promise | object`) with conditional Promise detection.
- Files where they occur: control-center/app/workflows/[id]/page.tsx; control-center/app/workflows/executions/[id]/page.tsx; control-center/app/issues/[id]/page.tsx

## 12. Client Data Fetching & Error Surfacing
- Observed Pattern A: Pages use `useEffect` + local `isLoading/error` state and attempt to parse error JSON bodies to render messages.
- Observed Pattern B: Pages use `useEffect` + exception/alert-driven surfacing (e.g., `throw new Error(...)`, `alert(...)`) with less structured error state.
- Files where they occur: control-center/app/issues/[id]/page.tsx; control-center/app/repositories/page.tsx; control-center/app/workflows/[id]/page.tsx

## 13. UI Styling Tokens for Page Shell
- Observed Pattern A: Page shells use Tailwind classes with inline hex color tokens (e.g., `bg-[#0d1117]`, `bg-[#161b22]`).
- Observed Pattern B: Page shells use palette-style Tailwind classes (e.g., `bg-gray-900`, `border-gray-800`) without inline hex tokens.
- Files where they occur: control-center/app/repositories/page.tsx; control-center/app/repositories/[id]/page.tsx; control-center/app/workflows/page.tsx; control-center/app/settings/page.tsx; control-center/app/agents/page.tsx; control-center/app/agents/[agentType]/page.tsx; control-center/app/dashboard/page.tsx; control-center/app/board/page.tsx; control-center/app/components/Navigation.tsx
