#!/bin/bash
# Smoke test script for AFU-9 services
# Usage: ./scripts/smoke-test.sh {staging|production|local}

set -e

ENVIRONMENT=$1

# Determine BASE_URL based on environment
if [ "$ENVIRONMENT" == "local" ]; then
  BASE_URL="http://localhost:3000"
  API_TOKEN="${AFU9_API_TOKEN:-test-token}"
elif [ "$ENVIRONMENT" == "staging" ]; then
  ALB_DNS=$(aws elbv2 describe-load-balancers \
    --names afu9-staging-alb \
    --query 'LoadBalancers[0].DNSName' \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$ALB_DNS" ]; then
    echo "❌ Could not find staging ALB"
    exit 1
  fi
  BASE_URL="http://${ALB_DNS}"
  API_TOKEN="${AFU9_STAGING_API_TOKEN}"
elif [ "$ENVIRONMENT" == "production" ]; then
  BASE_URL="https://afu9.example.com"
  API_TOKEN="${AFU9_PRODUCTION_API_TOKEN}"
else
  echo "Usage: $0 {staging|production|local}"
  exit 1
fi

echo "=== AFU-9 Smoke Tests ==="
echo "Environment: $ENVIRONMENT"
echo "Base URL: $BASE_URL"
echo ""

FAILED=0

# Test 1: Homepage accessible
echo "Test 1: Homepage accessibility..."
if curl -sf "${BASE_URL}" > /dev/null 2>&1; then
  echo "✅ Homepage accessible"
else
  echo "❌ Homepage not accessible"
  FAILED=$((FAILED + 1))
fi

# Test 2: API Health endpoint
echo "Test 2: API Health endpoint..."
HEALTH=$(curl -s "${BASE_URL}/api/health" | jq -r '.status' 2>/dev/null || echo "error")
if [ "$HEALTH" == "ok" ]; then
  echo "✅ API Health OK"
else
  echo "❌ API Health failed: $HEALTH"
  FAILED=$((FAILED + 1))
fi

# Test 3: API Readiness endpoint
echo "Test 3: API Readiness endpoint..."
READY=$(curl -s "${BASE_URL}/api/ready" | jq -r '.ready' 2>/dev/null || echo "false")
if [ "$READY" == "true" ]; then
  echo "✅ API Ready"
else
  echo "❌ API not ready"
  FAILED=$((FAILED + 1))
fi

# Test 4: MCP Servers Health
if [ "$ENVIRONMENT" != "local" ]; then
  echo "Test 4: MCP Servers Health..."
  MCP_HEALTH=$(curl -s "${BASE_URL}/api/mcp/health" | jq -r '.status' 2>/dev/null || echo "error")
  if [ "$MCP_HEALTH" == "healthy" ]; then
    echo "✅ MCP Servers healthy"
  else
    echo "❌ MCP Servers not healthy: $MCP_HEALTH"
    FAILED=$((FAILED + 1))
  fi
fi

# Test 5: Workflow API (requires authentication)
if [ -n "$API_TOKEN" ]; then
  echo "Test 5: Workflow API..."
  WORKFLOWS=$(curl -s "${BASE_URL}/api/workflows" \
    -H "Authorization: Bearer $API_TOKEN" 2>/dev/null || echo "{}")
  
  if echo "$WORKFLOWS" | jq -e '.workflows' > /dev/null 2>&1; then
    echo "✅ Workflow API working"
  elif echo "$WORKFLOWS" | jq -e '.error' > /dev/null 2>&1; then
    echo "⚠️  Workflow API returned error (may be auth issue)"
  else
    echo "❌ Workflow API failed"
    FAILED=$((FAILED + 1))
  fi
else
  echo "Test 5: Workflow API... ⏭️ Skipped (no API token)"
fi

# Summary
echo ""
echo "=== Smoke Test Summary ==="
if [ $FAILED -eq 0 ]; then
  echo "✅ All smoke tests passed!"
  exit 0
else
  echo "❌ $FAILED test(s) failed"
  exit 1
fi
