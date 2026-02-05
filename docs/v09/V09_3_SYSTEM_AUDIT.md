# V0.9.3 System Audit + Guardrail

## Scope
This audit documents the v0.9.3 control-center write paths, auth expectations, and the end-to-end smoke guardrail. It is a documentation-only alignment pass; no behavior changes are introduced here.

## Canonical Write Paths (v0.9.3)

### S1-S3 (S1S3 flow, staging smoke path)
- S1 Pick: `POST /api/afu9/s1s3/issues/pick`
- S2 Spec Ready: `POST /api/afu9/s1s3/issues/{id}/spec` (sets SPEC_READY in S1S3 store)
- S3 Implement: `POST /api/afu9/s1s3/issues/{id}/implement` (creates or reuses PR)

### Loop (S1-S9, control store)
- Run next step: `POST /api/loop/issues/{issueId}/run-next-step` (admin-only, AFU9_ADMIN_SUBS)
- Events: `GET /api/loop/issues/{issueId}/events`

### SPEC_READY (control issue state)
- Activate: `POST /api/issues/{id}/activate` (single active issue invariant)

## Stores and State
- S1S3 flow uses the S1S3 tables (repo/issue/PR-centric) and is smoke-allowlisted for staging.
- Loop flow uses control issues (`afu9_issues`) and intent drafts; S2 spec gate depends on intent draft lifecycle state.

## Auth and Headers
- Auth primary: JWT (middleware). Staging-only smoke bypass via `x-afu9-smoke-key` for allowlisted routes.
- `x-request-id` is present on responses; control paths also emit `x-afu9-auth-path: control` where configured.

## Error Contract (Observed)
- S1S3 + control endpoints: `{ error, details?, requestId }` with `x-request-id` header.
- Loop API: `{ errorCode, message, requestId, details? }` with `x-request-id` header.

## Known Gaps / Non-Equivalences
- S1S3 SPEC_READY does not satisfy loop S2 (loop S2 reads intent draft lifecycle, not S1S3 spec records).
- `/api/issues/{id}/activate` is not smoke-allowlisted (requires normal auth).
- `run-next-step` requires admin sub even when smoke bypass is used.

## Guardrail Smoke Test
- Script: `scripts/smoke-v093-guardrail.ps1`
- Steps: allowlist seed, S1 pick, S2 spec, S3 implement.
- Required inputs (env or parameters):
  - `AFU9_SMOKE_KEY`
  - `AFU9_SMOKE_ISSUE_NUMBER`
  - `AFU9_SMOKE_REPO` (default: `adaefler-art/codefactory-staging-test`)
  - `AFU9_SMOKE_BASE_URL` (default: `https://stage.afu-9.com`)
  - `AFU9_SMOKE_USER_ID` (default: `smoke-test-user`)
  - `AFU9_SMOKE_CANONICAL_ID` (optional)

Expected success criteria: S1 returns 201, S2 returns 200 with SPEC_READY, S3 returns 200 with PR information or idempotent existing PR.
