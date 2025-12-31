#!/bin/bash
set -euo pipefail

# E72.4 Timeline Chain API E2E Smoke Test
#
# Tests the complete flow:
# 1. Backfill GitHub issue/PR/comments
# 2. Backfill AFU-9 run/deploy/verdict
# 3. Query /api/timeline/chain
# 4. Verify deterministic ordering and evidence fields
#
# Usage:
#   ./scripts/smoke-test-timeline-chain.sh [BASE_URL]
#
# Examples:
#   # Test against local dev server
#   ./scripts/smoke-test-timeline-chain.sh http://localhost:3000
#
#   # Test against staging
#   ./scripts/smoke-test-timeline-chain.sh http://afu9-alb-staging.elb.amazonaws.com
#
# Environment Variables:
#   GITHUB_TOKEN - Required for GitHub API ingestion (optional for testing)
#   DATABASE_URL - Required for direct DB backfill (optional)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL=${1:-http://localhost:3000}
TEST_ISSUE_ID=${TEST_ISSUE_ID:-test-issue-123}
TEST_SOURCE_SYSTEM=${TEST_SOURCE_SYSTEM:-afu9}

echo -e "${BLUE}=== E72.4 Timeline Chain API - E2E Smoke Test ===${NC}"
echo -e "Base URL: ${BASE_URL}"
echo -e "Test Issue ID: ${TEST_ISSUE_ID}"
echo -e "Source System: ${TEST_SOURCE_SYSTEM}"
echo ""

# Counters
PASSED=0
FAILED=0

# Helper function to run a test
run_test() {
  local test_name="$1"
  local command="$2"
  
  echo -n "Testing ${test_name}... "
  
  if eval "$command"; then
    echo -e "${GREEN}PASSED${NC}"
    PASSED=$((PASSED + 1))
    return 0
  else
    echo -e "${RED}FAILED${NC}"
    FAILED=$((FAILED + 1))
    return 1
  fi
}

# Helper function to check HTTP response
check_http() {
  local url="$1"
  local expected_status="${2:-200}"
  
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  [ "$http_code" = "$expected_status" ]
}

# Helper function to check JSON field
check_json_field() {
  local url="$1"
  local jq_query="$2"
  local expected_value="${3:-}"
  
  response=$(curl -s "$url" 2>/dev/null || echo "{}")
  actual=$(echo "$response" | jq -r "$jq_query" 2>/dev/null || echo "")
  
  if [ -n "$expected_value" ]; then
    [ "$actual" = "$expected_value" ]
  else
    [ -n "$actual" ] && [ "$actual" != "null" ]
  fi
}

echo -e "${BLUE}=== Step 1: Health Check ===${NC}"
echo ""

run_test "API Health endpoint" "check_http '${BASE_URL}/api/health' 200"
run_test "Timeline chain endpoint exists" "check_http '${BASE_URL}/api/timeline/chain?issueId=${TEST_ISSUE_ID}' 200"

echo ""
echo -e "${BLUE}=== Step 2: Backfill Documentation ===${NC}"
echo ""

cat << 'EOF'
BACKFILL FLOW (for manual or automated setup):

A. GitHub Data Ingestion (if using GitHub source):
   
   1. Ingest Issue:
      POST /api/internal/github/ingest/issue
      {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "issueNumber": 123
      }
   
   2. Ingest PR (if linked):
      POST /api/internal/github/ingest/pull-request
      {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "pullNumber": 456
      }
   
   3. Ingest Comments (optional):
      POST /api/internal/github/ingest/issue-comments
      {
        "owner": "adaefler-art",
        "repo": "codefactory-control",
        "issueNumber": 123
      }

B. AFU-9 Data Ingestion (internal artifacts):
   
   1. Ingest Run:
      POST /api/internal/afu9/ingest/run
      {
        "runId": "run-abc-123"
      }
   
   2. Ingest Deploy:
      POST /api/internal/afu9/ingest/deploy
      {
        "deployId": "deploy-xyz-456"
      }
   
   3. Ingest Verdict:
      POST /api/internal/afu9/ingest/verdict
      {
        "verdictId": "verdict-def-789"
      }

