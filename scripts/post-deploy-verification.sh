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

# Configuration for retries
MAX_ATTEMPTS=30
RETRY_INTERVAL=10

echo "Fetching target groups for ALB..."
# Get ALB ARN first
ALB_ARN_OUTPUT=$(aws elbv2 describe-load-balancers \
  --region "$AWS_REGION" \
  --query "LoadBalancers[?DNSName=='$ALB_DNS'].LoadBalancerArn" \
  --output text 2>&1)
ALB_ARN_EXIT_CODE=$?

if [ $ALB_ARN_EXIT_CODE -ne 0 ]; then
  print_result "FAIL" "AWS CLI failed to describe load balancers"
  echo "Command: aws elbv2 describe-load-balancers --region $AWS_REGION --query \"LoadBalancers[?DNSName=='$ALB_DNS'].LoadBalancerArn\" --output text"
  echo "Exit code: $ALB_ARN_EXIT_CODE"
  echo "Error output: $ALB_ARN_OUTPUT"
  exit 1
fi

ALB_ARN=$(echo "$ALB_ARN_OUTPUT" | tr -d '\n')

if [ -z "$ALB_ARN" ]; then
  # Try alternative: get by name pattern
  echo "Could not find ALB by DNS name, trying by name pattern..."
  ALB_ARN_OUTPUT=$(aws elbv2 describe-load-balancers \
    --region "$AWS_REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName, 'afu9')].LoadBalancerArn" \
    --output text 2>&1)
  ALB_ARN_EXIT_CODE=$?
  
  if [ $ALB_ARN_EXIT_CODE -ne 0 ]; then
    print_result "FAIL" "AWS CLI failed to describe load balancers by name pattern"
    echo "Command: aws elbv2 describe-load-balancers --region $AWS_REGION --query \"LoadBalancers[?contains(LoadBalancerName, 'afu9')].LoadBalancerArn\" --output text"
    echo "Exit code: $ALB_ARN_EXIT_CODE"
    echo "Error output: $ALB_ARN_OUTPUT"
    exit 1
  fi
  
  ALB_ARN=$(echo "$ALB_ARN_OUTPUT" | head -1 | tr -d '\n')
fi

if [ -z "$ALB_ARN" ]; then
  print_result "FAIL" "Could not find ALB"
  exit 1
fi

echo "Found ALB: $ALB_ARN"

# Fetch target groups as JSON
TG_JSON_OUTPUT=$(aws elbv2 describe-target-groups \
  --region "$AWS_REGION" \
  --load-balancer-arn "$ALB_ARN" \
  --output json 2>&1)
TG_EXIT_CODE=$?

if [ $TG_EXIT_CODE -ne 0 ]; then
  print_result "FAIL" "Failed to fetch target groups for ALB"
  echo "Command: aws elbv2 describe-target-groups --region $AWS_REGION --load-balancer-arn $ALB_ARN --output json"
  echo "Exit code: $TG_EXIT_CODE"
  echo "Error output: $TG_JSON_OUTPUT"
  exit 1
fi

# Filter target groups based on environment
echo "Filtering for ${ENVIRONMENT^^} target groups..."
if [ "$ENVIRONMENT" = "stage" ] || [ "$ENVIRONMENT" = "staging" ]; then
  echo "Looking for target groups with 'stage' in the name..."
  FILTERED_TG_ARNS_OUTPUT=$(echo "$TG_JSON_OUTPUT" | jq -r '.TargetGroups[] | select(.TargetGroupName | contains("stage")) | .TargetGroupArn' 2>&1)
  JQ_EXIT_CODE=$?
  if [ $JQ_EXIT_CODE -ne 0 ]; then
    print_result "FAIL" "Failed to parse target groups JSON with jq"
    echo "jq exit code: $JQ_EXIT_CODE"
    echo "jq error: $FILTERED_TG_ARNS_OUTPUT"
    exit 1
  fi
  FILTERED_TG_ARNS="$FILTERED_TG_ARNS_OUTPUT"
  ENV_LABEL="stage"
