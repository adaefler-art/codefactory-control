# GitHub Auth Consolidation: App-only (Server-to-Server)

**Release:** v0.6.5  
**Epic:** E69  
**Issue:** I691  
**Status:** ✅ Implemented

## Overview

AFU-9 uses **GitHub App server-to-server authentication** exclusively for all GitHub operations. No Personal Access Tokens (PATs) are required for operation or development.

## Authentication Model

### Single Auth Method: GitHub App

All GitHub API calls use the following flow:

1. **JWT Creation**: Generate a JSON Web Token (JWT) signed with the GitHub App's private key
2. **Installation Lookup**: Query GitHub API to get the installation ID for the target repository
3. **Installation Token**: Exchange JWT + installation ID for a short-lived access token
4. **API Call**: Use the installation token to perform GitHub operations

This ensures:
- ✅ **Deterministic**: Auth is repository-scoped and transparent
- ✅ **Governance**: No hidden state or hardcoded installation IDs
- ✅ **Security**: Tokens are short-lived (1 hour) and scoped to specific repositories
- ✅ **Idempotency**: Re-installations work automatically without reconfiguration

## Configuration

### Production (AWS ECS/Lambda)

GitHub App credentials are stored in AWS Secrets Manager:

**Secret Name:** `afu9/github/app` (configurable via `GITHUB_APP_SECRET_ID`)

**Secret Format:**
```json
{
  "appId": "123456",
  "webhookSecret": "your-webhook-secret-here",
  "privateKeyPem": "__PASTE_GITHUB_APP_PRIVATE_KEY_PEM_HERE__"
}
```

**Notes:**
- `appId`: GitHub App ID (visible in app settings)
- `webhookSecret`: Secret for webhook signature verification
- `privateKeyPem`: PKCS#8 format private key (newlines as `\n` are normalized)
- `installationId`: **NOT** stored - dynamically resolved per repository

**IAM Requirements:**
```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue"
  ],
  "Resource": "arn:aws:secretsmanager:*:*:secret:afu9/github/app*"
}
```

### Local Development

For local development, you can override Secrets Manager with environment variables:

```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_WEBHOOK_SECRET="your-webhook-secret"
export GITHUB_APP_PRIVATE_KEY_PEM="__PASTE_GITHUB_APP_PRIVATE_KEY_PEM_HERE__"
```

**Alternative:** Use AWS Secrets Manager locally with proper AWS credentials configured.

### Installation ID Resolution

**Critical:** Installation IDs are **never hardcoded or cached**. They are resolved dynamically:

```typescript
// For every GitHub API call:
const installationId = await getInstallationIdForRepo({ owner, repo });
const { token } = await getGitHubInstallationToken({ owner, repo });
// Use token for API call
```

This ensures:
1. Correct installation is used for each repository
2. No stale installation IDs after re-installations
3. Clear error messages when app is not installed on a repo
4. Governance compliance (no hidden configuration)

## Components

### 1. Control Center

**Location:** `control-center/src/lib/github-app-auth.ts`

**Functions:**
- `loadGitHubAppConfig()`: Loads app credentials from Secrets Manager or env vars
- `createGitHubAppJwt()`: Creates JWT for GitHub App authentication
- `getInstallationIdForRepo({ owner, repo })`: Resolves installation ID for repository
- `getGitHubInstallationToken({ owner, repo })`: Gets installation access token
- `postGitHubIssueComment(...)`: Helper for posting issue comments

**Error Handling:**
- `GitHubAppConfigError`: Configuration/credential issues
- `GitHubAppKeyFormatError`: Private key format issues
- Clear error messages on startup if credentials are missing/invalid

### 2. MCP GitHub Server

**Location:** `mcp-servers/github/src/index.ts`

**Authentication:**
- Uses GitHub App credentials from environment or Secrets Manager
- Generates installation tokens on-demand for each repository operation
- No PAT support

