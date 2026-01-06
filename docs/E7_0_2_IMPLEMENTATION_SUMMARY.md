# E7.0.2 Image Matrix Gate - Implementation Summary

## Issue
**E7.0.2 Image Matrix Gate — kein "CDK wired but not built/pushed"**

## Problem/Context
CDK can define container images in TaskDefs, but the deploy pipeline doesn't necessarily build/push all images. This creates "silent partial deploys" where:
- TaskDef references images that haven't been built
- Only some images are updated while others remain stale
- No validation ensures all required images exist before deploy

## Goal
Deterministic build/push/deploy chain: TaskDef contains only images that the workflow guarantees to have built & pushed (or deploy fails).

## Implementation

### 1. Image Manifest (Single Source of Truth)

**File: `images-manifest.json`**
- Canonical list of all container images required for deployment
- Defines Dockerfile paths, build contexts, and ECR repository names
- Specifies tagging strategy and required vs. optional images
- Schema validation via `images-manifest-schema.json`

**Contents:**
```json
{
  "version": "1.0.0",
  "images": [
    {
      "id": "control-center",
      "name": "afu9/control-center",
      "dockerfile": "control-center/Dockerfile",
      "context": ".",
      "required": true,
      "taskDefContainerName": "control-center"
    },
    // ... mcp-github, mcp-deploy, mcp-observability
  ],
  "ecrRepositories": [
    "afu9/control-center",
    "afu9/mcp-github",
    "afu9/mcp-deploy",
    "afu9/mcp-observability"
  ],
  "tagging": {
    "strategy": "git-sha",
    "prefixes": {
      "production": "prod",
      "staging": "stage"
    },
    "alwaysTag": [
      "{prefix}-{full_sha}",
      "{prefix}-{short_sha}",
      "{prefix}-latest"
    ]
  }
}
```

### 2. Manifest Validation Script

**File: `scripts/validate-image-manifest.ts`**

**Purpose:**
- Validates manifest structure and completeness
- Checks that all Dockerfiles and build contexts exist
- Ensures ECR repository list matches image definitions
- Validates tagging configuration

**Usage:**
```bash
npx ts-node scripts/validate-image-manifest.ts
```

**Exit codes:**
- 0: Manifest is valid
- 1: Validation failed
- 2: File not found or parse error

### 3. Pre-Deploy Image Gate

**File: `scripts/pre-deploy-image-gate.ts`**

**Purpose:**
- Pre-deployment check that runs AFTER images are built
- Validates ECR repositories exist and are accessible
- Checks that all required images have been pushed with correct tags
- Prevents deploy if any required image is missing

**Environment variables:**
- `DEPLOY_ENV` (required): "staging" or "production"
- `GIT_SHA` (required): Full git commit SHA
- `AWS_REGION` (optional): Default "eu-central-1"

**Usage:**
```bash
DEPLOY_ENV=production GIT_SHA=abc123... \
  npx ts-node scripts/pre-deploy-image-gate.ts
```

**Validation logic:**
1. Load manifest
2. Generate expected image tags based on DEPLOY_ENV and GIT_SHA
3. Check ECR repositories exist
4. Verify images with expected tags are present in ECR
5. Fail if any required image is missing

**Exit codes:**
- 0: All images ready for deployment
- 1: Missing images or repositories
- 2: Missing env vars or usage error

### 4. Post-Deploy Verification

**File: `scripts/post-deploy-image-verification.ts`**

**Purpose:**
- Post-deployment verification after ECS service is stable
- Validates running task definition uses ONLY images from current deploy
- Detects mixed/stale image references

**Environment variables:**
- `DEPLOY_ENV` (required): "staging" or "production"
- `GIT_SHA` (required): Full git commit SHA
- `ECS_CLUSTER` (required): ECS cluster name
- `ECS_SERVICE` (required): ECS service name
- `AWS_REGION` (optional): Default "eu-central-1"

**Usage:**
```bash
DEPLOY_ENV=production GIT_SHA=abc123... \
  ECS_CLUSTER=afu9-cluster ECS_SERVICE=afu9-control-center \
  npx ts-node scripts/post-deploy-image-verification.ts
```

**Validation logic:**
1. Retrieve current task definition from ECS service
2. Extract container image URIs
3. Parse repository names and tags
4. Compare against expected tags for this deploy
5. Fail if any container uses unexpected tag

**Exit codes:**
- 0: All images match current deploy
- 1: Image mismatch detected
- 2: Missing env vars or usage error

### 5. Workflow Integration

**Modified: `.github/workflows/deploy-ecs.yml`**

**Added steps:**

#### Pre-Deploy Image Gate (after image builds)
```yaml
- name: Pre-Deploy Image Gate (E7.0.2)
  env:
    DEPLOY_ENV: ${{ steps.target.outputs.deploy_env }}
    GIT_SHA: ${{ github.sha }}
    AWS_REGION: ${{ env.AWS_REGION }}
  run: |
    # Validate manifest structure
    npx ts-node scripts/validate-image-manifest.ts
    
    # Check ECR repositories and images
    npx ts-node scripts/pre-deploy-image-gate.ts
```

#### Post-Deploy Verification (after service stable)
```yaml
- name: Post-Deploy Image Verification (E7.0.2)
  env:
    DEPLOY_ENV: ${{ steps.target.outputs.deploy_env }}
    GIT_SHA: ${{ github.sha }}
    ECS_CLUSTER: ${{ steps.target.outputs.ecs_cluster }}
    ECS_SERVICE: ${{ steps.target.outputs.ecs_service }}
    AWS_REGION: ${{ env.AWS_REGION }}
  run: |
    npx ts-node scripts/post-deploy-image-verification.ts
```

### 6. Test Coverage

