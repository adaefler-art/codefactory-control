#!/bin/bash
set -euo pipefail

# AFU-9 Post-Deployment Verification Script
# 
# Automated verification checks after ECS deployment:
# - ECS service events (no Circuit Breaker issues)
# - ALB target health (all targets healthy)
# - Health endpoints (/api/health)
# - Readiness endpoints (/api/ready)
#
# All checks are deterministic with clear error messages.
#
# Usage:
#   ./scripts/post-deploy-verification.sh <environment> <cluster-name> <service-name> <alb-dns>
#   ./scripts/post-deploy-verification.sh stage afu9-cluster afu9-control-center-stage afu9-alb-123.eu-central-1.elb.amazonaws.com
#
# Or with environment variables:
#   ENVIRONMENT=stage \
#   ECS_CLUSTER=afu9-cluster \
#   ECS_SERVICE=afu9-control-center-stage \
#   ALB_DNS=afu9-alb-123.eu-central-1.elb.amazonaws.com \
#   ./scripts/post-deploy-verification.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get parameters from arguments or environment variables
ENVIRONMENT=${1:-${ENVIRONMENT:-}}
ECS_CLUSTER=${2:-${ECS_CLUSTER:-}}
ECS_SERVICE=${3:-${ECS_SERVICE:-}}
ALB_DNS=${4:-${ALB_DNS:-}}
AWS_REGION=${AWS_REGION:-eu-central-1}

# Validate required parameters
if [ -z "$ENVIRONMENT" ] || [ -z "$ECS_CLUSTER" ] || [ -z "$ECS_SERVICE" ] || [ -z "$ALB_DNS" ]; then
  echo -e "${RED}ERROR: Missing required parameters${NC}"
  echo ""
  echo "Usage: $0 <environment> <cluster-name> <service-name> <alb-dns>"
  echo ""
  echo "Example:"
  echo "  $0 stage afu9-cluster afu9-control-center-stage afu9-alb-123.eu-central-1.elb.amazonaws.com"
  echo ""
  echo "Or use environment variables:"
  echo "  ENVIRONMENT=stage ECS_CLUSTER=afu9-cluster ECS_SERVICE=afu9-control-center-stage ALB_DNS=... $0"
  exit 1
fi

BASE_URL="http://${ALB_DNS}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AFU-9 Post-Deployment Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Environment:   ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "ECS Cluster:   ${YELLOW}${ECS_CLUSTER}${NC}"
echo -e "ECS Service:   ${YELLOW}${ECS_SERVICE}${NC}"
echo -e "ALB DNS:       ${YELLOW}${ALB_DNS}${NC}"
echo -e "Base URL:      ${YELLOW}${BASE_URL}${NC}"
echo -e "AWS Region:    ${YELLOW}${AWS_REGION}${NC}"
echo ""

# Counter for passed/failed tests
PASSED=0
FAILED=0
WARNINGS=0

# Helper function to print section header
print_section() {
  echo ""
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}========================================${NC}"
}

# Helper function to print test result
print_result() {
  local status=$1
  local message=$2
  
  if [ "$status" == "PASS" ]; then
    echo -e "${GREEN}✅ PASS:${NC} $message"
    PASSED=$((PASSED + 1))
  elif [ "$status" == "FAIL" ]; then
    echo -e "${RED}❌ FAIL:${NC} $message"
    FAILED=$((FAILED + 1))
  elif [ "$status" == "WARN" ]; then
    echo -e "${YELLOW}⚠️  WARN:${NC} $message"
    WARNINGS=$((WARNINGS + 1))
  fi
}

# ========================================
# Check 1: ECS Service Events
# ========================================
print_section "Check 1: ECS Service Events"

echo "Fetching ECS service events..."
SERVICE_EVENTS=$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" \
  --query 'services[0].events[0:10]' \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  print_result "FAIL" "Failed to fetch ECS service events"
  echo "Error: $SERVICE_EVENTS"
