# GitHub Auth Configuration (AFU9 Implement)

AFU9 implement uses GitHub App authentication (installation token).

## Mode

- GitHub App-based auth (server-to-server). Token-based `GITHUB_TOKEN` is not used for AFU9 implement.

## Required keys (one of these paths must be configured)

### Path A: Direct App Env

- GITHUB_APP_ID
- GITHUB_APP_PRIVATE_KEY_PEM

### Path B: Secrets Manager

- GITHUB_APP_SECRET_ID

## Optional keys

- GITHUB_APP_WEBHOOK_SECRET
- GH_APP_ID (legacy alias)
- GH_APP_PRIVATE_KEY_PEM (legacy alias)
- GH_APP_SECRET_ID (legacy alias)
- GH_APP_WEBHOOK_SECRET (legacy alias)
- AWS_REGION / AWS_DEFAULT_REGION / NEXT_PUBLIC_AWS_REGION (for Secrets Manager region selection)

## Missing-auth behavior

- Status: 409
- Code: GITHUB_AUTH_MISSING
- missingConfig: array of absent keys (names only)
- Headers: x-afu9-request-id, x-afu9-handler