**File: `scripts/__tests__/image-manifest.test.ts`**

**19 tests covering:**
- Manifest loading and parsing
- Structure validation
- Image definition validation (Dockerfiles, contexts exist)
- ECR repository consistency
- Tagging configuration
- Manifest content verification

**Run tests:**
```bash
npm test -- scripts/__tests__/image-manifest.test.ts
```

**Results:**
```
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

## Acceptance Criteria

### ✅ AC1: Deterministic "Image Manifest" exists
- **Evidence:** `images-manifest.json` defines all 4 required images
- **Validation:** Schema-validated JSON with complete metadata
- **Single Source of Truth:** All image definitions centralized

### ✅ AC2: Workflow builds/pushes all images or fails
- **Evidence:** Pre-deploy gate checks all required images exist in ECR
- **Fail-fast:** Deploy blocked if any required image is missing
- **No Best-Effort:** Required images must exist; workflow fails otherwise

### ✅ AC3: Consistent tagging (git_sha / build_id)
- **Evidence:** Tagging strategy defined in manifest
- **Tag patterns:** `{prefix}-{full_sha}`, `{prefix}-{short_sha}`, `{prefix}-latest`
- **Environment isolation:** `prod-` vs `stage-` prefixes

### ✅ AC4: Pre-Deploy Check
- **Manifest completeness:** Validated via `validate-image-manifest.ts`
- **ECR repos exist:** Checked via `@aws-sdk/client-ecr`
- **Images pushable:** Write access implied by successful previous builds
- **Evidence:** Pre-deploy gate step in workflow

### ✅ AC5: Post-Deploy Verify
- **Running TaskDef:** Retrieved via `@aws-sdk/client-ecs`
- **Image matching:** All containers use expected tags from current deploy
- **No mixed states:** Fails if any container uses unexpected tag
- **Evidence:** Post-deploy verification step in workflow

### ✅ AC6: Evidence
- **Manifest:** `images-manifest.json` + schema
- **Workflow logs:** Pre/post-deploy gate outputs
- **TaskDef matching:** Verification script output
- **Tests:** 19 passing tests

## Files Created

1. `images-manifest.json` - Canonical image manifest
2. `images-manifest-schema.json` - JSON schema for validation
3. `scripts/validate-image-manifest.ts` - Manifest validation
4. `scripts/pre-deploy-image-gate.ts` - Pre-deploy ECR checks
5. `scripts/post-deploy-image-verification.ts` - Post-deploy verification
6. `scripts/__tests__/image-manifest.test.ts` - Test suite (19 tests)
7. `docs/E7_0_2_IMAGE_MATRIX_GATE.md` - This document

## Files Modified

1. `.github/workflows/deploy-ecs.yml` - Added pre/post-deploy gates
2. `package.json` - Added @aws-sdk/client-ecr, @aws-sdk/client-ecs
3. `tsconfig.json` - Added jest types

## Dependencies Added

```json
{
  "@aws-sdk/client-ecr": "^3.950.0",
  "@aws-sdk/client-ecs": "^3.950.0"
}
```

## Exit Codes Summary

| Script | Success | Failure | Usage Error |
|--------|---------|---------|-------------|
| validate-image-manifest.ts | 0 | 1 | 2 |
| pre-deploy-image-gate.ts | 0 | 1 | 2 |
| post-deploy-image-verification.ts | 0 | 1 | 2 |

## Out of Scope

- Inhaltliche Änderungen am Runner/MCPs (only pipeline/determinism)
- Automated image building from manifest (workflow still defines builds)
- Cross-region image replication
- Image vulnerability scanning

## Determinism

The solution is fully deterministic:
- Manifest is version-controlled
- Tag generation is reproducible (git SHA based)
- ECR checks use AWS APIs (consistent)
- No external dependencies or random behavior

## Security Impact

**Positive:**
- Prevents deploying with missing images
- Ensures all containers use verified tags
- Detects unauthorized image changes
- Fail-closed design (no implicit defaults)

**No Negative Impact:**
- Gates run before/after deploy (no performance impact on running services)
- Only blocks on validation failures
- No IAM permission changes required

## Testing

### Unit Tests
```bash
npm test -- scripts/__tests__/image-manifest.test.ts
# 19 tests, all passing
```

### Manual Validation
```bash
# Validate manifest
npx ts-node scripts/validate-image-manifest.ts

# Test pre-deploy gate (requires AWS credentials)
DEPLOY_ENV=staging GIT_SHA=$(git rev-parse HEAD) \
  npx ts-node scripts/pre-deploy-image-gate.ts

# Test post-deploy verification (requires running service)
DEPLOY_ENV=staging GIT_SHA=$(git rev-parse HEAD) \
  ECS_CLUSTER=afu9-cluster ECS_SERVICE=afu9-control-center-staging \
  npx ts-node scripts/post-deploy-image-verification.ts
```

## Labels Applied

- `prio:P0`
- `area:deploy`
- `determinism`
- `infra`
- `build`

## Next Steps

1. Monitor first 5 production/staging deploys with new gates
2. Collect metrics on gate execution time
3. Consider adding manifest-driven build matrix (future enhancement)
4. Extend to support optional images (currently all required)

## Conclusion

E7.0.2 has been fully implemented with:
- ✅ Deterministic image manifest (single source of truth)
- ✅ Pre-deploy gate ensuring all images built/pushed
- ✅ Consistent tagging strategy (git-sha based)
- ✅ Pre-deploy checks (manifest, ECR repos, images)
- ✅ Post-deploy verification (running TaskDef matches deploy)
- ✅ Complete evidence package (manifest, logs, tests)

The implementation prevents "silent partial deploys" and ensures every deploy uses a complete, verified set of container images.
