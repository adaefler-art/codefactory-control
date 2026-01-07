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

# Node.js script that builds connection from individual env vars
$nodeScript = @"
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  database: process.env.DATABASE_NAME || 'afu9',
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: { rejectUnauthorized: false }
});
pool.query(\`$sql\`)
  .then(r => console.log(JSON.stringify(r.rows[0], null, 2)))
  .catch(e => console.error('Error:', e.message))
  .finally(() => pool.end());
"@

# Escape for shell (replace newlines)
$escaped = $nodeScript -replace "`r`n", ' ' -replace "`n", ' ' -replace '"', '\"'

$nodeCmd = "node -e `"$escaped`""

aws ecs execute-command `
    --cluster afu9-cluster `
    --task $taskArn `
    --container control-center `
    --command $nodeCmd `
    --interactive
