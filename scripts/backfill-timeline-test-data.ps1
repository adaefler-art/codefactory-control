# E72.4 Timeline Chain - Backfill Test Data (PowerShell)
#
# Creates minimal test data in the timeline tables for smoke testing.
# This script inserts nodes and edges directly into the database.
#
# Usage:
#   $env:DATABASE_URL = "postgresql://user:pass@host:5432/dbname"
#   $env:AFU9_SMOKE_ALLOW_BACKFILL = "1"
#   .\scripts\backfill-timeline-test-data.ps1
#
# Or inline:
#   $env:DATABASE_URL = "postgresql://localhost:5432/afu9"; $env:AFU9_SMOKE_ALLOW_BACKFILL = "1"; .\scripts\backfill-timeline-test-data.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "=== E72.4 Timeline Chain - Backfill Test Data ===" -ForegroundColor Cyan
Write-Host ""

# Check for AFU9_SMOKE_ALLOW_BACKFILL guardrail
if ($env:AFU9_SMOKE_ALLOW_BACKFILL -ne "1") {
    Write-Host "ERROR: AFU9_SMOKE_ALLOW_BACKFILL must be set to '1' to allow backfill" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "This is a safety guardrail to prevent accidental data modification."
    Write-Host ""
    Write-Host "Usage:"
    Write-Host '  $env:AFU9_SMOKE_ALLOW_BACKFILL = "1"' -ForegroundColor Gray
    Write-Host '  $env:DATABASE_URL = "postgresql://user:pass@host:5432/dbname"' -ForegroundColor Gray
    Write-Host '  .\scripts\backfill-timeline-test-data.ps1' -ForegroundColor Gray
    exit 1
}

# Check for DATABASE_URL
if (-not $env:DATABASE_URL) {
    Write-Host "ERROR: DATABASE_URL environment variable is required" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Usage:"
    Write-Host '  $env:DATABASE_URL = "postgresql://user:pass@host:5432/dbname"' -ForegroundColor Gray
    Write-Host '  $env:AFU9_SMOKE_ALLOW_BACKFILL = "1"' -ForegroundColor Gray
    Write-Host '  .\scripts\backfill-timeline-test-data.ps1' -ForegroundColor Gray
    Write-Host ""
    Write-Host "Example:"
    Write-Host '  $env:DATABASE_URL = "postgresql://localhost:5432/afu9"' -ForegroundColor Gray
    exit 1
}

Write-Host "Database: $($env:DATABASE_URL)" -ForegroundColor Gray
Write-Host ""

# SQL for test data
$SQL = @'
-- E72.4 Test Data: Create a minimal timeline chain
-- Chain: ISSUE -> PR -> RUN -> DEPLOY -> VERDICT

BEGIN;

-- Insert test ISSUE node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, url, payload_json, created_at, updated_at)
VALUES (
  'afu9',
  'issue',
  'test-issue-123',
  'ISSUE',
  'E72.4 Smoke Test Issue',
  'https://github.com/adaefler-art/codefactory-control/issues/123',
  '{"number": 123, "state": "open", "labels": ["smoke-test", "e72.4"]}',
  NOW() - INTERVAL '5 days',
  NOW() - INTERVAL '5 days'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Insert test PR node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, url, payload_json, created_at, updated_at)
VALUES (
  'afu9',
  'pull_request',
  'test-pr-456',
  'PR',
  'E72.4 Test Pull Request',
  'https://github.com/adaefler-art/codefactory-control/pull/456',
  '{"number": 456, "state": "merged", "merged_at": "2024-01-04T10:00:00Z"}',
  NOW() - INTERVAL '4 days',
  NOW() - INTERVAL '3 days'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Insert test RUN node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, payload_json, lawbook_version, created_at, updated_at)
VALUES (
  'afu9',
  'run',
  'run:test-run-789',
  'RUN',
  'E72.4 Test Run',
  '{"status": "SUCCEEDED", "duration_ms": 120000, "exit_code": 0}',
  'v1.0.0',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Insert test DEPLOY node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, payload_json, lawbook_version, created_at, updated_at)
VALUES (
  'afu9',
  'deploy',
  'deploy:test-deploy-abc',
  'DEPLOY',
  'E72.4 Test Deploy to Staging',
  '{"environment": "staging", "status": "SUCCEEDED", "deployed_at": "2024-01-05T10:00:00Z"}',
  'v1.0.0',
  NOW() - INTERVAL '2 days',
  NOW() - INTERVAL '2 days'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Insert test VERDICT node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, payload_json, lawbook_version, created_at, updated_at)
VALUES (
  'afu9',
  'verdict',
  'verdict:test-verdict-xyz',
  'VERDICT',
  'E72.4 Test Verdict: PASS',
  '{"outcome": "PASS", "score": 100, "checks_passed": 10, "checks_failed": 0}',
  'v1.0.0',
  NOW() - INTERVAL '1 day',
  NOW() - INTERVAL '1 day'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Insert test ARTIFACT node
INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title, url, payload_json, created_at, updated_at)
VALUES (
  'afu9',
  'artifact',
  'artifact:test-log-001',
  'ARTIFACT',
  'test-run.log',
  's3://afu9-artifacts/test-run.log',
  '{"size_bytes": 2048, "content_type": "text/plain", "sha256": "abc123def456"}',
  NOW() - INTERVAL '3 days',
  NOW() - INTERVAL '3 days'
)
ON CONFLICT (source_system, source_type, source_id) DO UPDATE
SET title = EXCLUDED.title, updated_at = NOW();

