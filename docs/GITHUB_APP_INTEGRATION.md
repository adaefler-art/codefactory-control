# GitHub App Integration (AFU-9)

This document describes the **server-to-server GitHub App integration** used by Control Center.

## Overview

Flow (happy path):

1. GitHub sends a webhook to `POST /api/github/webhook`.
2. Control Center verifies `x-hub-signature-256` using the **raw request body**.
3. Control Center records `x-github-delivery` in Postgres (`github_webhook_deliveries`) for idempotency.
4. For `issues` + `opened`, Control Center posts a comment using a **GitHub App installation token**.

No OAuth Client ID/Client Secret is used.

## Secrets

The integration loads a single AWS Secrets Manager secret (default name):

- `afu9/github/app`

Expected JSON shape:

```json
{
  "appId": "123456",
  "installationId": "12345678",
  "webhookSecret": "<github webhook secret>",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}
```

Notes:
- `privateKeyPem` must be **PKCS#8**. Newlines may be stored as `\n` and are normalized at runtime.
- Region is taken from `AWS_REGION` / `AWS_DEFAULT_REGION` (fallback `eu-central-1`).
- Override for local dev/testing (bypasses Secrets Manager):
  - `GITHUB_APP_ID`
  - `GITHUB_APP_INSTALLATION_ID`
  - `GITHUB_APP_WEBHOOK_SECRET`
  - `GITHUB_APP_PRIVATE_KEY_PEM`

## Idempotency

- The delivery ID (`x-github-delivery`) is inserted into `github_webhook_deliveries`.
- Redeliveries result in:

```json
{ "ok": true, "duplicate": true }
```

## Webhook endpoint

- Endpoint: `POST /api/github/webhook`
- Required headers:
  - `x-hub-signature-256`
  - `x-github-event`
  - `x-github-delivery`

Missing/invalid signature returns `401`.

### PowerShell example

Use this for local testing (compute a valid signature):

```powershell
$secret = $env:GITHUB_APP_WEBHOOK_SECRET
$body = '{"action":"opened","issue":{"number":1},"repository":{"name":"repo","full_name":"org/repo","owner":{"login":"org"}}}'

$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
$sig = "sha256=" + ([BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()

curl -X POST "http://localhost:3000/api/github/webhook" `
  -H "Content-Type: application/json" `
  -H "X-Hub-Signature-256: $sig" `
  -H "X-GitHub-Event: issues" `
  -H "X-GitHub-Delivery: test-$(Get-Date -UFormat %s)" `
  --data $body
```

## Troubleshooting

- `401 invalid_signature`: secret mismatch or body not read as raw text.
- `200 duplicate:true`: GitHub redelivery or retry; delivery ID already recorded.
- `Failed to create installation token`: check `appId`, `installationId`, and `privateKeyPem` correctness and IAM permissions to read the secret.

## Files

- Webhook route: control-center/app/api/github/webhook/route.ts
- GitHub App auth: control-center/src/lib/github-app-auth.ts
- Idempotency persistence: control-center/src/lib/webhooks/persistence.ts
- Migration: database/migrations/019_github_webhook_deliveries.sql
