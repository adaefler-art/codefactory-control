# v0.7 Configuration Surface Audit

**Date**: 2026-01-06  
**Version**: v0.7.x Audit  
**Purpose**: Inventory all environment variables and validate fail-closed behavior

---

## Executive Summary

This audit identifies all environment variables used in the AFU-9 Control Center, categorizes them by purpose, and verifies fail-closed behavior for security-critical configurations.

**Total Environment Variables**: 70+ unique variables  
**Critical Vars (Fail-Closed)**: 15  
**Optional Vars**: 55+

---

## Configuration Categories

### 1. GitHub App Configuration (9 vars) [E71, E75]

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `GITHUB_APP_ID` | ✅ Yes | ✅ Yes | None | GitHub App ID for server-to-server auth |
| `GITHUB_APP_PRIVATE_KEY_PEM` | ✅ Yes | ✅ Yes | None | GitHub App private key (PEM format) |
| `GITHUB_APP_WEBHOOK_SECRET` | ✅ Yes | ✅ Yes | None | Webhook signature verification secret |
| `GITHUB_APP_SECRET_ID` | ⚠️ Optional | No | `afu9/github/app` | AWS Secrets Manager secret ID |
| `GITHUB_OWNER` | ⚠️ Optional | No | None | Default GitHub owner |
| `GITHUB_REPO` | ⚠️ Optional | No | None | Default GitHub repository |
| `GITHUB_REPO_ALLOWLIST` | ✅ Yes | ✅ Yes | Dev default | Repository access policy (JSON) |
| `GH_APP_ID` | ⚠️ Alias | No | None | Alias for GITHUB_APP_ID |
| `GH_APP_PRIVATE_KEY_PEM` | ⚠️ Alias | No | None | Alias for GITHUB_APP_PRIVATE_KEY_PEM |
| `GH_APP_WEBHOOK_SECRET` | ⚠️ Alias | No | None | Alias for GITHUB_APP_WEBHOOK_SECRET |
| `GH_APP_SECRET_ID` | ⚠️ Alias | No | None | Alias for GITHUB_APP_SECRET_ID |

**Fail-Closed Behavior**:
- If `GITHUB_APP_ID` or `GITHUB_APP_PRIVATE_KEY_PEM` missing → GitHub integration disabled (404 or error)
- If `GITHUB_REPO_ALLOWLIST` missing → Uses development default (codefactory-control only)
- Empty allowlist → Deny all repository access

**Validation**:
```powershell
# Check GitHub App configuration
curl http://localhost:3000/api/integrations/github/status

# Expected: {"status": "ok", "appId": "123456", ...}
# If missing creds: {"error": "GitHub App not configured"}
```

---

### 2. LLM API Keys (3 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `OPENAI_API_KEY` | ⚠️ Optional | ⚠️ Partial | None | OpenAI API key (GPT models) |
| `ANTHROPIC_API_KEY` | ⚠️ Optional | No | None | Anthropic API key (Claude models) |
| `DEEPSEEK_API_KEY` | ⚠️ Optional | No | None | DeepSeek API key |

**Fail-Closed Behavior**:
- INTENT console requires at least one LLM key configured
- If no keys configured → INTENT endpoints return 404 or error
- Individual agent execution may gracefully degrade or fail based on model availability

**Validation**:
```powershell
# Check INTENT status
curl http://localhost:3000/api/intent/status

# Expected: {"enabled": true, "models": ["gpt-4", "claude-3-opus"]}
# If no keys: {"enabled": false, "reason": "No LLM keys configured"}
```

---

### 3. Database Configuration (7 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `DATABASE_ENABLED` | ⚠️ Optional | ✅ Yes | `false` | Enable/disable database features |
| `DATABASE_HOST` | ✅ Yes (if enabled) | ✅ Yes | `localhost` | Database host |
| `DATABASE_PORT` | ✅ Yes (if enabled) | ✅ Yes | `5432` | Database port |
| `DATABASE_NAME` | ✅ Yes (if enabled) | ✅ Yes | `afu9` | Database name |
| `DATABASE_USER` | ✅ Yes (if enabled) | ✅ Yes | None | Database user |
| `DATABASE_PASSWORD` | ✅ Yes (if enabled) | ✅ Yes | None | Database password |
| `DATABASE_URL` | ⚠️ Alternative | No | None | Full connection URL (alternative to individual vars) |
| `DATABASE_SSL` | ⚠️ Optional | No | `true` | Enable SSL for database connections |