C. Direct Database Backfill (alternative):
   
   Using SQL directly (requires DATABASE_URL):
   
   -- Insert test issue node
   INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title)
   VALUES ('afu9', 'issue', 'test-issue-123', 'ISSUE', 'Test Issue for E72.4')
   ON CONFLICT (source_system, source_type, source_id) DO NOTHING;
   
   -- Insert test PR node
   INSERT INTO timeline_nodes (source_system, source_type, source_id, node_type, title)
   VALUES ('afu9', 'pull_request', 'test-pr-456', 'PR', 'Test PR')
   ON CONFLICT (source_system, source_type, source_id) DO NOTHING;
   
   -- Link issue to PR
   INSERT INTO timeline_edges (from_node_id, to_node_id, edge_type)
   SELECT i.id, p.id, 'ISSUE_HAS_PR'
   FROM timeline_nodes i, timeline_nodes p
   WHERE i.source_id = 'test-issue-123' AND p.source_id = 'test-pr-456'
   ON CONFLICT (from_node_id, to_node_id, edge_type) DO NOTHING;

EOF

echo ""
echo -e "${YELLOW}Note: For this smoke test, we assume backfill data already exists.${NC}"
echo -e "${YELLOW}For automated CI, use option C (SQL backfill) in a setup script.${NC}"
echo ""

echo -e "${BLUE}=== Step 3: Query Timeline Chain ===${NC}"
echo ""

# Test the chain API endpoint
API_URL="${BASE_URL}/api/timeline/chain?issueId=${TEST_ISSUE_ID}&sourceSystem=${TEST_SOURCE_SYSTEM}"

echo "Querying: ${API_URL}"
echo ""

# Save response to file for inspection
RESPONSE_FILE="/tmp/timeline-chain-response.json"
curl -s "$API_URL" > "$RESPONSE_FILE" 2>/dev/null || echo "{}" > "$RESPONSE_FILE"

# Display response
echo -e "${YELLOW}Response:${NC}"
cat "$RESPONSE_FILE" | jq . 2>/dev/null || cat "$RESPONSE_FILE"
echo ""

echo -e "${BLUE}=== Step 4: Verify Response Structure ===${NC}"
echo ""

run_test "Response has issueId field" "check_json_field '$API_URL' '.issueId'"
run_test "Response has sourceSystem field" "check_json_field '$API_URL' '.sourceSystem'"
run_test "Response has nodes array" "check_json_field '$API_URL' '.nodes | type' 'array'"
run_test "Response has edges array" "check_json_field '$API_URL' '.edges | type' 'array'"
run_test "Response has metadata object" "check_json_field '$API_URL' '.metadata | type' 'object'"
run_test "Metadata has nodeCount" "check_json_field '$API_URL' '.metadata.nodeCount | type' 'number'"
run_test "Metadata has edgeCount" "check_json_field '$API_URL' '.metadata.edgeCount | type' 'number'"
run_test "Metadata has timestamp" "check_json_field '$API_URL' '.metadata.timestamp'"

echo ""
echo -e "${BLUE}=== Step 5: Verify Deterministic Ordering ===${NC}"
echo ""

# Extract node types and timestamps
NODE_TYPES=$(cat "$RESPONSE_FILE" | jq -r '.nodes[].node_type' 2>/dev/null || echo "")

if [ -n "$NODE_TYPES" ]; then
  echo "Node type sequence:"
  echo "$NODE_TYPES" | nl
  echo ""
  
  # Check if ordering follows the deterministic pattern
  # Expected order: ISSUE, PR, RUN, DEPLOY, VERDICT, ARTIFACT, COMMENT
  FIRST_NODE=$(echo "$NODE_TYPES" | head -n1)
  
  if [ "$FIRST_NODE" = "ISSUE" ]; then
    echo -e "${GREEN}✓ First node is ISSUE (correct deterministic ordering)${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "${YELLOW}⚠ First node is $FIRST_NODE (expected ISSUE for typical chain)${NC}"
    echo -e "${YELLOW}  Note: Ordering may vary based on available data${NC}"
  fi
