# Deploy Status Monitor - Environment Configuration

## Required Environment Variables

### Production/Staging Deployment

For the Deploy Status Monitor to function correctly in production and staging environments, the following environment variable **MUST** be set:

```bash
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

### Why This Matters

The Deploy Status Monitor performs self-health checks by calling `/api/health` and `/api/ready` endpoints. Without `NEXT_PUBLIC_APP_URL`, it defaults to `http://localhost:3000`, which causes:

1. ❌ **RED status in production** - Health checks fail because localhost is unreachable
2. ❌ **False negatives** - Monitoring reports failures when the service is actually healthy
3. ❌ **Self-Propelling Mode blocked** - RED status prevents automated deployments

### Configuration by Environment

#### Local Development
```bash
# .env.local or .env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
Default fallback works fine for local development.

#### Staging
```bash
# ECS Task Definition / Environment Variables
NEXT_PUBLIC_APP_URL=https://control-center.stage.afu9.cloud
```

#### Production
```bash
# ECS Task Definition / Environment Variables
NEXT_PUBLIC_APP_URL=https://control-center.afu9.cloud
```

### Deployment Checklist

Before deploying to stage/prod, verify:

- [ ] `NEXT_PUBLIC_APP_URL` is set in ECS task definition
- [ ] URL matches the actual ALB/domain for the environment
- [ ] URL uses HTTPS (not HTTP) in production
- [ ] No trailing slash in the URL
- [ ] Health endpoints are accessible from within the VPC

### Verification

After deployment, check the deploy status monitor:

```bash
# Should return GREEN if properly configured
curl https://your-domain.com/api/deploy/status?env=prod

# Response should show:
# {
#   "status": "GREEN",
#   "reasons": [{ "code": "ALL_HEALTHY", ... }]
# }
```

If you see RED with `HEALTH_FAIL` or `READY_FAIL`:
1. Check `NEXT_PUBLIC_APP_URL` is set correctly
2. Verify health endpoints are accessible
3. Check network/security group rules

### Infrastructure as Code Examples

#### Terraform (ECS Task Definition)
```hcl
resource "aws_ecs_task_definition" "control_center" {
  # ... other config ...
  
  container_definitions = jsonencode([{
    environment = [
      {
        name  = "NEXT_PUBLIC_APP_URL"
        value = "https://control-center.${var.environment}.afu9.cloud"
      },
      # ... other env vars ...
    ]
  }])
}
```

#### AWS CDK (TypeScript)
```typescript
const taskDefinition = new ecs.FargateTaskDefinition(this, 'ControlCenter');

taskDefinition.addContainer('app', {
  environment: {
    NEXT_PUBLIC_APP_URL: `https://control-center.${props.environment}.afu9.cloud`,
    // ... other env vars ...
  },
});
```

#### Docker Compose (for testing)
```yaml
services:
  control-center:
    environment:
      - NEXT_PUBLIC_APP_URL=https://control-center.stage.afu9.cloud
```

### Troubleshooting

**Symptom**: Deploy status shows RED immediately after deployment

**Check**:
```bash
# Inside the container
echo $NEXT_PUBLIC_APP_URL
# Should output: https://your-domain.com
# NOT: (empty) or http://localhost:3000
```

**Fix**:
1. Update ECS task definition with correct `NEXT_PUBLIC_APP_URL`
2. Deploy new task revision
3. Wait for health checks to stabilize (~2 minutes)
4. Verify status returns GREEN

### Related Files

- Signal collector: `control-center/src/lib/deploy-status/signal-collector.ts`
- Environment validation: `control-center/app/api/deploy/status/route.ts`
- Documentation: `docs/DEPLOY_STATUS_MONITOR.md`