elif [ "$ENVIRONMENT" = "prod" ] || [ "$ENVIRONMENT" = "production" ]; then
  echo "Looking for target groups named 'afu9-tg' or containing 'prod'..."
  FILTERED_TG_ARNS_OUTPUT=$(echo "$TG_JSON_OUTPUT" | jq -r '.TargetGroups[] | select((.TargetGroupName == "afu9-tg") or (.TargetGroupName | contains("prod"))) | .TargetGroupArn' 2>&1)
  JQ_EXIT_CODE=$?
  if [ $JQ_EXIT_CODE -ne 0 ]; then
    print_result "FAIL" "Failed to parse target groups JSON with jq"
    echo "jq exit code: $JQ_EXIT_CODE"
    echo "jq error: $FILTERED_TG_ARNS_OUTPUT"
    exit 1
  fi
  FILTERED_TG_ARNS="$FILTERED_TG_ARNS_OUTPUT"
  ENV_LABEL="prod"
else
  echo "Warning: Unknown environment '$ENVIRONMENT', checking all target groups..."
  FILTERED_TG_ARNS_OUTPUT=$(echo "$TG_JSON_OUTPUT" | jq -r '.TargetGroups[].TargetGroupArn' 2>&1)
  JQ_EXIT_CODE=$?
  if [ $JQ_EXIT_CODE -ne 0 ]; then
    print_result "FAIL" "Failed to parse target groups JSON with jq"
    echo "jq exit code: $JQ_EXIT_CODE"
    echo "jq error: $FILTERED_TG_ARNS_OUTPUT"
    exit 1
  fi
  FILTERED_TG_ARNS="$FILTERED_TG_ARNS_OUTPUT"
  ENV_LABEL="$ENVIRONMENT"
fi

if [ -z "$FILTERED_TG_ARNS" ]; then
  print_result "FAIL" "No target groups found for environment '$ENV_LABEL'"
  echo "Available target groups:"
  echo "$TG_JSON_OUTPUT" | jq -r '.TargetGroups[] | "  - \(.TargetGroupName) (\(.TargetGroupArn))"' 2>/dev/null || echo "  Could not parse target groups"
  exit 1
fi

# Count target groups properly (handles single line without newline)
if [ -n "$FILTERED_TG_ARNS" ]; then
  TG_COUNT=$(echo "$FILTERED_TG_ARNS" | grep -c '^')
else
  TG_COUNT=0
fi

echo "Matched $TG_COUNT target group(s) for environment '$ENV_LABEL'"
if [ $TG_COUNT -gt 0 ]; then
  echo "Target groups to check:"
  echo "$FILTERED_TG_ARNS" | while IFS= read -r tg; do
    echo "  - $tg"
  done
fi

