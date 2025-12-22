# Self-Propelling Activation (V05)

This feature is **disabled by default**.

## What this does
- Enables the `POST /api/issues/{issueNumber}/self-propel` endpoint in Control Center.

## Activation
1. Set the environment variable:
   - `AFU9_ENABLE_SELF_PROPELLING=true`

2. Ensure the workflow definition artifact is present in the Control Center runtime image at:
   - `control-center/runtime/workflows/self_propelling_issue.json`

   This repository includes the file and the Control Center Docker image copies it into the runtime layer.

## Deactivation
- Unset `AFU9_ENABLE_SELF_PROPELLING` or set it to `false`.

## Operational notes
- If `AFU9_ENABLE_SELF_PROPELLING=true` and the workflow artifact is missing at runtime, `/api/ready` returns `503` with a clear error message.
