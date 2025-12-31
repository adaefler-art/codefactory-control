#!/bin/bash
set -euo pipefail

# E72.4 Timeline Chain - Backfill Test Data
#
# Creates minimal test data in the timeline tables for smoke testing.
# This script inserts nodes and edges directly into the database.
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/dbname" ./scripts/backfill-timeline-test-data.sh
#
# Or with environment variable already set:
#   ./scripts/backfill-timeline-test-data.sh

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== E72.4 Timeline Chain - Backfill Test Data ===${NC}"
echo ""

# Check for DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  echo -e "${YELLOW}ERROR: DATABASE_URL environment variable is required${NC}"
  echo ""
  echo "Usage:"
  echo '  DATABASE_URL="postgresql://user:pass@host:5432/dbname" ./scripts/backfill-timeline-test-data.sh'
  echo ""
  echo "Example:"
  echo '  DATABASE_URL="postgresql://afu9:password@localhost:5432/afu9" ./scripts/backfill-timeline-test-data.sh'
  exit 1
fi

echo "Database: $DATABASE_URL"
echo ""

# SQL for test data
SQL=$(cat <<'EOF'
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
EOF
)

echo -e "${BLUE}Executing SQL to create test data...${NC}"
echo ""

# Execute SQL
if echo "$SQL" | psql "$DATABASE_URL" 2>&1; then
  echo ""
  echo -e "${GREEN}✓ Test data created successfully!${NC}"
  echo ""
  echo -e "${BLUE}Test Issue ID: test-issue-123${NC}"
  echo -e "${BLUE}Source System: afu9${NC}"
  echo ""
  echo "You can now run the smoke test:"
  echo "./scripts/smoke-test-timeline-chain.sh http://localhost:3000"
  echo ""
  echo "Or query the API directly:"
  echo "curl 'http://localhost:3000/api/timeline/chain?issueId=test-issue-123&sourceSystem=afu9' | jq"
  exit 0
else
  echo ""
  echo -e "${YELLOW}✗ Failed to create test data${NC}"
  echo "Check database connection and permissions"
  exit 1
fi
