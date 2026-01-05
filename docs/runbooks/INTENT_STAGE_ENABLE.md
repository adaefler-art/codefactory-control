# INTENT (Stage) Enablement Runbook

This runbook enables the INTENT Agent MVP on **staging** while preserving **fail-closed** behavior elsewhere.

## What “enabled” means

- INTENT message generation is guarded by the runtime flag `AFU9_INTENT_ENABLED`.
- When disabled, `/api/intent/sessions/[id]/messages` returns **404** with a clear error message (fail-closed).

## Prerequisites

- Staging deployment uses an `OPENAI_API_KEY` secret at runtime.
  - If the key is missing, message generation will fail with a 500 error like `OPENAI_API_KEY is not configured`.
- You are authenticated in the Control Center (middleware provides `x-afu9-sub` to API routes).

## How staging gets enabled

This repo injects `AFU9_INTENT_ENABLED=true` into the **staging** ECS task definition during deploy.

- Workflow: `.github/workflows/deploy-ecs.yml`
- Scope: staging only
- Production remains unchanged (still fail-closed unless enabled explicitly).

## Procedure (staging)

1) Deploy staging via GitHub Actions
- Run workflow: `Deploy AFU-9 to ECS`
- Input `environment`: `staging`

2) Verify flag is effective
- Call (authenticated): `GET /api/system/flags-env`
- Confirm `effective.values` contains `AFU9_INTENT_ENABLED: true`

3) Verify UI
- Open `/intent`
- Ensure the “INTENT is disabled” banner is **not** shown

4) Verify the agent path
- Create or select a session
- Send a message
- Expected: `POST /api/intent/sessions/[id]/messages` returns **201**

## Rollback (staging)

To disable INTENT on staging again:

- Remove/flip the staging-only injection of `AFU9_INTENT_ENABLED` in `.github/workflows/deploy-ecs.yml`, then redeploy staging.

## Notes

- This runbook intentionally does not include any secrets, tokens, or secret ARNs.
- If you need to enable/disable INTENT via ECS env/secret configuration instead of the workflow, that is infrastructure work and should be handled in the deployment/IaC layer.
