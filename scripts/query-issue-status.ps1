#!/usr/bin/env pwsh
#Requires -Version 7.0

$ErrorActionPreference = 'Stop'

Write-Host "🔍 Querying issue I691 status after sync..." -ForegroundColor Cyan

# Get task ARN
$taskArn = aws ecs list-tasks --cluster afu9-cluster --service-name afu9-control-center-staging --query 'taskArns[0]' --output text
$taskId = $taskArn.Split('/')[-1]

# SQL query
$sql = "SELECT id, github_mirror_status, github_sync_error FROM afu9_issues WHERE id = 'I691' LIMIT 1"

# Node.js one-liner
$nodeScript = @"
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`$sql`)
  .then(r => console.log(JSON.stringify(r.rows[0], null, 2)))
  .catch(e => console.error('Error:', e.message))
  .finally(() => pool.end());
"@

# Escape for shell
$escaped = $nodeScript -replace '"', '\"' -replace "`n", ' '

Write-Host "Executing query via ECS Exec..." -ForegroundColor Gray

aws ecs execute-command `
    --cluster afu9-cluster `
    --task $taskId `
    --container control-center `
    --interactive `
    --command "node -e `"$escaped`""