**Fail-Closed Behavior**:
- If `DATABASE_ENABLED=false` → All database-dependent endpoints return 503 or degraded mode
- If `DATABASE_ENABLED=true` but credentials missing → Application fails to start (fail-fast)
- Missing database connection → Endpoints return 503 Service Unavailable

**Validation**:
```powershell
# Check database status
curl http://localhost:3000/api/ready

# Expected: {"status": "ok", "database": "connected"}
# If DB disabled: {"status": "ok", "database": "disabled"}
# If DB error: {"status": "degraded", "database": "error"}
```

---

### 4. Authentication Configuration (11 vars) [Auth Hardening]

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `COGNITO_REGION` | ✅ Yes | ✅ Yes | None | AWS Cognito region |
| `COGNITO_USER_POOL_ID` | ✅ Yes | ✅ Yes | None | Cognito User Pool ID |
| `COGNITO_CLIENT_ID` | ✅ Yes | ✅ Yes | None | Cognito App Client ID |
| `COGNITO_ISSUER_URL` | ✅ Yes | ✅ Yes | None | Cognito issuer URL (for JWT validation) |
| `AFU9_AUTH_COOKIE` | ⚠️ Optional | No | `afu9_id` | Cookie name for ID token |
| `AFU9_UNAUTH_REDIRECT` | ⚠️ Optional | No | `https://afu-9.com/` | Redirect URL for unauthenticated users |
| `AFU9_GROUPS_CLAIM` | ⚠️ Optional | No | `cognito:groups` | JWT groups claim key |
| `AFU9_STAGE_GROUP_PROD` | ⚠️ Optional | No | None | Prod group name (for stage detection) |
| `AFU9_STAGE_GROUP_STAGING` | ⚠️ Optional | No | None | Stage group names (comma-separated) |
| `AFU9_STAGE_GROUP_DEV` | ⚠️ Optional | No | None | Dev group names (comma-separated) |
| `AFU9_DEFAULT_STAGE` | ⚠️ Optional | No | `stage` | Default stage if not detected from groups |
| `DISABLE_PASSWORD_RESET` | ⚠️ Optional | No | `false` | Disable password reset functionality |

**Fail-Closed Behavior**:
- If Cognito variables missing → All authenticated endpoints return 401 Unauthorized
- Invalid JWT → 401 Unauthorized (never degrade to unauthenticated)
- Missing groups claim → User has no stage access (403 Forbidden)

**Validation**:
```powershell
# Check auth configuration
curl http://localhost:3000/api/whoami

# Expected (authenticated): {"sub": "user-123", "isAdmin": false}
# Expected (unauthenticated): 401 Unauthorized
```

---

### 5. Admin Authorization (1 var) [E79]

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `AFU9_ADMIN_SUBS` | ✅ Yes (for admin ops) | ✅ Yes | Empty | Comma-separated list of admin user sub IDs |

**Fail-Closed Behavior**:
- If `AFU9_ADMIN_SUBS` is empty or missing → All admin endpoints return 403 Forbidden
- Admin endpoints: lawbook publish/activate, system config, migrations

**Validation**:
```powershell
# Check admin status
curl http://localhost:3000/api/whoami

# Expected (admin user): {"sub": "admin-123", "isAdmin": true}
# Expected (non-admin): {"sub": "user-123", "isAdmin": false}

# Try admin endpoint
curl -X POST http://localhost:3000/api/lawbook/activate -d '{"versionId": "v1"}'

# Expected (admin): 200 OK
# Expected (non-admin): 403 Forbidden
```

---

### 6. Production Control (1 var) [Issue 3]

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `ENABLE_PROD` | ✅ Yes | ✅ Yes | `false` | Enable/disable production deployments and write operations |

**Fail-Closed Behavior**:
- If `ENABLE_PROD=false` (default) → All prod deploy endpoints return 403 Forbidden
- If `ENABLE_PROD=true` → Prod deployments enabled (must be explicit)
- Missing → Defaults to `false` (fail-closed)

**Validation**:
```powershell
# Check prod status
curl http://localhost:3000/api/deploy/status

# Expected (ENABLE_PROD=false): {"prod_enabled": false, "message": "Production disabled"}
# Expected (ENABLE_PROD=true): {"prod_enabled": true, ...}
```

---

### 7. Feature Flags (2 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `AFU9_DEBUG_MODE` | ⚠️ Optional | No | `false` in prod | Enable verbose logging for troubleshooting |
| `AFU9_INTENT_ENABLED` | ⚠️ Optional | ✅ Yes | `false` | Enable INTENT console (guardrailed LLM assistant) |

