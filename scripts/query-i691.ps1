#!/usr/bin/env pwsh
#Requires -Version 7.0

$ErrorActionPreference = 'Stop'

# Get task ARN
$taskArnFull = aws ecs list-tasks --cluster afu9-cluster --service-name afu9-control-center-staging --query 'taskArns[0]' --output text
$taskArn = $taskArnFull.Split('/')[-1]

# SQL to execute
$sql = "SELECT id, github_mirror_status, github_sync_error::text FROM afu9_issues WHERE id = 'I691'"

Write-Host "🔍 Querying issue I691 status..." -ForegroundColor Cyan
Write-Host "  Task: $taskArn" -ForegroundColor Gray
Write-Host ""

# Create Node.js one-liner
$nodeCmd = "node -e `"new (require('pg').Pool)({connectionString:process.env.DATABASE_URL}).query(\`"$sql\`").then(r=>console.log(JSON.stringify(r.rows[0],null,2))).catch(e=>{console.error(e.message);process.exit(1)})`""

aws ecs execute-command `
    --cluster afu9-cluster `
    --task $taskArn `
    --container control-center `
    --command $nodeCmd `
    --interactive
