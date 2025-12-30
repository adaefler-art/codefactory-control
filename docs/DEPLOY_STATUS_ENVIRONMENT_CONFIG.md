# Deploy Status Monitor - Environment Configuration

## Required Environment Variables

### Production/Staging Deployment

E65.1 v2 derives deploy status from persisted E65.2 verification runs, so the database must be enabled and reachable.

For the Deploy Status Monitor to function correctly in production and staging environments, the following environment variables **MUST** be set:

```bash
DATABASE_ENABLED=true
DATABASE_HOST=your-postgres-host
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=...

# If your Postgres requires SSL (typical for managed DBs)
DATABASE_SSL=true
# or
PGSSLMODE=require
```

### Why This Matters

The Deploy Status Monitor reads from `playbook_runs` / `playbook_run_steps` (E65.2 persistence) and persists snapshots to `deploy_status_snapshots`. Without database access:

1. ❌ **API 503** - `/api/deploy/status` fails closed because it cannot resolve verification runs
2. ❌ **No persistence** - status snapshots cannot be stored
3. ❌ **Self-Propelling Mode blocked** - deploy readiness signal is unavailable

### Configuration by Environment

#### Local Development
```bash
# .env.local or .env
DATABASE_ENABLED=true
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres
```

#### Staging
```bash
# ECS Task Definition / Environment Variables
DATABASE_ENABLED=true
DATABASE_HOST=<staging-postgres-host>
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=...
DATABASE_SSL=true
```

#### Production
```bash
# ECS Task Definition / Environment Variables
DATABASE_ENABLED=true
DATABASE_HOST=<prod-postgres-host>
DATABASE_PORT=5432
DATABASE_NAME=afu9
DATABASE_USER=postgres
DATABASE_PASSWORD=...
DATABASE_SSL=true
```

### Deployment Checklist

Before deploying to stage/prod, verify:

- [ ] `DATABASE_ENABLED=true` is set in ECS task definition
- [ ] DB host/port/user/dbname/password are set and correct
- [ ] SSL settings match your Postgres requirements (`DATABASE_SSL` / `PGSSLMODE`)
- [ ] The service can reach Postgres from within the VPC/security groups

### Verification

After deployment, check the deploy status monitor:

```bash
# Should return a status payload (GREEN/YELLOW/RED) if properly configured
curl https://your-domain.com/api/deploy/status?env=prod
```

If you see `503`:
1. Check `DATABASE_ENABLED=true`
2. Verify DB credentials and connectivity
3. Check network/security group rules

### Infrastructure as Code Examples

#### Terraform (ECS Task Definition)
```hcl
resource "aws_ecs_task_definition" "control_center" {
  # ... other config ...
  
  container_definitions = jsonencode([{
    environment = [
      {
        name  = "DATABASE_ENABLED"
        value = "true"
      },
      { name = "DATABASE_HOST", value = var.database_host },
      { name = "DATABASE_PORT", value = "5432" },
      { name = "DATABASE_NAME", value = "afu9" },
      { name = "DATABASE_USER", value = "postgres" },
      { name = "DATABASE_PASSWORD", value = var.database_password },
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
    DATABASE_ENABLED: 'true',
    DATABASE_HOST: props.databaseHost,
    DATABASE_PORT: '5432',
    DATABASE_NAME: 'afu9',
    DATABASE_USER: 'postgres',
    DATABASE_SSL: 'true',
    // ... other env vars ...
  },
});
```

#### Docker Compose (for testing)
```yaml
services:
  control-center:
    environment:
      - DATABASE_ENABLED=true
      - DATABASE_HOST=postgres
      - DATABASE_PORT=5432
      - DATABASE_NAME=afu9
      - DATABASE_USER=postgres
      - DATABASE_PASSWORD=postgres
```

### Troubleshooting

**Symptom**: `/api/deploy/status` returns `503` immediately after deployment

**Check**:
```bash
# Inside the container
echo $DATABASE_ENABLED
echo $DATABASE_HOST
# Ensure these are set and non-empty
```

**Fix**:
1. Update ECS task definition with correct database variables
2. Deploy new task revision
3. Verify the latest `post-deploy-verify` run exists for the environment
4. Verify the endpoint returns a status payload

### Related Files

- Verification resolver: `control-center/src/lib/deploy-status/verification-resolver.ts`
- API route: `control-center/app/api/deploy/status/route.ts`
- Documentation: `docs/DEPLOY_STATUS_MONITOR.md`