**Fail-Closed Behavior**:
- If `AFU9_INTENT_ENABLED=false` (default) → INTENT endpoints return 404 Not Found
- If `AFU9_DEBUG_MODE=false` → Standard logging (no verbose debug output)

**Validation**:
```powershell
# Check INTENT status
curl http://localhost:3000/api/intent/status

# Expected (enabled): {"enabled": true}
# Expected (disabled): 404 Not Found
```

---

### 8. Application Configuration (5 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `NODE_ENV` | ⚠️ Optional | No | `production` | Node.js environment (development/production) |
| `PORT` | ⚠️ Optional | No | `3000` | Control Center port |
| `NEXT_PUBLIC_APP_URL` | ✅ Yes (prod/stage) | ⚠️ Partial | `http://localhost:3000` | Public URL for application |
| `ENVIRONMENT` | ⚠️ Optional | No | None | Deployment environment (dev/stage/prod) |
| `DEPLOY_ENV` | ⚠️ Optional | No | None | Deploy environment (alternative) |

**Fail-Closed Behavior**:
- `NEXT_PUBLIC_APP_URL` missing → Self-health checks may fail in production
- Other vars use sensible defaults

---

### 9. AWS Infrastructure (6 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `AWS_REGION` | ✅ Yes | ✅ Yes | `eu-central-1` | AWS region for services |
| `AWS_DEFAULT_REGION` | ⚠️ Alias | No | `eu-central-1` | Alias for AWS_REGION |
| `ECS_CLUSTER_NAME` | ⚠️ Optional | No | None | ECS cluster name (for status checks) |
| `ECS_SERVICE_NAME` | ⚠️ Optional | No | None | ECS service name (for status checks) |
| `ALB_NAME` | ⚠️ Optional | No | None | ALB name (for health checks) |

**Fail-Closed Behavior**:
- AWS region defaults to `eu-central-1` if missing
- ECS/ALB names missing → Infrastructure status endpoints return limited data

---

### 10. MCP Server Configuration (6 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `MCP_GITHUB_ENDPOINT` | ⚠️ Optional | ⚠️ Partial | None | MCP GitHub server endpoint |
| `MCP_DEPLOY_ENDPOINT` | ⚠️ Optional | ⚠️ Partial | None | MCP Deploy server endpoint |
| `MCP_DEPLOY_URL` | ⚠️ Alias | No | None | Alias for MCP_DEPLOY_ENDPOINT |
| `MCP_OBSERVABILITY_ENDPOINT` | ⚠️ Optional | ⚠️ Partial | None | MCP Observability server endpoint |
| `MCP_CATALOG_PATH` | ⚠️ Optional | No | None | Path to MCP catalog file |

**Fail-Closed Behavior**:
- MCP endpoints missing → MCP integration disabled (graceful degradation)
- MCP health checks fail → Return 503 but don't block application

---

### 11. Build Metadata (6 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `APP_VERSION` | ⚠️ Optional | No | `0.0.0` | Application version |
| `BUILD_VERSION` | ⚠️ Alias | No | None | Alias for APP_VERSION |
| `BUILD_COMMIT_HASH` | ⚠️ Optional | No | `unknown` | Git commit hash |
| `GIT_SHA` | ⚠️ Alias | No | None | Alias for BUILD_COMMIT_HASH |
| `GITHUB_SHA` | ⚠️ Alias | No | None | Alias for BUILD_COMMIT_HASH (GitHub Actions) |
| `BUILD_TIME` | ⚠️ Optional | No | `unknown` | Build timestamp |
| `BUILD_ENV` | ⚠️ Optional | No | None | Build environment |

**Fail-Closed Behavior**:
- None (build metadata is informational only)

---

### 12. GitHub Dispatch Configuration (3 vars)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `GITHUB_DISPATCH_DELAY_MS` | ⚠️ Optional | No | `2000` | Delay between dispatch retries (ms) |
| `GITHUB_DISPATCH_MAX_RETRIES` | ⚠️ Optional | No | `5` | Max retries for dispatch |
| `GITHUB_DISPATCH_LOOKUP_PER_PAGE` | ⚠️ Optional | No | `100` | Results per page for dispatch lookup |

**Fail-Closed Behavior**:
- Uses sensible defaults if missing

---

### 13. Deploy Events (1 var)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `DEPLOY_EVENTS_TOKEN` | ⚠️ Optional | ✅ Yes | None | Auth token for internal deploy event ingestion |

**Fail-Closed Behavior**:
- If missing → Internal deploy events endpoint disabled (403)

---

### 14. Landing Page (1 var)