**Startup Validation:**
```typescript
// On server start:
1. Load GitHub App config (fail fast if missing)
2. Validate private key format
3. Test JWT generation
4. Log successful initialization
```

**Health Checks:**
```typescript
GET /health
GET /ready

// Checks:
- GitHub API connectivity
- App credentials validity
- Installation token generation (test)
```

## Migration from PAT

### Removed Components

1. **Environment Variables:**
   - ❌ `GITHUB_TOKEN` (PAT) - replaced by GitHub App config
   - ❌ PAT references in `.env.example`

2. **Code Patterns:**
   ```typescript
   // OLD (PAT):
   const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
   
   // NEW (GitHub App):
   const { token } = await getGitHubInstallationToken({ owner, repo });
   const octokit = new Octokit({ auth: token });
   ```

### Migration Checklist

- [x] Control Center uses `github-app-auth.ts` for all GitHub operations
- [x] MCP GitHub Server uses GitHub App credentials
- [x] `.env.example` updated with GitHub App placeholders
- [x] Documentation updated (README, runbooks)
- [x] No PAT references in code or docs
- [x] Startup validation implemented
- [x] Error messages are clear and actionable

## Security Considerations

### Private Key Management

**NEVER commit private keys to git:**
- Use Secrets Manager in production
- Use environment variables locally (not `.env` files in repo)
- Add `.env`, `.env.local`, `*.pem` to `.gitignore`

**Key Format:**
- GitHub generates PKCS#1 format (`BEGIN RSA PRIVATE KEY`)
- AFU-9 automatically converts to PKCS#8 (`BEGIN PRIVATE KEY`)
- Both formats are supported; PKCS#8 is preferred

**Key Rotation:**
```bash
# 1. Generate new private key in GitHub App settings
# 2. Update secret in AWS Secrets Manager
aws secretsmanager update-secret \
  --secret-id afu9/github/app \
  --secret-string file://new-secret.json

# 3. Restart services (ECS tasks will pick up new secret)
# 4. Revoke old key in GitHub App settings
```

### Token Lifecycle

**Installation Tokens:**
- **Lifetime:** 1 hour
- **Scope:** Repository-specific permissions
- **Caching:** Not cached (generated on-demand)
- **Rotation:** Automatic (new token per operation)

**JWT Tokens:**
- **Lifetime:** 10 minutes (9 min usable + 1 min clock skew buffer)
- **Scope:** GitHub App authentication only
- **Caching:** Not cached (generated on-demand)

## Operational Runbook

### Startup Validation

**Expected on successful startup:**
```
[github-app-auth] Loading GitHub App config from Secrets Manager
[github-app-auth] GitHub App ID: 123456
[github-app-auth] Private key validated (PKCS#8)
[mcp-github] GitHub MCP Server started on port 3001
[mcp-github] Health check: GitHub API OK
```

**Error: Missing Configuration:**
```
Error: GitHub App configuration incomplete
Missing: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY_PEM

For local dev, set environment variables:
  export GITHUB_APP_ID="..."
  export GITHUB_APP_PRIVATE_KEY_PEM="..."

For production, ensure AWS Secrets Manager secret exists:
  Secret ID: afu9/github/app
  Required keys: appId, privateKeyPem
```

**Error: Invalid Private Key:**
```
GitHubAppKeyFormatError: GitHub App private key must be a PEM string 
(PKCS#8: "BEGIN PRIVATE KEY" or PKCS#1: "BEGIN RSA PRIVATE KEY")

Check that:
1. Key includes BEGIN/END markers
2. Key content is not corrupted
3. Newlines are properly encoded (\n or actual newlines)
```

**Error: Installation Not Found:**
```
Failed to get installation for owner/repo (404)

Possible causes:
1. GitHub App is not installed on this repository
2. GitHub App lacks required permissions
3. Repository owner/name is incorrect

Action: Install GitHub App on the target repository
```

### Testing GitHub App Auth

