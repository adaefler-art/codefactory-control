# E7.0.2 Image Matrix Gate - Quick Reference

## Overview

The Image Matrix Gate prevents "silent partial deploys" by ensuring all container images referenced in ECS TaskDefs are built, pushed, and verified before and after deployment.

## Key Files

- **Manifest**: `images-manifest.json` - Single source of truth for all images
- **Schema**: `images-manifest-schema.json` - JSON schema for validation
- **Scripts**:
  - `scripts/validate-image-manifest.ts` - Validates manifest structure
  - `scripts/pre-deploy-image-gate.ts` - Pre-deploy ECR checks
  - `scripts/post-deploy-image-verification.ts` - Post-deploy TaskDef verification
- **Tests**: `scripts/__tests__/image-manifest.test.ts` - 19 unit tests
- **Docs**: 
  - `E7_0_2_IMPLEMENTATION_SUMMARY.md` - Full implementation details
  - `E7_0_2_EVIDENCE.md` - Complete evidence package

## Quick Commands

### Validate Manifest
```bash
npx ts-node scripts/validate-image-manifest.ts
```

### Pre-Deploy Gate (requires AWS credentials)
```bash
DEPLOY_ENV=staging \
  GIT_SHA=$(git rev-parse HEAD) \
  npx ts-node scripts/pre-deploy-image-gate.ts
```

### Post-Deploy Verification (requires AWS credentials)
```bash
DEPLOY_ENV=staging \
  GIT_SHA=$(git rev-parse HEAD) \
  ECS_CLUSTER=afu9-cluster \
  ECS_SERVICE=afu9-control-center-staging \
  npx ts-node scripts/post-deploy-image-verification.ts
```

### Run Tests
```bash
npm test -- scripts/__tests__/image-manifest.test.ts
```

## Workflow Integration

The gates are integrated into `.github/workflows/deploy-ecs.yml`:

1. **Pre-Deploy Gate** (after image builds):
   - Validates manifest structure
   - Checks ECR repositories exist
   - Verifies all required images are pushed

2. **Post-Deploy Verification** (after service stable):
   - Retrieves running task definition
   - Validates all containers use images from current deploy
   - Fails if any stale/mixed image references detected

## Image Tagging Strategy

**Pattern**: `{prefix}-{sha}`

- **Production**: `prod-{full_sha}`, `prod-{short_sha}`, `prod-latest`
- **Staging**: `stage-{full_sha}`, `stage-{short_sha}`, `stage-latest`

**Example**:
```
Git SHA: abc1234567890def1234567890abcdef12345678

Staging tags:
  - stage-abc1234567890def1234567890abcdef12345678
  - stage-abc1234
  - stage-latest

Production tags:
  - prod-abc1234567890def1234567890abcdef12345678
  - prod-abc1234
  - prod-latest
```

## Required Images

All 4 images must be built and pushed for every deploy:

1. **control-center** (`afu9/control-center`)
2. **mcp-github** (`afu9/mcp-github`)
3. **mcp-deploy** (`afu9/mcp-deploy`)
4. **mcp-observability** (`afu9/mcp-observability`)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation failed |
| 2 | Usage error or missing environment variables |

## Environment Variables

### All Scripts
- `DEPLOY_ENV` - Required: "staging" or "production"
- `GIT_SHA` - Required: Full git commit SHA
- `AWS_REGION` - Optional: Default "eu-central-1"

### Post-Deploy Verification Only
- `ECS_CLUSTER` - Required: ECS cluster name
- `ECS_SERVICE` - Required: ECS service name

## Troubleshooting

### Manifest Validation Fails
```bash
# Check manifest syntax
cat images-manifest.json | jq .

# Validate against schema
npx ajv validate -s images-manifest-schema.json -d images-manifest.json
```

### Pre-Deploy Gate Fails (Missing Image)
```bash
# List images in ECR
aws ecr describe-images \
  --repository-name afu9/control-center \
  --region eu-central-1

# Check if image was built
docker images | grep afu9/control-center
```

### Post-Deploy Verification Fails (Stale Image)
```bash
# Get current task definition
aws ecs describe-services \
  --cluster afu9-cluster \
  --services afu9-control-center-staging \
  --query 'services[0].taskDefinition' \
  --output text

# Describe task definition
aws ecs describe-task-definition \
  --task-definition <arn-from-above> \
  --query 'taskDefinition.containerDefinitions[*].[name,image]' \
  --output table
```

## Adding a New Image

1. Add image to `images-manifest.json`:
   ```json
   {
     "id": "my-new-service",
     "name": "afu9/my-new-service",
     "dockerfile": "services/my-new-service/Dockerfile",
     "context": "services/my-new-service",
     "buildArgs": [],
     "required": true,
     "taskDefContainerName": "my-new-service",
     "healthCheck": "/health"
   }
   ```

2. Add ECR repository name to `ecrRepositories` array

3. Add build step to `.github/workflows/deploy-ecs.yml`

4. Update task definition to include new container

5. Validate manifest:
   ```bash
   npx ts-node scripts/validate-image-manifest.ts
   ```

6. Run tests:
   ```bash
   npm test -- scripts/__tests__/image-manifest.test.ts
   ```

## Monitoring

Monitor gate execution in GitHub Actions workflow logs:

- **Pre-Deploy Gate**: Look for "Pre-Deploy Image Gate (E7.0.2)" step
- **Post-Deploy Verification**: Look for "Post-Deploy Image Verification (E7.0.2)" step

Both steps will show detailed output including:
- Which images are being checked
- ECR repository status
- Image tag availability
- Validation results

## Related Issues

- **E7.0.1**: Deploy Context Guardrail (environment isolation)
- **E7.0.2**: Image Matrix Gate (this implementation)

## Support

For issues or questions:
1. Check `E7_0_2_IMPLEMENTATION_SUMMARY.md` for detailed documentation
2. Review `E7_0_2_EVIDENCE.md` for examples and test outputs
3. Run tests locally: `npm test -- scripts/__tests__/image-manifest.test.ts`