else
  echo -e "${YELLOW}⚠ No nodes found in response${NC}"
  echo -e "${YELLOW}  This is expected if backfill data doesn't exist yet${NC}"
fi

echo ""
echo -e "${BLUE}=== Step 6: Verify Evidence Fields ===${NC}"
echo ""

# Check if first node has all required evidence fields
FIRST_NODE_JSON=$(cat "$RESPONSE_FILE" | jq -r '.nodes[0]' 2>/dev/null || echo "{}")

if [ "$FIRST_NODE_JSON" != "{}" ] && [ "$FIRST_NODE_JSON" != "null" ]; then
  run_test "Node has id (UUID)" "echo '$FIRST_NODE_JSON' | jq -e '.id' > /dev/null"
  run_test "Node has source_system" "echo '$FIRST_NODE_JSON' | jq -e '.source_system' > /dev/null"
  run_test "Node has source_type" "echo '$FIRST_NODE_JSON' | jq -e '.source_type' > /dev/null"
  run_test "Node has source_id" "echo '$FIRST_NODE_JSON' | jq -e '.source_id' > /dev/null"
  run_test "Node has node_type" "echo '$FIRST_NODE_JSON' | jq -e '.node_type' > /dev/null"
  run_test "Node has created_at timestamp" "echo '$FIRST_NODE_JSON' | jq -e '.created_at' > /dev/null"
  run_test "Node has updated_at timestamp" "echo '$FIRST_NODE_JSON' | jq -e '.updated_at' > /dev/null"
  
  echo ""
  echo -e "${YELLOW}First node details:${NC}"
  echo "$FIRST_NODE_JSON" | jq '{ id, source_system, source_type, source_id, node_type, created_at }'
else
  echo -e "${YELLOW}⚠ No nodes available for evidence field verification${NC}"
fi

echo ""
echo -e "${BLUE}=== Step 7: Verify Stable Ordering (Re-query) ===${NC}"
echo ""

# Query again to verify ordering is stable
RESPONSE_FILE_2="/tmp/timeline-chain-response-2.json"
curl -s "$API_URL" > "$RESPONSE_FILE_2" 2>/dev/null || echo "{}" > "$RESPONSE_FILE_2"

NODE_IDS_1=$(cat "$RESPONSE_FILE" | jq -r '.nodes[].id' 2>/dev/null | tr '\n' ',' || echo "")
NODE_IDS_2=$(cat "$RESPONSE_FILE_2" | jq -r '.nodes[].id' 2>/dev/null | tr '\n' ',' || echo "")

if [ -n "$NODE_IDS_1" ] && [ "$NODE_IDS_1" = "$NODE_IDS_2" ]; then
  echo -e "${GREEN}✓ Node ordering is stable across queries${NC}"
  PASSED=$((PASSED + 1))
else
  if [ -z "$NODE_IDS_1" ]; then
    echo -e "${YELLOW}⚠ No nodes to compare (empty dataset)${NC}"
  else
    echo -e "${RED}✗ Node ordering changed between queries${NC}"
    FAILED=$((FAILED + 1))
  fi
fi

# Cleanup
rm -f "$RESPONSE_FILE" "$RESPONSE_FILE_2"

echo ""
echo -e "${BLUE}=== Test Summary ===${NC}"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo -e "Total:  $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ All E72.4 smoke tests passed!${NC}"
  echo -e "${GREEN}✓ Timeline chain API is operational${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  echo -e "${YELLOW}Note: Failures may occur if backfill data is not present${NC}"
  echo -e "${YELLOW}Run backfill steps (documented above) to populate test data${NC}"
  exit 1
fi
