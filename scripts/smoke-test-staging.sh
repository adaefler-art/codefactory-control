#!/bin/bash
set -e

# AFU-9 Staging Smoke Tests
# 
# Validates that a deployed staging environment is functional by testing:
# - Health endpoint accessibility
# - Readiness endpoint functionality
# - ALB routing
# - Basic service availability
#
# Usage:
#   ./scripts/smoke-test-staging.sh <ALB_DNS_NAME>
#   ./scripts/smoke-test-staging.sh afu9-alb-1234567890.eu-central-1.elb.amazonaws.com
#
# Or use CloudFormation output:
#   ALB_DNS=$(aws cloudformation describe-stacks \
#     --stack-name Afu9NetworkStack \
#     --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
#     --output text)
#   ./scripts/smoke-test-staging.sh $ALB_DNS

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get ALB DNS from argument or CloudFormation
ALB_DNS=${1:-}

if [ -z "$ALB_DNS" ]; then
  echo -e "${YELLOW}No ALB DNS provided, attempting to fetch from CloudFormation...${NC}"
  ALB_DNS=$(aws cloudformation describe-stacks \
    --stack-name Afu9NetworkStack \
    --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$ALB_DNS" ]; then
    echo -e "${RED}ERROR: Could not determine ALB DNS name${NC}"
    echo "Usage: $0 <ALB_DNS_NAME>"
    echo "Example: $0 afu9-alb-1234567890.eu-central-1.elb.amazonaws.com"
    exit 1
  fi
fi

BASE_URL="http://${ALB_DNS}"
echo -e "${GREEN}Testing AFU-9 Staging Environment${NC}"
echo -e "Base URL: ${BASE_URL}\n"

# Counter for passed/failed tests
PASSED=0
FAILED=0

# Helper function to run a test
run_test() {
  local test_name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local check_body="${4:-}"
  
  echo -n "Testing ${test_name}... "
  
  # Make the request and capture response
  response=$(curl -s -w "\n%{http_code}" "$url" 2>/dev/null || echo "000")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)
  
  # Check HTTP status
  if [ "$http_code" != "$expected_status" ]; then
    echo -e "${RED}FAILED${NC} (HTTP $http_code, expected $expected_status)"
    FAILED=$((FAILED + 1))
    return 1
  fi
  
  # Check body content if specified
  if [ -n "$check_body" ]; then
    if echo "$body" | grep -q "$check_body"; then
      echo -e "${GREEN}PASSED${NC}"
      PASSED=$((PASSED + 1))
      return 0
    else
      echo -e "${RED}FAILED${NC} (body check failed)"
      echo "Expected to find: $check_body"
      echo "Body: $body"
      FAILED=$((FAILED + 1))
      return 1
    fi
  fi
  
  echo -e "${GREEN}PASSED${NC}"
  PASSED=$((PASSED + 1))
  return 0
}

# Run smoke tests
echo "=== Smoke Tests ==="
echo ""

# Test 1: Health endpoint
run_test "Health endpoint" "${BASE_URL}/api/health" 200 "ok"

# Test 2: Readiness endpoint
run_test "Readiness endpoint" "${BASE_URL}/api/ready" 200 "ready"

# Test 3: Root page (should return Next.js app)
run_test "Root page" "${BASE_URL}/" 200

# Test 4: Check service identification in health response
echo -n "Verifying service identity... "
health_response=$(curl -s "${BASE_URL}/api/health" 2>/dev/null || echo "{}")
if echo "$health_response" | grep -q "afu9-control-center"; then
  echo -e "${GREEN}PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}FAILED${NC}"
  echo "Response: $health_response"
  FAILED=$((FAILED + 1))
fi

# Test 5: Check version in response
echo -n "Verifying version info... "
if echo "$health_response" | grep -q "version"; then
  echo -e "${GREEN}PASSED${NC}"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}FAILED${NC}"
  FAILED=$((FAILED + 1))
fi

# Summary
echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo -e "Total:  $((PASSED + FAILED))"

if [ $FAILED -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✓ All smoke tests passed!${NC}"
  echo -e "${GREEN}✓ Staging environment is operational${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}✗ Some tests failed${NC}"
  echo -e "${YELLOW}Check the deployment logs and ECS task status${NC}"
  exit 1
fi