else
  # Check for Circuit Breaker issues
  CIRCUIT_BREAKER_ERRORS=$(echo "$SERVICE_EVENTS" | jq -r '.[] | select(.message | contains("circuit breaker") or contains("CIRCUIT_BREAKER")) | .message' 2>/dev/null || echo "")
  
  if [ -n "$CIRCUIT_BREAKER_ERRORS" ]; then
    print_result "FAIL" "Circuit Breaker issues detected in service events"
    echo "Circuit Breaker Errors:"
    echo "$CIRCUIT_BREAKER_ERRORS"
  else
    print_result "PASS" "No Circuit Breaker issues in service events"
  fi
  
  # Check for other error keywords
  ERROR_KEYWORDS="(ERROR|FAILED|UNHEALTHY|STOPPED)"
  ERROR_EVENTS=$(echo "$SERVICE_EVENTS" | jq -r ".[] | select(.message | test(\"$ERROR_KEYWORDS\"; \"i\")) | .message" 2>/dev/null || echo "")
  
  if [ -n "$ERROR_EVENTS" ]; then
    print_result "WARN" "Error keywords found in recent service events"
    echo "Recent error events (last 10):"
    echo "$ERROR_EVENTS" | head -5
  else
    print_result "PASS" "No error keywords in recent service events"
  fi
  
  # Show latest event for context
  LATEST_EVENT=$(echo "$SERVICE_EVENTS" | jq -r '.[0].message' 2>/dev/null || echo "")
  echo "Latest event: $LATEST_EVENT"
fi

# ========================================
# Check 2: ALB Target Health
# ========================================
print_section "Check 2: ALB Target Health"

echo "Fetching target groups for ALB..."
# Get ALB ARN first
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --region "$AWS_REGION" \
  --query "LoadBalancers[?DNSName=='$ALB_DNS'].LoadBalancerArn" \
  --output text 2>/dev/null || echo "")

if [ -z "$ALB_ARN" ]; then
  # Try alternative: get by name pattern
  echo "Could not find ALB by DNS name, trying by name pattern..."
  ALB_ARN=$(aws elbv2 describe-load-balancers \
    --region "$AWS_REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName, 'afu9')].LoadBalancerArn" \
    --output text 2>/dev/null | head -1 || echo "")
fi

if [ -z "$ALB_ARN" ]; then
  print_result "FAIL" "Could not find ALB"
  TARGET_GROUPS=""
else
  echo "Found ALB: $ALB_ARN"
  TARGET_GROUPS=$(aws elbv2 describe-target-groups \
    --region "$AWS_REGION" \
    --load-balancer-arn "$ALB_ARN" \
    --query "TargetGroups[].TargetGroupArn" \
    --output text 2>&1)
  
  if [ $? -ne 0 ]; then
    print_result "FAIL" "Failed to fetch target groups for ALB"
    TARGET_GROUPS=""
  fi
fi

if [ -z "$TARGET_GROUPS" ]; then
  print_result "FAIL" "Could not find target groups for ALB"
