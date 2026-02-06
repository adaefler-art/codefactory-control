# Drift Report (2026-02-06)

Time window: last 2 days (N=2).
Sources: git log --since="2 days ago" --name-only for codefactory, codefactory-ui, codefactory-engine.
Deployment mapping: inferred from repo contents only (no vercel.json found).

## Symptom Mapping
- "Neue UI (codefactory-ui) bricht X"
- "Control Center zeigt ploetzlich die neuen UI-Features"

## Commit/Change Inventory per Repo

### codefactory (control-center)
UI/Frontend-affecting changes in the last 2 days:
- c3787262 (2026-02-05) Fix loop API route usage
  - control-center/app/issues/[id]/page.tsx
- 73c3f8a8 (2026-02-05) Stabilize spec ready and loop actions
  - control-center/app/issues/[id]/page.tsx
- a10bfbe4 (2026-02-05) Add auth state single source
  - control-center/app/auth/refresh/refresh-client.tsx
  - control-center/app/components/Navigation.tsx

Other recent control-center changes (backend/flow, not UI):
- ae71e338 (2026-02-06) Enforce issue identifier resolver across AFU-9
  - control-center/app/api/afu9/... (s1s3 detail/spec/implement)
  - control-center/app/api/afu9/issues/[id]/route.ts
  - control-center/app/api/control/afu9/s1/issues/[issueId]/spec/route.ts
  - control-center/app/api/issues/_shared.ts
- 620db4d8 (2026-02-05) Fix AFU9 issue resolver imports
  - control-center/app/api/afu9/issues/[id]/{merge,runs/start,verdict}/route.ts

### codefactory-ui
Flow/Issue-Detail/Actions/Errors in the last 2 days:
- e3f47424 (2026-02-06) Prefer canonical issue id for actions
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
- dcdcf511 (2026-02-06) Use canonical issue id for actions
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
  - tests/issue-detail.no-library.test.tsx
- 8cc17c52 (2026-02-05) Use canonical issue IDs for actions
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
  - src/app/(shell)/operate/issues/[issueId]/page.tsx
- eec5ec5e (2026-02-05) Show S2 success telemetry
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
- 3dfa613c (2026-02-05) Fix S2 success merge type
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
- a69747dd (2026-02-05) Fix S2 refresh gating for S3
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
  - src/components/afu9/s1s3/S2SpecPanel.tsx
  - src/lib/api/controlClient.ts
  - src/lib/api/engineClient.ts
  - tests/engine-client.test.ts
  - tests/issue-detail.no-library.test.tsx
- 61eb5da6 (2026-02-04) Refine operate issue flow
  - src/app/(shell)/operate/issues/[issueId]/IssueDetailClient.tsx
  - src/components/afu9/ErrorDisplay.tsx
  - src/components/afu9/issues/HandoffButton.tsx
  - src/components/afu9/s1s3/{S1PickPanel,S2SpecPanel,S3ImplementPanel}.tsx

### codefactory-engine
API contract / resolver / spec-handoff changes in the last 2 days:
- 4be8099b (2026-02-05) Add spec error diagnostics
  - api/issues/[issueId]/spec.ts
  - packages/engine/test/issues-spec.test.ts
- a6b32cc2 (2026-02-05) Add issue resolve trace endpoint
  - api/issues/[issueId].ts
  - api/issues/[issueId]/resolve.ts
  - api/issues/[issueId]/spec.ts
  - api/issues/_resolver.ts
- 1ae10e69 (2026-02-05) Add spec-ready issue proxy
  - api/issues/[issueId]/spec.ts
- bed30a51 / 9cc85d9b / 8942eb23 / d24f4bcf / e79a5cbc / 879345b1 (2026-02-04)
  - api/issues/[issueId]/handoff.ts (auth/diagnostics changes)

## Drift Klassifikation
- UI feature overlap: control-center contains UI at control-center/app/issues/[id]/page.tsx that overlaps with codefactory-ui /operate/issues.
- UI telemetry changes are primarily in codefactory-ui (IssueDetailClient, ErrorDisplay), while control-center also has UI/auth components (Navigation, refresh-client).
- Resolver/issue-flow changes are split across control-center (control API resolver) and codefactory-engine (issue resolve trace endpoints).

## Deployment Mapping (repo-inferred)
- No vercel.json found in any repo in this workspace.
- codefactory-engine includes Vercel handlers (api/status.ts, api/repo/*) which suggests a Vercel-style deployment, but no URL is declared in-repo.
- codefactory-ui likely hosts /api/control proxy routes (via CONTROL_API_BASE) but explicit deployment URLs are not found in repo.
- If stage.afu-9.com is the UI base, it should correspond to codefactory-ui deployment; control-center APIs are expected under /api/control/* via that UI base.

## Risiko
- Duplicate UI surfaces between control-center/app/issues and codefactory-ui/operate/issues can diverge in UX and error handling.
- Resolver and issue-not-found semantics exist in both control-center and codefactory-engine, raising risk of inconsistent 404 payloads and headers.
- Client-side error handling in UI (controlClient/ErrorDisplay) may drift from control-center response headers if not consistently applied across endpoints.

## Feature Drift Table

| Feature | Repo-Soll | Repo-Ist | Action |
| --- | --- | --- | --- |
| Operate Issue Detail UI | codefactory-ui | codefactory-ui + control-center/app/issues/[id]/page.tsx | Decide single UI owner; remove or de-emphasize duplicate UI surface. |
| ErrorDisplay telemetry (route/handler/requestId) | codefactory-ui | codefactory-ui | Keep in UI; verify endpoints supply headers. |
| S1/S2/S3 flow actions | codefactory-ui | codefactory-ui | Keep in UI; ensure engine/control APIs are the only backend source. |
| Issue resolver + 404 payload | control-center | control-center + engine resolver trace endpoints | Document ownership of resolver behavior; align 404 payloads/headers. |
| Handoff proxy/auth | control-center or engine | engine handoff proxy changes | Confirm which service owns handoff auth and keep UI calling only one path. |

## Notes
- This report is based on the last 2 days of git history and repo-local evidence only.
- Deployment URLs and deployed commit SHAs are not discoverable from this repo snapshot.
