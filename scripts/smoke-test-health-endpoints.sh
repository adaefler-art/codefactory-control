#!/bin/bash

# Smoke test script for health and readiness endpoints
# Tests all MCP servers and Control Center according to Control Plane Spec v1
# Usage: ./scripts/smoke-test-health-endpoints.sh [base_url]
# Example: ./scripts/smoke-test-health-endpoints.sh http://localhost
# Example: ./scripts/smoke-test-health-endpoints.sh https://staging.example.com

set -e

# Default to localhost if no base URL provided
BASE_URL="${1:-http://localhost}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNING=0

# Function to test a health endpoint
test_health_endpoint() {
  local name="$1"
  local url="$2"
  local port="$3"
  
  echo "Testing $name health endpoint..."
  
  # Test /health endpoint
  local response=$(curl -s -w "\n%{http_code}" "$url:$port/health" 2>&1)
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "200" ]; then
    # Validate JSON response format
    local status=$(echo "$body" | jq -r '.status' 2>/dev/null)
    local service=$(echo "$body" | jq -r '.service' 2>/dev/null)
    local version=$(echo "$body" | jq -r '.version' 2>/dev/null)
    local timestamp=$(echo "$body" | jq -r '.timestamp' 2>/dev/null)
    
    if [ "$status" = "ok" ] && [ -n "$service" ] && [ -n "$version" ] && [ -n "$timestamp" ]; then
      echo -e "${GREEN}✅ $name health check passed${NC}"
      echo "   Service: $service, Version: $version"
      TESTS_PASSED=$((TESTS_PASSED + 1))
    else
      echo -e "${RED}❌ $name health check failed - invalid response format${NC}"
      echo "   Response: $body"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo -e "${RED}❌ $name health check failed - HTTP $http_code${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Function to test a readiness endpoint
test_readiness_endpoint() {
  local name="$1"
  local url="$2"
  local port="$3"
  
  echo "Testing $name readiness endpoint..."
  
  # Test /ready endpoint
  local response=$(curl -s -w "\n%{http_code}" "$url:$port/ready" 2>&1)
  local http_code=$(echo "$response" | tail -n1)
  local body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "200" ] || [ "$http_code" = "503" ]; then
    # Validate JSON response format
    local ready=$(echo "$body" | jq -r '.ready' 2>/dev/null)
    local service=$(echo "$body" | jq -r '.service' 2>/dev/null)
    local version=$(echo "$body" | jq -r '.version' 2>/dev/null)
    local timestamp=$(echo "$body" | jq -r '.timestamp' 2>/dev/null)
    local checks=$(echo "$body" | jq -r '.checks' 2>/dev/null)
    
    if [ -n "$ready" ] && [ -n "$service" ] && [ -n "$version" ] && [ -n "$timestamp" ] && [ "$checks" != "null" ]; then
      if [ "$ready" = "true" ] && [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ $name readiness check passed - service is ready${NC}"
        echo "   Service: $service, Version: $version"
        TESTS_PASSED=$((TESTS_PASSED + 1))
      elif [ "$ready" = "false" ] && [ "$http_code" = "503" ]; then
        echo -e "${YELLOW}⚠️  $name readiness check passed - service is not ready (expected in test environment)${NC}"
        echo "   Service: $service, Version: $version"
        # Show failed checks
        local errors=$(echo "$body" | jq -r '.errors[]?' 2>/dev/null)
        if [ -n "$errors" ]; then
          echo "   Errors:"
          echo "$errors" | while read -r error; do
            echo "     - $error"
          done
        fi
        TESTS_WARNING=$((TESTS_WARNING + 1))
      else
        echo -e "${RED}❌ $name readiness check failed - ready=$ready but HTTP $http_code${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
      fi
    else
      echo -e "${RED}❌ $name readiness check failed - invalid response format${NC}"
      echo "   Response: $body"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      return 1
    fi
  else
    echo -e "${RED}❌ $name readiness check failed - HTTP $http_code${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    return 1
  fi
}

# Function to test a service (both health and readiness)
test_service() {
  local name="$1"
  local url="$2"
  local port="$3"
  
  echo ""
  echo "================================================"
  echo "Testing $name ($url:$port)"
  echo "================================================"
  
  test_health_endpoint "$name" "$url" "$port"
  test_readiness_endpoint "$name" "$url" "$port"
}

# Main test execution
echo "================================================"
echo "AFU-9 Health & Readiness Smoke Tests"
echo "Control Plane Spec v1"
echo "================================================"
echo "Base URL: $BASE_URL"
echo ""

# Test Control Center
test_service "Control Center" "$BASE_URL" "3000"

# Test MCP GitHub Server
test_service "MCP GitHub Server" "$BASE_URL" "3001"

# Test MCP Deploy Server
test_service "MCP Deploy Server" "$BASE_URL" "3002"

# Test MCP Observability Server
test_service "MCP Observability Server" "$BASE_URL" "3003"

# Print summary
echo ""
echo "================================================"
echo "Test Summary"
echo "================================================"
echo -e "${GREEN}Passed:  $TESTS_PASSED${NC}"
echo -e "${YELLOW}Warning: $TESTS_WARNING${NC}"
echo -e "${RED}Failed:  $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -gt 0 ]; then
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
else
  echo -e "${GREEN}✅ All critical tests passed${NC}"
  if [ $TESTS_WARNING -gt 0 ]; then
    echo -e "${YELLOW}Note: Some services are not ready due to missing dependencies (expected in test environment)${NC}"
  fi
  exit 0
fi
