# Build Identity System

## Overview

The Build Identity System provides a single source of truth for deployment and build metadata across AFU-9. It eliminates hardcoded version strings and enables deterministic deploy verification.

## Architecture

### Core Module

**`src/lib/build/build-info.ts`** - Single source of truth for build metadata

```typescript
export type BuildInfo = {
  appVersion: string;  // Semantic version (e.g., "0.5.0")
  gitSha: string;      // Git commit SHA (7 chars, e.g., "a1b2c3d")
  buildTime: string;   // ISO 8601 timestamp
};

export function getBuildInfo(): BuildInfo;
```

### Environment Variables

The system reads three environment variables:

- `APP_VERSION` - Application semantic version
- `GIT_SHA` - Git commit SHA (7 characters)
- `BUILD_TIME` - ISO 8601 build timestamp

**Fallback Behavior**: If any variable is missing, returns `"unknown"` - never throws.

## Usage

### Server-Side (API Routes)

```typescript
import { getBuildInfo } from '@/lib/build/build-info';

export async function GET() {
  const buildInfo = getBuildInfo();
  
  return Response.json({
    version: buildInfo.appVersion,
    git_sha: buildInfo.gitSha,
    build_time: buildInfo.buildTime,
  });
}
```

### ECS Deployment

Environment variables are set in the ECS task definition:

```typescript
// lib/afu9-ecs-stack.ts
environment: {
  APP_VERSION: appVersion,  // From CDK context or env
  GIT_SHA: gitSha,          // From CDK context or env
  BUILD_TIME: buildTime,    // From CDK context or env
  // ... other env vars
}
```

#### CDK Deployment

Pass build info via context:

```bash
cdk deploy \
  -c app-version=0.5.0 \
  -c git-sha=a1b2c3d \
  -c build-time=2025-12-28T13:48:20Z
```

Or via environment variables:

```bash
export APP_VERSION=0.5.0
export GIT_SHA=a1b2c3d
export BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cdk deploy
```

#### GitHub Actions Deployment

```yaml
- name: Deploy to ECS
  env:
    APP_VERSION: ${{ github.event.release.tag_name }}
    GIT_SHA: ${{ github.sha }}
    BUILD_TIME: ${{ steps.build.outputs.timestamp }}
  run: |
    cdk deploy \
      -c app-version=$APP_VERSION \
      -c git-sha=${GIT_SHA:0:7} \
      -c build-time=$BUILD_TIME
```

## API Endpoints

### `/api/health`

Liveness probe - always returns HTTP 200

```json
{
  "status": "ok",
  "service": "afu9-control-center",
  "version": "0.5.0",
  "git_sha": "a1b2c3d",
  "build_time": "2025-12-28T13:48:20Z",
  "database_enabled": true,
  "timestamp": "2025-12-28T14:30:00Z"
}
```

### `/api/ready`

Readiness probe - returns 200 (ready) or 503 (not ready)

```json
{
  "ready": true,
  "service": "afu9-control-center",
  "version": "0.5.0",
  "timestamp": "2025-12-28T14:30:00Z",
  "checks": {
    "service": { "status": "ok" },
    "database": { "status": "ok", "message": "connection_configured" },
    "environment": { "status": "ok" }
  },
  "dependencies": {
    "required": ["environment", "database"],
    "optional": ["mcp-github", "mcp-deploy", "mcp-observability"]
  }
}
```

### `/api/system/config`

System configuration and build metadata

```json
{
  "system": {
    "version": "0.5.0",
    "git_sha": "a1b2c3d",
    "build_time": "2025-12-28T13:48:20Z",
    "architecture": "AFU-9 (Ninefold)",
    "environment": "production"
  }
}
```

## Design Principles

### 1. Never Throw

The `getBuildInfo()` function never throws errors. Missing environment variables return `"unknown"` to prevent deployment failures.

### 2. Environment-Based

Follows 12-factor app principles - all configuration comes from environment variables, not code.

### 3. ECS Health Invariant

The `/api/health` endpoint always returns HTTP 200, even if build metadata is unavailable, to prevent ECS/ALB from killing healthy containers.

### 4. Single Source of Truth

All version/build information flows through `getBuildInfo()` - no hardcoded version strings anywhere in the runtime code.

## Testing

Run tests:

```bash
cd control-center
npm test -- __tests__/lib/build/build-info.test.ts
npm test -- __tests__/api/health-contract.test.ts
```

Key test scenarios:

- ✅ Reads environment variables correctly
- ✅ Falls back to "unknown" for missing vars
- ✅ Never throws errors
- ✅ Health endpoint always returns 200
- ✅ Ready endpoint uses build info

## Migration from Hardcoded Versions

### Before

```typescript
const VERSION = '0.2.5';  // ❌ Hardcoded

return Response.json({
  version: VERSION,
});
```

### After

```typescript
import { getBuildInfo } from '@/lib/build/build-info';

const buildInfo = getBuildInfo();

return Response.json({
  version: buildInfo.appVersion,
  git_sha: buildInfo.gitSha,
  build_time: buildInfo.buildTime,
});
```

## Governance Alignment

This system aligns with AFU-9 governance principles:

- **Verdicts > Opinions**: Deterministic build identity enables evidence-based deployment verification
- **Deploy Verification**: Git SHA provides traceable artifact lineage
- **Observability**: Build metadata visible at runtime for debugging and auditing
- **Health-Check Invariant**: Never breaks ECS/ALB health checks with missing metadata

## Troubleshooting

### Build info shows "unknown"

Check that environment variables are set in the ECS task definition:

```bash
aws ecs describe-task-definition \
  --task-definition afu9-control-center \
  --query 'taskDefinition.containerDefinitions[0].environment'
```

Should include:
```json
[
  { "name": "APP_VERSION", "value": "0.5.0" },
  { "name": "GIT_SHA", "value": "a1b2c3d" },
  { "name": "BUILD_TIME", "value": "2025-12-28T13:48:20Z" }
]
```

### Health check failing

The health endpoint should NEVER fail. If it does:

1. Check container logs for errors
2. Verify the container is running
3. The health endpoint has no dependencies - if it fails, the Node.js process is likely crashed

### Wrong version showing

1. Check CDK context values used during deployment
2. Verify GitHub Actions workflow sets correct env vars
3. Check ECS task definition has correct environment variables
