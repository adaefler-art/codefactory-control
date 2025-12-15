# AFU-9 Deployment (staging-friendly, Windows-safe)

## One-command flow (recommended)

```pwsh
pwsh ./scripts/deploy-staging.ps1 -DesiredCount 1 -DeployCdk
```
- Tag resolution: git short SHA by default; if git is unavailable, falls back to a timestamp. `-Tag` overrides both.
- Builds all images from repo root (control-center + MCPs), pushes `:SHA` and retags/pushes `:staging-latest` to ECR.
- Forces ECS deployment on cluster `afu9-cluster`, service `afu9-control-center`, and waits for target group + HTTP health.
- Prints `/api/ready` and `/api/health` JSON (including version) at the end.

## Docker build contexts (critical)
- **control-center**: context `control-center`, `-f control-center/Dockerfile`.
- **mcp-github/deploy/observability**: context **repo root** (`.`) with `-f mcp-servers/<name>/Dockerfile` so `COPY base ...` works when the build context is the repository root.

## Image tags
- Source of truth: git short SHA (immutable) + `staging-latest` alias applied after each push.
- ECR repos: `afu9/control-center`, `afu9/mcp-github`, `afu9/mcp-deploy`, `afu9/mcp-observability`.

## CDK knobs
- `cdk deploy Afu9EcsStack -c imageTag=<sha> -c desiredCount=1` (default tag `staging-latest`, default desiredCount `1` unless explicitly set to `0`).
- Service keeps `minHealthyPercent=0`.

## PowerShell tips
- Use `Invoke-WebRequest` (not the `curl` alias) for HTTP checks; quoting uses `${img}:${tag}` style when tagging.
- Avoid implicit string interpolation around `:` by using `${var}` or concatenation (already handled in `deploy-staging.ps1`).

## Health endpoints
- `http://afu9-alb-376872021.eu-central-1.elb.amazonaws.com/api/ready`
- `http://afu9-alb-376872021.eu-central-1.elb.amazonaws.com/api/health`

## Post-deploy quick check
Run after the script to confirm the acceptance criteria:

```pwsh
# ECS counts (expect running=1, pending=0, desired=1)
aws ecs describe-services --cluster afu9-cluster --services afu9-control-center --query "services[0].{running:runningCount,pending:pendingCount,desired:desiredCount}" --output table

# Target group ARN used by the service
$tg = (aws ecs describe-services --cluster afu9-cluster --services afu9-control-center --query "services[0].loadBalancers[0].targetGroupArn" --output text)
aws elbv2 describe-target-health --target-group-arn $tg --query "TargetHealthDescriptions[].TargetHealth.State" --output text

# HTTP surface checks (versions in both responses should match the deployed tag)
Invoke-WebRequest -Uri 'http://afu9-alb-376872021.eu-central-1.elb.amazonaws.com/api/health' -UseBasicParsing | Select-Object -ExpandProperty Content
Invoke-WebRequest -Uri 'http://afu9-alb-376872021.eu-central-1.elb.amazonaws.com/api/ready' -UseBasicParsing  | Select-Object -ExpandProperty Content
```
Expected:
- `running=1`, `pending=0`.
- Target health states all `healthy`.
- `/api/health` and `/api/ready` show the same `version` (git SHA or `staging-latest`) and do not return 503.