ALL_HEALTHY=true
for TG_ARN in $FILTERED_TG_ARNS; do
  echo ""
  echo "Checking target group: $TG_ARN"
  
  # Retry loop for checking target health
  ATTEMPT=1
  TARGETS_HEALTHY=false
  
  while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    TARGET_HEALTH_OUTPUT=$(aws elbv2 describe-target-health \
      --target-group-arn "$TG_ARN" \
      --region "$AWS_REGION" \
      --output json 2>&1)
    TARGET_HEALTH_EXIT_CODE=$?
    
    if [ $TARGET_HEALTH_EXIT_CODE -ne 0 ]; then
      print_result "FAIL" "Failed to fetch target health for $TG_ARN"
      echo "Command: aws elbv2 describe-target-health --target-group-arn $TG_ARN --region $AWS_REGION --output json"
      echo "Exit code: $TARGET_HEALTH_EXIT_CODE"
      echo "Error output: $TARGET_HEALTH_OUTPUT"
      ALL_HEALTHY=false
      break
    fi
    
    # Count healthy vs unhealthy targets
    TOTAL_TARGETS_OUTPUT=$(echo "$TARGET_HEALTH_OUTPUT" | jq -r '.TargetHealthDescriptions | length' 2>&1)
    TOTAL_TARGETS_EXIT=$?
    if [ $TOTAL_TARGETS_EXIT -ne 0 ]; then
      print_result "FAIL" "Failed to parse target health JSON"
      echo "jq error: $TOTAL_TARGETS_OUTPUT"
      ALL_HEALTHY=false
      break
    fi
    TOTAL_TARGETS="$TOTAL_TARGETS_OUTPUT"
    
    HEALTHY_TARGETS_OUTPUT=$(echo "$TARGET_HEALTH_OUTPUT" | jq -r '[.TargetHealthDescriptions[] | select(.TargetHealth.State == "healthy")] | length' 2>&1)
    HEALTHY_TARGETS_EXIT=$?
    if [ $HEALTHY_TARGETS_EXIT -ne 0 ]; then
      print_result "FAIL" "Failed to parse healthy targets from JSON"
      echo "jq error: $HEALTHY_TARGETS_OUTPUT"
      ALL_HEALTHY=false
      break
    fi
    HEALTHY_TARGETS="$HEALTHY_TARGETS_OUTPUT"
    
    UNHEALTHY_TARGETS_OUTPUT=$(echo "$TARGET_HEALTH_OUTPUT" | jq -r '[.TargetHealthDescriptions[] | select(.TargetHealth.State != "healthy")] | length' 2>&1)
    UNHEALTHY_TARGETS_EXIT=$?
    if [ $UNHEALTHY_TARGETS_EXIT -ne 0 ]; then
      print_result "FAIL" "Failed to parse unhealthy targets from JSON"
      echo "jq error: $UNHEALTHY_TARGETS_OUTPUT"
      ALL_HEALTHY=false
      break
    fi
    UNHEALTHY_TARGETS="$UNHEALTHY_TARGETS_OUTPUT"
    
    echo "[Attempt $ATTEMPT/$MAX_ATTEMPTS] Targets: $HEALTHY_TARGETS healthy, $UNHEALTHY_TARGETS unhealthy (total: $TOTAL_TARGETS)"
    
    # Check if we have healthy targets
    if [ "$TOTAL_TARGETS" -gt 0 ] && [ "$UNHEALTHY_TARGETS" -eq 0 ]; then
      # All targets are healthy
      print_result "PASS" "All $HEALTHY_TARGETS target(s) are healthy"
      TARGETS_HEALTHY=true
      break
    elif [ "$TOTAL_TARGETS" -eq 0 ]; then
      # No targets registered yet - retry
      if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        print_result "FAIL" "No targets registered in target group after $MAX_ATTEMPTS attempts"
        ALL_HEALTHY=false
        break
      fi
      echo "  No targets registered yet, retrying in $RETRY_INTERVAL seconds..."
      sleep $RETRY_INTERVAL
      ATTEMPT=$((ATTEMPT + 1))
    else
      # Some targets are unhealthy - retry
      if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
        print_result "FAIL" "Found $UNHEALTHY_TARGETS unhealthy target(s) after $MAX_ATTEMPTS attempts"
        ALL_HEALTHY=false
        
        # Show details of unhealthy targets
        echo "Unhealthy target details:"
        UNHEALTHY_DETAILS=$(echo "$TARGET_HEALTH_OUTPUT" | jq -r '.TargetHealthDescriptions[] | select(.TargetHealth.State != "healthy") | "  Target: \(.Target.Id):\(.Target.Port) - State: \(.TargetHealth.State) - Reason: \(.TargetHealth.Reason // "N/A") - Description: \(.TargetHealth.Description // "N/A")"' 2>&1)
        UNHEALTHY_JQ_EXIT=$?
        if [ $UNHEALTHY_JQ_EXIT -ne 0 ]; then
          echo "  Error parsing unhealthy target details with jq (exit code: $UNHEALTHY_JQ_EXIT)"
          echo "  jq error: $UNHEALTHY_DETAILS"
        else
          echo "$UNHEALTHY_DETAILS"
        fi
        break
      fi
      echo "  Unhealthy targets detected, retrying in $RETRY_INTERVAL seconds..."
      sleep $RETRY_INTERVAL
      ATTEMPT=$((ATTEMPT + 1))
    fi
  done
  
  if [ "$TARGETS_HEALTHY" = false ]; then
    ALL_HEALTHY=false
  fi
done

if [ "$ALL_HEALTHY" = true ]; then
  print_result "PASS" "All ALB targets are healthy for environment '$ENV_LABEL'"
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
