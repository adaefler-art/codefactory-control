# AFU-9 v0.2 Deploy Process (CDK)

This doc explains **what gets deployed**, **how staging is created**, and the **safe commands/context** to avoid the two failure modes we hit:

1) deploying without a staging service in the chosen mode, and
2) referencing the wrong database secret (e.g. a legacy `.../ma**er` secret).

## Source of truth

- Infrastructure is defined in CDK.
- Entry point: [bin/codefactory-control.ts](../../bin/codefactory-control.ts)
- ECS stack: [lib/afu9-ecs-stack.ts](../../lib/afu9-ecs-stack.ts)
- Database stack: [lib/afu9-database-stack.ts](../../lib/afu9-database-stack.ts)

## Two supported deployment modes

### Mode A: Single-env (shared cluster, optional staging service)

This is the **backward compatible** path (when `afu9-multi-env` is NOT enabled).

Stacks created:
- `Afu9NetworkStack`
- optional `Afu9DnsStack` (only when HTTPS enabled)
- optional `Afu9DatabaseStack` (only when DB enabled)
- `Afu9EcsStack` (creates prod service **and** can create staging service)
- optional `Afu9RoutingSingleEnvStack` (only when DNS/HTTPS is enabled)

Staging service behavior:
- `Afu9EcsStack` always creates the prod service `afu9-control-center`.
- It creates **an additional staging ECS service** `afu9-control-center-staging` only when:
  - a stage target group is present (it is created in the entry point), AND
  - context `afu9-create-staging-service` is `true` (default `true`).

If `afu9-create-staging-service=false`, CDK will *remove* the staging service resource from the stack, which can delete it.

### Mode B: Multi-env (separate stage and prod stacks)

Enable by passing context `-c afu9-multi-env=true`.

Stacks created:
- `Afu9NetworkStack`
- optional `Afu9DnsStack` (only when HTTPS enabled)
- optional `Afu9DatabaseStack` (only when DB enabled)
- `Afu9EcsStageStack` (stage)
- `Afu9EcsProdStack` (prod)
- optional `Afu9RoutingStack` (only when DNS/HTTPS is enabled)

In this mode, staging is not a “secondary service in the same stack”; it is its **own ECS stack**.

## Database secret: the only supported secret

The application expects one canonical Secrets Manager secret:

- Name: `afu9/database`
- Keys: `host`, `port`, `database`, `username`, `password`

This is created by `Afu9DatabaseStack` as the **application connection secret**.

Important:
- Do **not** point ECS at any secret containing `/ma**er` in its name/ARN.
- The ECS stack now fails fast if `dbSecretName` or `dbSecretArn` points at a `/ma**er` secret.

## HTTPS / domain context

When HTTPS is enabled (default), the DNS stack requires a domain.

Provide one of:
- context: `-c afu9-domain=afu-9.com`
- env var: `DOMAIN_NAME=afu-9.com`

Avoid using `-c afu9-enable-https=false` on an environment that already has HTTPS resources, unless you intentionally want those removed.

## Practical deploy commands

All commands assume you run them from repo root with Node/CDK installed.

## Deploy from scratch (step-by-step)

This is the copy/paste sequence to bring up the whole system cleanly.

Notes:
- If HTTPS is enabled (default), you MUST provide a domain via `-c afu9-domain=...`.
- `Afu9EcsStack` imports Cognito exports (`Afu9AuthStack`), so deploy Auth before ECS.
- `Afu9IamStack` is for CI/CD roles (GitHub Actions). ECS runtime does not depend on it.

### Option 1: Single-env (shared cluster + optional staging service)

Use this when you want prod + staging services in one shared cluster/ALB.

0) Preflight (credentials)

```bash
aws sts get-caller-identity
```

1) DNS (only if HTTPS is enabled)

```bash
npx cdk deploy Afu9DnsStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

2) Network (VPC, ALB, security groups)

```bash
npx cdk deploy Afu9NetworkStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

3) Auth (Cognito exports consumed by ECS)

```bash
npx cdk deploy Afu9AuthStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

4) Database (optional)

If you want DB enabled in Control Center, deploy the DB stack first:

```bash
npx cdk deploy Afu9DatabaseStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

5) ECS (app)

```bash
npx cdk deploy Afu9EcsStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  -c environment=staging \
  -c afu9-create-staging-service=true \
  -c afu9-enable-database=true \
  -c dbSecretName=afu9/database \
  --require-approval never
```