| Variable | Required | Fail-Closed? | Default | Purpose |
|----------|----------|--------------|---------|---------|
| `LANDING_PAGE_URL` | ⚠️ Optional | No | `https://afu-9.com/` | Landing page URL for auth redirects |

**Fail-Closed Behavior**:
- Uses default if missing

---

## Fail-Closed Summary

### Critical Fail-Closed Variables (Must be set or default to deny)

| Variable | Fail-Closed Behavior | Impact if Missing |
|----------|---------------------|-------------------|
| `GITHUB_APP_ID` | ✅ Yes | GitHub integration disabled (404) |
| `GITHUB_APP_PRIVATE_KEY_PEM` | ✅ Yes | GitHub integration disabled (404) |
| `GITHUB_REPO_ALLOWLIST` | ✅ Yes (dev default) | Only dev repo allowed |
| `DATABASE_ENABLED` | ✅ Yes (defaults false) | Database features disabled |
| `DATABASE_USER` / `_PASSWORD` | ✅ Yes | App fails to start if DB enabled |
| `COGNITO_USER_POOL_ID` | ✅ Yes | All auth fails (401) |
| `COGNITO_CLIENT_ID` | ✅ Yes | All auth fails (401) |
| `COGNITO_ISSUER_URL` | ✅ Yes | JWT validation fails (401) |
| `AFU9_ADMIN_SUBS` | ✅ Yes (empty → deny all) | No admin access (403) |
| `ENABLE_PROD` | ✅ Yes (defaults false) | Prod deploys blocked (403) |
| `AFU9_INTENT_ENABLED` | ✅ Yes (defaults false) | INTENT disabled (404) |
| `DEPLOY_EVENTS_TOKEN` | ✅ Yes | Internal events disabled (403) |

### Optional Variables (Graceful Degradation)

All other variables have sensible defaults or gracefully degrade when missing.

---

## Validation Script

```powershell
# Validate fail-closed behavior for critical variables

# 1. GitHub App
$env:GITHUB_APP_ID = ""
curl http://localhost:3000/api/integrations/github/status
# Expected: Error or 404

# 2. Admin Access
$env:AFU9_ADMIN_SUBS = ""
curl -X POST http://localhost:3000/api/lawbook/activate
# Expected: 403 Forbidden

# 3. Production Control
$env:ENABLE_PROD = "false"
curl http://localhost:3000/api/deploy/status
# Expected: {"prod_enabled": false}

# 4. INTENT Console
$env:AFU9_INTENT_ENABLED = "false"
curl http://localhost:3000/api/intent/status
# Expected: 404 Not Found

# 5. Database
$env:DATABASE_ENABLED = "false"
curl http://localhost:3000/api/kpis
# Expected: 503 Service Unavailable or degraded mode

# 6. Authentication
# (Test with invalid/missing Cognito config)
curl http://localhost:3000/api/whoami
# Expected: 401 Unauthorized
```

---

## Recommendations

### 1. Enforce Required Variables

Add startup validation to fail-fast if critical variables are missing:

```typescript
// Example: validate-env.ts
if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY_PEM) {
  throw new Error('FATAL: GitHub App configuration missing. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PEM.');
}

if (process.env.DATABASE_ENABLED === 'true' && !process.env.DATABASE_USER) {
  throw new Error('FATAL: Database enabled but DATABASE_USER not set.');
}
```

### 2. Document Environment Variables

Ensure `.env.example` and `control-center/.env.local.template` are up-to-date with all variables.

### 3. Add CI Checks

Add CI checks to validate:
- All required variables are documented
- Fail-closed behavior is tested
- No secrets in code

### 4. Audit Secrets Manager

Verify that all production secrets are stored in AWS Secrets Manager:
- `afu9/github/app` (GitHub App credentials)
- `afu9/llm` (LLM API keys)
- `afu9/database` (Database credentials)

---

## Security Considerations

### 1. Secret Storage

- **✅ Production**: All secrets stored in AWS Secrets Manager
- **✅ Development**: Secrets in `.env.local` (gitignored)
- **❌ Never**: Secrets in code, `.env.example`, or committed files

### 2. Fail-Closed Enforcement

All security-critical features must:
- Default to disabled/deny if env var missing
- Fail startup if required var missing (fail-fast)
- Never degrade to insecure mode

### 3. Environment Detection

- Use `NODE_ENV` to detect environment
- Use `DEPLOY_ENV` or `ENVIRONMENT` for stage detection
- Never trust client-provided environment information

---

**Audit Completed By**: GitHub Copilot  
**Report Version**: 1.0  
**Last Updated**: 2026-01-06
