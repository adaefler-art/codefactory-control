#!/usr/bin/env bash
set -euo pipefail

# E7.0.1 Negative Test: Deploy Context Guardrail
# Tests that the guardrail correctly FAILS when environment boundaries are violated

echo "🧪 Deploy Context Guardrail - Negative Tests"
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

run_negative_test() {
  local test_name="$1"
  local expected_exit_code="$2"
  shift 2
  
  test_count=$((test_count + 1))
  echo -e "${YELLOW}Test ${test_count}: ${test_name}${NC}"
  
  # Run the guardrail and capture exit code
  set +e
  output=$(ts-node "$GUARDRAIL_SCRIPT" 2>&1)
  actual_exit_code=$?
  set -e
  
  if [ "$actual_exit_code" -eq "$expected_exit_code" ]; then
    echo -e "${GREEN}✅ PASS: Guardrail correctly failed with exit code ${actual_exit_code}${NC}"
    pass_count=$((pass_count + 1))
  else
    echo -e "${RED}❌ FAIL: Expected exit code ${expected_exit_code}, got ${actual_exit_code}${NC}"
    echo "Output:"
    echo "$output"
    fail_count=$((fail_count + 1))
  fi
  echo ""
}

# Test 1: Missing DEPLOY_ENV (should fail with exit code 2)
echo "=== Test 1: Missing DEPLOY_ENV ==="
unset DEPLOY_ENV
run_negative_test "Missing DEPLOY_ENV should fail" 2

# Test 2: Invalid DEPLOY_ENV value
echo "=== Test 2: Invalid DEPLOY_ENV ==="
export DEPLOY_ENV="prod"
run_negative_test "Invalid DEPLOY_ENV='prod' should fail" 2

export DEPLOY_ENV="stage"
run_negative_test "Invalid DEPLOY_ENV='stage' should fail" 2

export DEPLOY_ENV="development"
run_negative_test "Invalid DEPLOY_ENV='development' should fail" 2

# Test 3: Prod deploy with stage secret ARN
echo "=== Test 3: Prod deploy with stage secret ==="
export DEPLOY_ENV="production"
export DB_SECRET_ARN="arn:aws:secretsmanager:eu-central-1:123456789:secret:afu9/stage/smoke-key-abc123"
run_negative_test "Prod deploy with stage secret should fail" 1
unset DB_SECRET_ARN

# Test 4: Prod deploy with stage image tag
echo "=== Test 4: Prod deploy with stage image ==="
export DEPLOY_ENV="production"
export IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:stage-abc123"
run_negative_test "Prod deploy with stage image should fail" 1
unset IMAGE_URI

# Test 5: Prod deploy with staging service
echo "=== Test 5: Prod deploy with staging service ==="
export DEPLOY_ENV="production"
export ECS_SERVICE="afu9-control-center-staging"
run_negative_test "Prod deploy with staging service should fail" 1
unset ECS_SERVICE

# Test 6: Prod deploy with CREATE_STAGING_SERVICE=true
echo "=== Test 6: Prod deploy with CREATE_STAGING_SERVICE=true ==="
export DEPLOY_ENV="production"
export CREATE_STAGING_SERVICE="true"
run_negative_test "Prod deploy with CREATE_STAGING_SERVICE=true should fail" 1
unset CREATE_STAGING_SERVICE

# Test 7: Stage deploy with prod image tag
echo "=== Test 7: Stage deploy with prod image ==="
export DEPLOY_ENV="staging"
export IMAGE_URI="123456789.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:prod-abc123"
run_negative_test "Stage deploy with prod image should fail" 1
unset IMAGE_URI

# Test 8: Stage deploy with prod service (no "staging" in name)
echo "=== Test 8: Stage deploy with prod service ==="
export DEPLOY_ENV="staging"
export ECS_SERVICE="afu9-control-center"
run_negative_test "Stage deploy with prod service should fail" 1
unset ECS_SERVICE

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
  echo -e "${RED}Some negative tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All negative tests passed! Guardrail is working correctly.${NC}"
  exit 0
fi