-- Create edges to link the chain
-- ISSUE -> PR
INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json, created_at)
SELECT i.id, p.id, 'ISSUE_HAS_PR', '{"linked_at": "2024-01-04T09:00:00Z"}', NOW() - INTERVAL '4 days'
FROM timeline_nodes i, timeline_nodes p
WHERE i.source_id = 'test-issue-123' AND p.source_id = 'test-pr-456'
ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

-- PR -> RUN
INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json, created_at)
SELECT p.id, r.id, 'PR_HAS_RUN', '{"triggered_by": "merge"}', NOW() - INTERVAL '3 days'
FROM timeline_nodes p, timeline_nodes r
WHERE p.source_id = 'test-pr-456' AND r.source_id = 'run:test-run-789'
ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

-- RUN -> DEPLOY
INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json, created_at)
SELECT r.id, d.id, 'RUN_HAS_DEPLOY', '{"deploy_trigger": "success"}', NOW() - INTERVAL '2 days'
FROM timeline_nodes r, timeline_nodes d
WHERE r.source_id = 'run:test-run-789' AND d.source_id = 'deploy:test-deploy-abc'
ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

-- DEPLOY -> VERDICT
INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json, created_at)
SELECT d.id, v.id, 'DEPLOY_HAS_VERDICT', '{"verification_type": "smoke_test"}', NOW() - INTERVAL '1 day'
FROM timeline_nodes d, timeline_nodes v
WHERE d.source_id = 'deploy:test-deploy-abc' AND v.source_id = 'verdict:test-verdict-xyz'
ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

-- RUN -> ARTIFACT
INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type, payload_json, created_at)
SELECT r.id, a.id, 'RUN_HAS_ARTIFACT', '{"artifact_type": "log"}', NOW() - INTERVAL '3 days'
FROM timeline_nodes r, timeline_nodes a
WHERE r.source_id = 'run:test-run-789' AND a.source_id = 'artifact:test-log-001'
ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

COMMIT;

-- Verify the data
SELECT 
  'Nodes created' as category,
  COUNT(*) as count
FROM timeline_nodes
WHERE source_id IN ('test-issue-123', 'test-pr-456', 'run:test-run-789', 'deploy:test-deploy-abc', 'verdict:test-verdict-xyz', 'artifact:test-log-001')

UNION ALL

SELECT 
  'Edges created' as category,
  COUNT(*) as count
FROM timeline_edges e
JOIN timeline_nodes fn ON e.from_node_id = fn.id
JOIN timeline_nodes tn ON e.to_node_id = tn.id
WHERE fn.source_id IN ('test-issue-123', 'test-pr-456', 'run:test-run-789', 'deploy:test-deploy-abc', 'verdict:test-verdict-xyz')
   OR tn.source_id IN ('test-issue-123', 'test-pr-456', 'run:test-run-789', 'deploy:test-deploy-abc', 'verdict:test-verdict-xyz');

-- Show the chain
SELECT 
  n.node_type,
  n.source_id,
  n.title,
  n.created_at
FROM timeline_nodes n
WHERE source_id IN ('test-issue-123', 'test-pr-456', 'run:test-run-789', 'deploy:test-deploy-abc', 'verdict:test-verdict-xyz', 'artifact:test-log-001')
ORDER BY 
  CASE n.node_type
    WHEN 'ISSUE' THEN 1
    WHEN 'PR' THEN 2
    WHEN 'RUN' THEN 3
    WHEN 'DEPLOY' THEN 4
    WHEN 'VERDICT' THEN 5
    WHEN 'ARTIFACT' THEN 6
  END,
  n.created_at;
'@

Write-Host "Executing SQL to create test data..." -ForegroundColor Cyan
Write-Host ""

try {
    # Check if psql is available
    $psqlPath = Get-Command psql -ErrorAction SilentlyContinue
    
    if ($psqlPath) {
        # Use psql if available
        $SQL | & psql $env:DATABASE_URL 2>&1 | Write-Host
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "✓ Test data created successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Test Issue ID: test-issue-123" -ForegroundColor Cyan
            Write-Host "Source System: afu9" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "You can now run the smoke test:" -ForegroundColor Gray
            Write-Host ".\scripts\smoke-test-timeline-chain.ps1 -BaseUrl http://localhost:3000" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Or query the API directly:" -ForegroundColor Gray
            Write-Host "Invoke-RestMethod 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9'" -ForegroundColor Gray
            exit 0
        } else {
            throw "psql command failed with exit code $LASTEXITCODE"
        }
    } else {
        Write-Host "psql not found. Attempting to use Node.js pg client..." -ForegroundColor Yellow
        
        # Fallback to Node.js pg client
        $nodeScript = @'
const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

const sql = `SQL_PLACEHOLDER`;

async function run() {
  try {
    await client.connect();
    const result = await client.query(sql);
    
    // Display results
    if (result.length > 0) {
      result.forEach(r => {
        if (r.rows && r.rows.length > 0) {
          console.table(r.rows);
        }
      });
    }
    
    await client.end();
    console.log('\n✓ Test data created successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
'@
        $nodeScript = $nodeScript.Replace('SQL_PLACEHOLDER', $SQL.Replace("`n", "\n").Replace("'", "\'"))
        $nodeScript | node
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "Test Issue ID: test-issue-123" -ForegroundColor Cyan
            Write-Host "Source System: afu9" -ForegroundColor Cyan
            exit 0
        } else {
            throw "Node.js pg client failed"
        }
    }
} catch {
    Write-Host ""
    Write-Host "✗ Failed to create test data" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Check database connection and permissions" -ForegroundColor Yellow
    exit 1
}
