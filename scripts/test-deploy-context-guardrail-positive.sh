#!/usr/bin/env bash
set -euo pipefail

# E7.0.1 Positive Test: Deploy Context Guardrail
# Tests that the guardrail correctly PASSES when environment boundaries are respected

echo "🧪 Deploy Context Guardrail - Positive Tests"
echo "=============================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDRAIL_SCRIPT="${SCRIPT_DIR}/deploy-context-guardrail.ts"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_count=0
pass_count=0
fail_count=0

run_positive_test() {
  local test_name="$1"
  shift
  
  test_count=$((test_count + 1))
  echo -e "${YELLOW}Test ${test_count}: ${test_name}${NC}"
  
  # Run the guardrail and capture exit code
  set +e
  output=$(npx ts-node "$GUARDRAIL_SCRIPT" 2>&1)
  actual_exit_code=$?
  set -e
  
  if [ "$actual_exit_code" -eq 0 ]; then
    echo -e "${GREEN}✅ PASS: Guardrail correctly passed${NC}"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}❌ FAIL: Expected guardrail to pass, but it failed with exit code ${actual_exit_code}${NC}"
    echo "Output:"
    echo "$output"
    fail_count=$((fail_count + 1))
  fi
  echo ""
}

# Test 1: Valid production deploy
echo "=== Test 1: Valid Production Deploy ==="
export DEPLOY_ENV="production"
export ECS_SERVICE="afu9-control-center"
export ECS_CLUSTER="afu9-cluster"
export CREATE_STAGING_SERVICE="false"
export DB_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123"
export IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
run_positive_test "Valid production deploy should pass"
unset DB_SECRET_ARN IMAGE_URI

# Test 2: Valid staging deploy
echo "=== Test 2: Valid Staging Deploy ==="
export DEPLOY_ENV="staging"
export ECS_SERVICE="afu9-control-center-staging"
export ECS_CLUSTER="afu9-cluster"
export CREATE_STAGING_SERVICE="true"
export DB_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/database-abc123"
export SMOKE_KEY_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-xyz"
export IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123"
run_positive_test "Valid staging deploy should pass"
unset DB_SECRET_ARN SMOKE_KEY_SECRET_ARN IMAGE_URI

# Test 3: Production with no optional artifacts
echo "=== Test 3: Production with minimal config ==="
unset DB_SECRET_ARN SMOKE_KEY_SECRET_ARN IMAGE_URI CREATE_STAGING_SERVICE
export DEPLOY_ENV="production"
export ECS_SERVICE="afu9-control-center"
export ECS_CLUSTER="afu9-cluster"
run_positive_test "Production deploy with minimal config should pass"

# Test 4: Staging with no optional artifacts
echo "=== Test 4: Staging with minimal config ==="
unset DB_SECRET_ARN SMOKE_KEY_SECRET_ARN IMAGE_URI CREATE_STAGING_SERVICE
export DEPLOY_ENV="staging"
export ECS_SERVICE="afu9-control-center-staging"
export ECS_CLUSTER="afu9-cluster"
run_positive_test "Staging deploy with minimal config should pass"

# Summary
echo "=========================================="
echo "Test Summary:"
echo "  Total:  ${test_count}"
echo -e "  ${GREEN}Passed: ${pass_count}${NC}"
if [ "$fail_count" -gt 0 ]; then
  echo -e "  ${RED}Failed: ${fail_count}${NC}"
else
  echo "  Failed: ${fail_count}"
fi
echo "=========================================="

if [ "$fail_count" -gt 0 ]; then
  echo -e "${RED}Some positive tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All positive tests passed! Valid deploys are allowed.${NC}"
  exit 0
fi
