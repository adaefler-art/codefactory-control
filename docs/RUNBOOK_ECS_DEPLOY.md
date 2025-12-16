# ECS Deploy Runbook (AFU-9)

Use these PowerShell steps to investigate a failing `afu9-control-center` deployment on ECS Fargate. Requires AWS CLI v2 configured (`aws configure` or `-Profile`). Defaults assume `eu-central-1`.

## Quick variables
```powershell
$cluster = "afu9-cluster"
$service = "afu9-control-center"
$region  = "eu-central-1"
$profile = "your-profile"   # optional
```

## 1) Service events (recent)
```powershell
aws ecs describe-services --cluster $cluster --services $service `
  --region $region --profile $profile `
  --query "services[0].events[:20][].{at:createdAt,msg:message}" --output table
```

## 2) Stopped tasks (last 10) with exit codes
```powershell
$tasks = aws ecs list-tasks --cluster $cluster --service-name $service `
  --desired-status STOPPED --max-items 10 --region $region --profile $profile `
  --query "taskArns" --output text
if ($tasks) {
  aws ecs describe-tasks --cluster $cluster --tasks $tasks `
    --region $region --profile $profile `
    --query "tasks[].{task:taskArn,stopped:stoppedReason,containers:containers[].{name:name,exit:exitCode,reason:reason}}" `
    --output table
}
```

## 3) Target group health
```powershell
$tg = aws ecs describe-services --cluster $cluster --services $service `
  --region $region --profile $profile `
  --query "services[0].loadBalancers[0].targetGroupArn" --output text
if ($tg -and $tg -ne "None") {
  aws elbv2 describe-target-health --target-group-arn $tg `
    --region $region --profile $profile `
    --query "TargetHealthDescriptions[].{target:Target.Id,state:TargetHealth.State,desc:TargetHealth.Description}" `
    --output table
}
```

## 4) Log groups used by the task definition
```powershell
$taskDef = aws ecs describe-services --cluster $cluster --services $service `
  --region $region --profile $profile `
  --query "services[0].taskDefinition" --output text
aws ecs describe-task-definition --task-definition $taskDef `
  --region $region --profile $profile `
  --query "taskDefinition.containerDefinitions[].logConfiguration.options.'awslogs-group'" --output text
```
Tail an individual log group (control-center example):
```powershell
aws logs tail /ecs/afu9/control-center --since 30m --follow `
  --region $region --profile $profile
```

## Decision tree (abridged)
- **Service events show AccessDenied to Secrets Manager** → verify `enableDatabase` context/flag; ensure DB secret ARN/name is correct and execution role has `GetSecretValue/DescribeSecret` (stack grants execution role only).
- **Stopped tasks exit 1 quickly** → check container logs for DB env vars missing; if DB disabled, `/api/ready` reports `database: not_configured` by design.
- **Target health unhealthy** → confirm port/health endpoints (`/api/health` for control-center); see container logs for 4xx/5xx.
- **No targets registered** → confirm service attached to correct target group (tg ARN above) and tasks are running.
- **Logs empty** → ensure log group exists and execution role can create streams; check taskDefinition logConfiguration.

## Automation helper
Run the bundled script for a compact summary:
```powershell
npm run ecs:diagnose -- --Cluster $cluster --Service $service --Region $region --Profile $profile
# or
pwsh -File scripts/ecs_diagnose.ps1 -Cluster $cluster -Service $service -Region $region -Profile $profile
```