6) Routing (only if DNS/HTTPS is enabled)

```bash
npx cdk deploy Afu9RoutingSingleEnvStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

7) Alarms (optional)

```bash
npx cdk deploy Afu9AlarmsStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

8) IAM (optional, CI/CD)

```bash
npx cdk deploy Afu9IamStack \
  -c afu9-domain=afu-9.com \
  -c afu9-multi-env=false \
  --require-approval never
```

### Option 2: Multi-env (separate stage + prod stacks)

Use this when you want separate ECS stacks for stage and prod.

```bash
# 1) DNS (only if HTTPS is enabled)
npx cdk deploy Afu9DnsStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never

# 2) Network
npx cdk deploy Afu9NetworkStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never

# 3) Auth
npx cdk deploy Afu9AuthStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never

# 4) DB (optional)
npx cdk deploy Afu9DatabaseStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never

# 5) ECS stage + prod
npx cdk deploy Afu9EcsStageStack Afu9EcsProdStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never

# 6) Routing (only if DNS/HTTPS is enabled)
npx cdk deploy Afu9RoutingStack -c afu9-domain=afu-9.com -c afu9-multi-env=true --require-approval never
```

### Post-deploy verification (both modes)

```bash
# ECS services
aws ecs describe-services --no-cli-pager --region eu-central-1 \
  --cluster afu9-cluster \
  --services afu9-control-center afu9-control-center-staging \
  --query "services[].{name:serviceName,status:status,desired:desiredCount,running:runningCount}" \
  --output table

# ALB target health (prod)
aws elbv2 describe-target-health --no-cli-pager --region eu-central-1 \
  --target-group-arn arn:aws:elasticloadbalancing:eu-central-1:313095875771:targetgroup/afu9-tg/595790f3ae2b1eb9 \
  --output table
```

### 1) Inspect what will change (recommended)

- `npx cdk diff Afu9EcsStack -c afu9-domain=afu-9.com`

### 2) Deploy Single-env (shared cluster)

- `npx cdk deploy Afu9EcsStack -c afu9-domain=afu-9.com`

If you want to ensure staging service exists:
- `npx cdk deploy Afu9EcsStack -c afu9-domain=afu-9.com -c afu9-create-staging-service=true`

### 3) Deploy Multi-env (separate stage/prod)

- `npx cdk deploy \
  -c afu9-multi-env=true \
  -c afu9-domain=afu-9.com \
  Afu9NetworkStack Afu9DatabaseStack Afu9EcsStageStack Afu9EcsProdStack Afu9RoutingStack`

(You can omit stacks you are not using, but keep dependencies in mind.)

## How to verify in AWS

ECS:
- Prod service should be `ACTIVE` and running.
- Staging service in single-env mode should be `ACTIVE` when enabled; if it shows as `INACTIVE`, it was deleted/rolled back.

Secrets Manager:
- Ensure secret name `afu9/database` exists.
- Ensure there is no `afu9/database/ma**er` secret.

## Common failure modes (and fixes)

### A) “No staging service”

Cause:
- Deploy mode mismatch (single-env expects staging as secondary service; multi-env expects separate stack), or
- `afu9-create-staging-service=false` removed the staging service resource.

Fix:
- Re-deploy with the correct mode and `afu9-create-staging-service=true` for single-env.

### B) “DB secret drift / ma**er secret referenced”

Cause:
- ECS configured with a legacy `/ma**er` secret.

Fix:
- Use `dbSecretName=afu9/database` or the canonical ARN for that secret.
- Do not use any `/ma**er` secret; CDK now blocks it.

## Recovery: Re-enable staging service (Single-env shared cluster)

Goal: restore an **ACTIVE** `afu9-control-center-staging` service on the shared `afu9-cluster`, without introducing destructive DNS/HTTPS diffs and while guaranteeing DB credentials come from the canonical `afu9/database` secret.

### Preconditions (safe + quick)

1) Confirm the canonical DB secret exists (do not print the SecretString)

- `aws secretsmanager list-secrets --no-cli-pager --region eu-central-1 --query "SecretList[?Name=='afu9/database'].{Name:Name,ARN:ARN}" --output table`

2) Confirm current service status

- `aws ecs describe-services --no-cli-pager --region eu-central-1 --cluster afu9-cluster --services afu9-control-center afu9-control-center-staging --query "services[].{name:serviceName,status:status,desired:desiredCount,running:runningCount}" --output table`