else
  echo "Found target groups: $TARGET_GROUPS"
  
  ALL_HEALTHY=true
  for TG_ARN in $TARGET_GROUPS; do
    echo ""
    echo "Checking target group: $TG_ARN"
    
    TARGET_HEALTH=$(aws elbv2 describe-target-health \
      --target-group-arn "$TG_ARN" \
      --region "$AWS_REGION" \
      --output json 2>&1)
    
    if [ $? -ne 0 ]; then
      print_result "FAIL" "Failed to fetch target health for $TG_ARN"
      ALL_HEALTHY=false
      continue
    fi
    
    # Count healthy vs unhealthy targets
    TOTAL_TARGETS=$(echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions | length' 2>/dev/null || echo "0")
    HEALTHY_TARGETS=$(echo "$TARGET_HEALTH" | jq -r '[.TargetHealthDescriptions[] | select(.TargetHealth.State == "healthy")] | length' 2>/dev/null || echo "0")
    UNHEALTHY_TARGETS=$(echo "$TARGET_HEALTH" | jq -r '[.TargetHealthDescriptions[] | select(.TargetHealth.State != "healthy")] | length' 2>/dev/null || echo "0")
    
    echo "Targets: $HEALTHY_TARGETS healthy, $UNHEALTHY_TARGETS unhealthy (total: $TOTAL_TARGETS)"
    
    if [ "$UNHEALTHY_TARGETS" -gt 0 ]; then
      print_result "FAIL" "Found $UNHEALTHY_TARGETS unhealthy target(s)"
      ALL_HEALTHY=false
      
      # Show details of unhealthy targets
      echo "Unhealthy target details:"
      echo "$TARGET_HEALTH" | jq -r '.TargetHealthDescriptions[] | select(.TargetHealth.State != "healthy") | "  Target: \(.Target.Id):\(.Target.Port) - State: \(.TargetHealth.State) - Reason: \(.TargetHealth.Reason // "N/A") - Description: \(.TargetHealth.Description // "N/A")"' 2>/dev/null || echo "  Could not parse target details"
    elif [ "$HEALTHY_TARGETS" -gt 0 ]; then
      print_result "PASS" "All $HEALTHY_TARGETS target(s) are healthy"
    else
      print_result "WARN" "No targets registered in target group"
      ALL_HEALTHY=false
    fi
  done
  
  if [ "$ALL_HEALTHY" = true ]; then
    print_result "PASS" "All ALB targets are healthy (green)"
  fi
fi

# ========================================
# Check 3: Service Stability
# ========================================
print_section "Check 3: Service Stability"

echo "Checking ECS service stability..."
SERVICE_STATUS=$(aws ecs describe-services \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" \
  --query 'services[0].{status:status,runningCount:runningCount,desiredCount:desiredCount,pendingCount:pendingCount}' \
  --output json 2>&1)

if [ $? -ne 0 ]; then
  print_result "FAIL" "Failed to fetch service status"
  echo "Error: $SERVICE_STATUS"
else
  STATUS=$(echo "$SERVICE_STATUS" | jq -r '.status' 2>/dev/null || echo "UNKNOWN")
  RUNNING=$(echo "$SERVICE_STATUS" | jq -r '.runningCount' 2>/dev/null || echo "0")
  DESIRED=$(echo "$SERVICE_STATUS" | jq -r '.desiredCount' 2>/dev/null || echo "0")
  PENDING=$(echo "$SERVICE_STATUS" | jq -r '.pendingCount' 2>/dev/null || echo "0")
  
  echo "Service Status: $STATUS"
  echo "Running Tasks: $RUNNING / $DESIRED (desired)"
  echo "Pending Tasks: $PENDING"
  
  if [ "$STATUS" != "ACTIVE" ]; then
    print_result "FAIL" "Service status is $STATUS (expected ACTIVE)"
  elif [ "$RUNNING" -ne "$DESIRED" ]; then
    print_result "FAIL" "Running tasks ($RUNNING) do not match desired count ($DESIRED)"
  elif [ "$PENDING" -gt 0 ]; then
    print_result "WARN" "Service has $PENDING pending tasks"
  else
    print_result "PASS" "Service is stable with $RUNNING/$DESIRED tasks running"
  fi
fi

# ========================================
# Check 4: Health Endpoint
# ========================================
print_section "Check 4: Health Endpoint (/api/health)"

echo "Testing health endpoint: ${BASE_URL}/api/health"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/health" 2>/dev/null || echo -e "\n000")
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n-1)

if [ "$HEALTH_CODE" == "200" ]; then
  # Validate response format
  HEALTH_STATUS=$(echo "$HEALTH_BODY" | jq -r '.status' 2>/dev/null || echo "")
  SERVICE_NAME=$(echo "$HEALTH_BODY" | jq -r '.service' 2>/dev/null || echo "")
  VERSION=$(echo "$HEALTH_BODY" | jq -r '.version' 2>/dev/null || echo "")
  
  if [ "$HEALTH_STATUS" == "ok" ] && [ -n "$SERVICE_NAME" ] && [ -n "$VERSION" ]; then
    print_result "PASS" "Health endpoint returned 200 OK with valid response"
    echo "Service: $SERVICE_NAME, Version: $VERSION"
  else
    print_result "FAIL" "Health endpoint returned 200 but with invalid format"
    echo "Response: $HEALTH_BODY"
  fi
else
  print_result "FAIL" "Health endpoint returned HTTP $HEALTH_CODE (expected 200)"
  echo "Response: $HEALTH_BODY"
fi

# ========================================
# Check 5: Readiness Endpoint
# ========================================
print_section "Check 5: Readiness Endpoint (/api/ready)"

echo "Testing readiness endpoint: ${BASE_URL}/api/ready"
READY_RESPONSE=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/ready" 2>/dev/null || echo -e "\n000")
READY_CODE=$(echo "$READY_RESPONSE" | tail -n1)
READY_BODY=$(echo "$READY_RESPONSE" | head -n-1)

if [ "$READY_CODE" == "200" ]; then
  # Validate response format
  READY_STATUS=$(echo "$READY_BODY" | jq -r '.ready' 2>/dev/null || echo "")
  SERVICE_NAME=$(echo "$READY_BODY" | jq -r '.service' 2>/dev/null || echo "")
  
  if [ "$READY_STATUS" == "true" ] && [ -n "$SERVICE_NAME" ]; then
    print_result "PASS" "Readiness endpoint returned 200 OK - service is ready"
    echo "Service: $SERVICE_NAME"
    
    # Show dependency check results
    CHECKS=$(echo "$READY_BODY" | jq -r '.checks | to_entries[] | "\(.key): \(.value.status)"' 2>/dev/null || echo "")
    if [ -n "$CHECKS" ]; then
      echo "Dependency checks:"
      echo "$CHECKS" | while IFS= read -r line; do
        echo "  - $line"
      done
    fi
  else
    print_result "FAIL" "Readiness endpoint returned 200 but service not ready or invalid format"
    echo "Response: $READY_BODY"
  fi
elif [ "$READY_CODE" == "503" ]; then
  print_result "FAIL" "Readiness endpoint returned 503 - service not ready"
  
  # Show error details
  ERRORS=$(echo "$READY_BODY" | jq -r '.errors[]?' 2>/dev/null || echo "")
  if [ -n "$ERRORS" ]; then
    echo "Errors:"
    echo "$ERRORS" | while IFS= read -r line; do
      echo "  - $line"
    done
  fi
  
  # Show failed checks
  FAILED_CHECKS=$(echo "$READY_BODY" | jq -r '.checks | to_entries[] | select(.value.status == "error") | "\(.key): \(.value.message // "no message")"' 2>/dev/null || echo "")
  if [ -n "$FAILED_CHECKS" ]; then
    echo "Failed checks:"
    echo "$FAILED_CHECKS" | while IFS= read -r line; do
      echo "  - $line"
    done
  fi
else
  print_result "FAIL" "Readiness endpoint returned HTTP $READY_CODE (expected 200 or 503)"
  echo "Response: $READY_BODY"
fi

# ========================================
# Summary
# ========================================
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Passed:   $PASSED${NC}"
echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
echo -e "${RED}Failed:   $FAILED${NC}"
echo -e "Total:    $((PASSED + WARNINGS + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ POST-DEPLOYMENT VERIFICATION PASSED${NC}"
  echo ""
  echo "All critical checks passed. Deployment is successful."
  if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Note: Some warnings were found. Review them above.${NC}"
  fi
  exit 0
else
  echo -e "${RED}❌ POST-DEPLOYMENT VERIFICATION FAILED${NC}"
  echo ""
  echo "Deployment verification failed with $FAILED error(s)."
  echo "Review the failed checks above and investigate the issues."
  echo ""
  echo "Common troubleshooting steps:"
  echo "  1. Check ECS service logs: aws logs tail /ecs/afu9-control-center --follow"
  echo "  2. Check task status: aws ecs describe-tasks --cluster $ECS_CLUSTER --tasks <task-id>"
  echo "  3. Check target health: aws elbv2 describe-target-health --target-group-arn <tg-arn>"
  echo "  4. Review deployment events in ECS console"
  exit 1
fi