**1. Test JWT Generation:**
```bash
# Using Control Center
cd control-center
npm test -- github-app/jwt.test.ts
```

**2. Test Installation Token:**
```bash
curl -X POST http://localhost:3001/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "getIssue",
    "arguments": {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "number": 1
    }
  }'
```

**3. Negative Test (Missing Config):**
```bash
# Remove installation ID (should fail with clear message)
unset GITHUB_APP_ID
npm --prefix control-center run dev
# Expected: Clear error message on startup
```

### Troubleshooting

**Symptom:** "Invalid GitHub credentials"
- **Cause:** App ID or private key incorrect
- **Solution:** Verify Secrets Manager content matches GitHub App settings

**Symptom:** "Installation not found for repo"
- **Cause:** GitHub App not installed on repository
- **Solution:** Install app via GitHub UI: Settings → Integrations → Your App

**Symptom:** "Token expired"
- **Cause:** Clock skew or token used after 1 hour
- **Solution:** Tokens are short-lived by design; generate new token

**Symptom:** "Insufficient permissions"
- **Cause:** GitHub App lacks required repository permissions
- **Solution:** Update app permissions in GitHub App settings

## GitHub App Setup

### Required Permissions

**Repository Permissions:**
- **Contents:** Read & Write (for branches, commits)
- **Issues:** Read & Write (for issue operations)
- **Metadata:** Read (automatic, required)
- **Pull Requests:** Read & Write (for PR operations)

**Organization Permissions:**
- None required

**User Permissions:**
- None required

**Webhook Events:**
- `issues` (for issue lifecycle)
- `pull_request` (for PR lifecycle)
- `push` (optional, for deployment triggers)

### Creating a GitHub App

1. **Go to GitHub Settings:**
   - Organization: `https://github.com/organizations/{org}/settings/apps`
   - User: `https://github.com/settings/apps`

2. **Click "New GitHub App":**
   - **Name:** `AFU-9 Code Factory`
   - **Homepage URL:** `https://control-center.afu9.cloud`
   - **Webhook URL:** `https://control-center.afu9.cloud/api/github/webhook`
   - **Webhook Secret:** Generate a random secret (save for Secrets Manager)

3. **Set Permissions** (as listed above)

4. **Generate Private Key:**
   - Scroll to "Private keys" section
   - Click "Generate a private key"
   - Download the `.pem` file
   - **Store securely** - never commit to git

5. **Install App:**
   - Click "Install App" in sidebar
   - Select repositories (all or specific repos)
   - Complete installation

6. **Update Secrets Manager:**
   ```bash
   # Create secret JSON
   cat > github-app-secret.json <<EOF
   {
     "appId": "123456",
     "webhookSecret": "your-webhook-secret",
     "privateKeyPem": "$(cat downloaded-key.pem | jq -Rs .)"
   }
   EOF
   
   # Upload to AWS
   aws secretsmanager create-secret \
     --name afu9/github/app \
     --secret-string file://github-app-secret.json \
     --region eu-central-1
   
   # Clean up local file
   rm github-app-secret.json
   ```

## Testing Checklist

- [x] MCP GitHub Server starts without PAT
- [x] Control Center GitHub integration uses App auth
- [x] `.env.example` has no secrets, only placeholders
- [x] Startup fails with clear error if GitHub App config missing
- [x] GitHub status endpoint returns OK
- [x] Read-only tool call succeeds (e.g., `getIssue`)
- [x] Installation ID resolved dynamically per repository
- [x] No PAT references in docs/examples

## References

- [GitHub Apps Documentation](https://docs.github.com/en/apps)
- [GitHub App Authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
- [Installation Access Tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- AFU-9: `control-center/src/lib/github-app-auth.ts`
- AFU-9: `docs/GITHUB_APP_INTEGRATION.md`

## Related Issues

- I691: GitHub Auth Konsolidierung (this issue)
- E69: GitHub Auth Hardening Epic
- E61: Authentication Stability (predecessor)