### Current resource identifiers (as of 2025-12-22)

These are the concrete identifiers currently observed in AWS (useful for copy/paste verification commands):

- ECS cluster ARN: `arn:aws:ecs:eu-central-1:313095875771:cluster/afu9-cluster`
- Prod target group ARN (`afu9-tg`): `arn:aws:elasticloadbalancing:eu-central-1:313095875771:targetgroup/afu9-tg/595790f3ae2b1eb9`
- Stage target group ARN (`afu9-tg-stage`): `arn:aws:elasticloadbalancing:eu-central-1:313095875771:targetgroup/afu9-tg-stage/6b6bd0d662ee79c3`
- CloudWatch Logs:
  - `/ecs/afu9/control-center` (ARN: `arn:aws:logs:eu-central-1:313095875771:log-group:/ecs/afu9/control-center`)
  - `/ecs/afu9/mcp-github` (ARN: `arn:aws:logs:eu-central-1:313095875771:log-group:/ecs/afu9/mcp-github`)
  - `/ecs/afu9/mcp-deploy` (ARN: `arn:aws:logs:eu-central-1:313095875771:log-group:/ecs/afu9/mcp-deploy`)
  - `/ecs/afu9/mcp-observability` (ARN: `arn:aws:logs:eu-central-1:313095875771:log-group:/ecs/afu9/mcp-observability`)

3) Choose a domain context (required when HTTPS is enabled)

- Use: `-c afu9-domain=afu-9.com`
- Do **not** use `-c afu9-enable-https=false` unless you intentionally want to remove HTTPS/DNS resources.

### Step 1: Non-destructive diff (ECS-only)

Run a diff for the ECS stack only. Expect to see an `AWS::ECS::Service` resource for staging when enabled.

- `npx cdk diff Afu9EcsStack -c afu9-domain=afu-9.com -c afu9-create-staging-service=true -c afu9-enable-database=true -c dbSecretName=afu9/database`

If the diff shows removals in `Afu9NetworkStack`/`Afu9DnsStack`, stop and adjust context (the goal is ECS-only changes for this recovery).

### Step 2: Deploy recovery (create staging service)

- `npx cdk deploy Afu9EcsStack -c afu9-domain=afu-9.com -c afu9-create-staging-service=true -c afu9-enable-database=true -c dbSecretName=afu9/database`

Notes:
- `afu9-create-staging-service` defaults to `true`, but we pass it explicitly to prevent accidental toggles.
- `dbSecretName=afu9/database` forces the canonical secret and avoids any legacy `/ma**er` drift.
- This will create/update the staging ECS service resource inside `Afu9EcsStack` (single-env mode).

### Step 3: Verify success

1) ECS services

- `aws ecs describe-services --no-cli-pager --region eu-central-1 --cluster afu9-cluster --services afu9-control-center-staging --query "services[0].{status:status,desired:desiredCount,running:runningCount,events:events[0].message}" --output json`

Expected:
- `status` = `ACTIVE`
- `desiredCount` = 1
- `runningCount` = 1

2) ALB target group health (stage)

Verify targets become healthy:

- `aws elbv2 describe-target-health --no-cli-pager --region eu-central-1 --target-group-arn arn:aws:elasticloadbalancing:eu-central-1:313095875771:targetgroup/afu9-tg-stage/6b6bd0d662ee79c3 --output table`

Optional (readiness validation):

- `curl -s https://afu-9.com/api/ready | jq .`

### If it fails again (fast diagnosis)

1) Check stopped tasks for the staging service

- `aws ecs list-tasks --no-cli-pager --region eu-central-1 --cluster afu9-cluster --service-name afu9-control-center-staging --desired-status STOPPED --max-results 10 --output json`
- `aws ecs describe-tasks --no-cli-pager --region eu-central-1 --cluster afu9-cluster --tasks <taskArn1> <taskArn2> --query "tasks[].{stoppedReason:stoppedReason,containers:containers[].{name:name,exitCode:exitCode,reason:reason}}" --output json`

2) Check CloudWatch logs for `control-center` container

- Log group: `/ecs/afu9/control-center` (ARN: `arn:aws:logs:eu-central-1:313095875771:log-group:/ecs/afu9/control-center`)
- Look for startup errors (missing env vars, DB connection, migration errors, etc.).

### Security note (do this after recovery)

Avoid commands that print `SecretString` to the terminal (it ends up in logs/transcripts). If a secret was printed, rotate the DB credentials and consider terminal logs compromised.
