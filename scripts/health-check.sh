#!/bin/bash
# Health check script for AFU-9 services
# Usage: ./scripts/health-check.sh {staging|production|local} [wait-time]

set -e

ENVIRONMENT=$1
WAIT_TIME=${2:-60}  # Default 60 seconds

# Determine ALB DNS based on environment
if [ "$ENVIRONMENT" == "local" ]; then
  BASE_URL="http://localhost:3000"
elif [ "$ENVIRONMENT" == "staging" ]; then
  # Get ALB DNS from AWS
  ALB_DNS=$(aws elbv2 describe-load-balancers \
    --names afu9-staging-alb \
    --query 'LoadBalancers[0].DNSName' \
    --output text 2>/dev/null || echo "")
  
  if [ -z "$ALB_DNS" ]; then
    echo "❌ Could not find staging ALB"
    exit 1
  fi
  BASE_URL="http://${ALB_DNS}"
elif [ "$ENVIRONMENT" == "production" ]; then
  # For production, use the custom domain if configured
  BASE_URL="https://afu9.example.com"
else
  echo "Usage: $0 {staging|production|local} [wait-time]"
  echo ""
  echo "Examples:"
  echo "  $0 local          # Check local development environment"
  echo "  $0 staging 120    # Check staging with 120s wait time"
  echo "  $0 production     # Check production environment"
  exit 1
fi

echo "=== AFU-9 Health Check ==="
echo "Environment: $ENVIRONMENT"
echo "Base URL: $BASE_URL"
echo "Wait time: ${WAIT_TIME}s"
echo ""

if [ "$ENVIRONMENT" != "local" ]; then
  echo "Waiting ${WAIT_TIME}s for services to stabilize..."
  sleep $WAIT_TIME
fi

FAILED=0

# Health Check: Control Center
echo "Checking Control Center health..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health")
if [ "$RESPONSE" == "200" ]; then
  echo "✅ Control Center is healthy (HTTP 200)"
else
  echo "❌ Control Center health check failed: HTTP $RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Readiness Check: Control Center
echo "Checking Control Center readiness..."
READY_RESPONSE=$(curl -s "${BASE_URL}/api/ready")
READY_STATUS=$(echo "$READY_RESPONSE" | jq -r '.ready' 2>/dev/null || echo "unknown")

if [ "$READY_STATUS" == "true" ]; then
  echo "✅ Control Center is ready"
else
  echo "❌ Control Center not ready"
  echo "Response:"
  echo "$READY_RESPONSE" | jq . 2>/dev/null || echo "$READY_RESPONSE"
  FAILED=$((FAILED + 1))
fi

# Check MCP Servers health (via Control Center)
if [ "$ENVIRONMENT" != "local" ]; then
  echo "Checking MCP servers..."
  MCP_RESPONSE=$(curl -s "${BASE_URL}/api/mcp/health")
  MCP_STATUS=$(echo "$MCP_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
  
  if [ "$MCP_STATUS" == "healthy" ]; then
    echo "✅ All MCP servers are healthy"
  else
    echo "❌ MCP servers not healthy"
    echo "Response:"
    echo "$MCP_RESPONSE" | jq . 2>/dev/null || echo "$MCP_RESPONSE"
    FAILED=$((FAILED + 1))
  fi
else
  echo "Skipping MCP server checks for local environment"
fi

# Summary
echo ""
echo "=== Health Check Summary ==="
if [ $FAILED -eq 0 ]; then
  echo "✅ All health checks passed!"
  exit 0
else
  echo "❌ $FAILED check(s) failed"
  exit 1
fi
