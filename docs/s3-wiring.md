# S3 wiring map (control + engine + UI)

Status: inventory only, no new implementation.
Date: 2026-02-10

## 1) Control-center: S3 implement endpoints

### Endpoints and routing

- Primary S3 endpoint (s1s9 scope)
  - POST /api/afu9/s1s9/issues/{id}/implement
  - Route: control-center/app/api/afu9/s1s9/issues/[id]/implement/route.ts
  - Behavior: wrapper that calls the s1s3 implement route after S1S9 lookup; uses withAfu9ScopeFallback.
- Core S3 endpoint (s1s3 scope)
  - POST /api/afu9/s1s3/issues/{id}/implement
  - Route: control-center/app/api/afu9/s1s3/issues/[id]/implement/route.ts

### Upstreams / side effects

- Direct GitHub side effects (no engine runner, no queue):
  - Uses control-center/src/lib/github/issue-sync.ts
  - Calls GitHub Issues API via Octokit:
    - addLabels (label trigger)
    - createComment (comment trigger)
- Updates control-center DB:
  - createS1S3Run, createS1S3RunStep
  - updateS1S3IssueStatus to IMPLEMENTING

### ENV guards and requirements

- AFU9_STAGE (required, else ENGINE_MISCONFIGURED)
- GitHub write config (stage registry gate):
  - GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY_PEM, or GITHUB_APP_SECRET_ID
- Trigger config (enforced in route):
  - AFU9_GITHUB_IMPLEMENT_LABEL and/or AFU9_GITHUB_IMPLEMENT_COMMENT
  - If both missing -> 503 DISPATCH_DISABLED with requiredConfig list
- Repo metadata required per issue:
  - repo_full_name and github_issue_number

### Response shape

Success (202):
- ok: true
- stage: S3
- runId, mutationId, issueId, startedAt
- issue, run, step
- githubTrigger: { status: TRIGGERED, labelApplied, commentPosted, message }

Error (4xx/5xx):
- ok: false
- stage: S3
- code: VALIDATION_FAILED | DISPATCH_DISABLED | GITHUB_WRITE_DENIED | ENGINE_MISCONFIGURED | INTERNAL_ERROR
- message, requestId
- requiredConfig (when DISPATCH_DISABLED)

### OpenAPI coverage

- POST /api/afu9/s1s3/issues/{id}/implement is documented.
- POST /api/afu9/s1s9/issues/{id}/implement is documented.
- Source: control-center/src/lib/openapi/afu9ControlOpenapi.ts
- Generated: control-center/src/generated/afu9-control-openapi.json

## 2) Engine: S3 "implement" handler existence

### What exists

- Engine has a proxy-style S3 handler:
  - packages/engine/src/api/s1s3Handlers.ts
  - implementIssueHandler: forwards POST to control-center /api/afu9/{scope}/issues/{id}/implement
  - Scope is selected from URL (/s1s9/ vs /s1s3/)
  - No direct GitHub work in engine for S3 implement

- Engine also has an implement-prep handler:
  - packages/engine/src/api/implementPrepHandlers.ts
  - Creates branch + PR idempotently using GitHub auth
  - Not referenced by current control-center S3 route

### Inputs expected (engine proxy)

- issueId (path param)
- request body: forwarded as-is
- Uses CONTROL_CENTER_BASE_URL for upstream

### Conclusion (engine dependency)

- Current control-center S3 does not call engine.
- Engine is optional in this S3 path (proxy-only), not authoritative.

## 3) UI: Why S3 shows "nicht verfuegbar"

### Actual endpoint used by UI

- s3Implement() in UI calls:
  - /api/control/afu9/s1s9/issues/{id}/implement
  - Source: codefactory-ui/src/lib/api/afu9GatewayClient.ts
- Control client base:
  - /api/control + /afu9/... (CONTROL_API_BASE)

### Gating path in UI

- IssueDetailClient derives stage availability from workflow:
  - canRunS3 = hasReachedStage("S3")
  - hasReachedStage checks workflow.nextStep/current/completed
- "S3 ist aktuell nicht verfuegbar" is shown only when:
  - canRunS3 == false AND
  - hasPicked == true AND hasSpec == true

### Action blocking signal

- UI also checks stage actions from IssueDetailResponse:
  - s3ExecuteAction = stages[].actions[actionId=execute]
  - blocked state disables the button and shows blockedReason

### Where those values come from

- IssueDetailResponse is built in control-center:
  - control-center/app/api/afu9/issues/[id]/route.ts
  - stages = resolveStageActions(stageId)
  - workflow = buildWorkflow(s1s3Issue.status, hasS1)

### Likely reason for "S3 nicht verfuegbar"

- buildWorkflow() only advances to S3 if s1s3Issue.status == SPEC_READY.
- If SPEC_READY is missing (no S2 run or failed), workflow.nextStep stays S2.
- That makes canRunS3 false, which triggers the "nicht verfuegbar" panel.

### Note on queue gating

- UI does not hard-block S3 on queue missing by itself.
- control-center stage registry for S3 only blocks on missing GitHub app config.
- If S3 is blocked, it should surface as DISPATCH_DISABLED via stages[].actions.

## S3 wiring map (end-to-end)

UI
  -> POST /api/control/afu9/s1s9/issues/{id}/implement
  -> control-center/app/api/afu9/s1s9/issues/[id]/implement (wrapper)
  -> control-center/app/api/afu9/s1s3/issues/[id]/implement
  -> GitHub side effects (label + comment) via control-center/src/lib/github/issue-sync.ts
  -> DB updates (run + step + issue status)

Engine (optional proxy, not required)
  -> POST /api/afu9/s1s9/issues/:id/implement
  -> proxies to control-center /api/afu9/s1s9/issues/{id}/implement

## Minimal fix?

No clear wiring mismatch found.
- UI hits the documented s1s9 implement route.
- Control-center s1s9 implement route exists and delegates to s1s3 implementation.
- OpenAPI documents both routes.

If S3 remains unavailable in UI, the most likely cause is workflow data (issue not SPEC_READY) or missing GitHub app config causing DISPATCH_DISABLED in stage actions.
