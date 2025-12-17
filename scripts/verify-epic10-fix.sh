#!/bin/bash
# EPIC-10 Deployment Verification Script
# Usage: ./scripts/verify-epic10-fix.sh [cluster-name] [service-name]

set -e

CLUSTER=${1:-afu9-cluster}
SERVICE=${2:-afu9-control-center-stage}
REGION=${AWS_REGION:-eu-central-1}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "EPIC-10 Deployment Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cluster: $CLUSTER"
echo "Service: $SERVICE"
echo "Region: $REGION"
echo ""

# Step 1: Check service status
echo "📋 Step 1: Checking service status..."
SERVICE_STATUS=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION" \
  --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount}' \
  --output json)

echo "$SERVICE_STATUS" | jq .

DESIRED=$(echo "$SERVICE_STATUS" | jq -r '.DesiredCount')
RUNNING=$(echo "$SERVICE_STATUS" | jq -r '.RunningCount')

if [ "$DESIRED" -eq "$RUNNING" ]; then
  echo "✅ Service is stable: $RUNNING/$DESIRED tasks running"
else
  echo "⚠️  Service is not stable: $RUNNING/$DESIRED tasks running"
fi
echo ""

# Step 2: Check for circuit breaker events
echo "🔍 Step 2: Checking for circuit breaker events (last 10 events)..."
EVENTS=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION" \
  --query 'services[0].events[:10]' \
  --output json)

CIRCUIT_BREAKER_COUNT=$(echo "$EVENTS" | jq '[.[] | select(.message | contains("circuit breaker"))] | length')

if [ "$CIRCUIT_BREAKER_COUNT" -eq 0 ]; then
  echo "✅ No circuit breaker events found"
else
  echo "⚠️  Found $CIRCUIT_BREAKER_COUNT circuit breaker event(s)"
  echo "$EVENTS" | jq '.[] | select(.message | contains("circuit breaker"))'
fi
echo ""

# Step 3: Check stopped tasks
echo "🔍 Step 3: Checking for stopped tasks with secret errors..."
STOPPED_TASKS=$(aws ecs list-tasks \
  --cluster "$CLUSTER" \
  --service-name "$SERVICE" \
  --desired-status STOPPED \
  --region "$REGION" \
  --max-items 5 \
  --query 'taskArns' \
  --output text)

if [ -z "$STOPPED_TASKS" ]; then
  echo "✅ No stopped tasks found"
else
  echo "⚠️  Found stopped tasks, checking for secret errors..."
  for TASK_ARN in $STOPPED_TASKS; do
    TASK_INFO=$(aws ecs describe-tasks \
      --cluster "$CLUSTER" \
      --tasks "$TASK_ARN" \
      --region "$REGION" \
      --query 'tasks[0].{StoppedReason:stoppedReason,Containers:containers[*].reason}' \
      --output json)
    
    STOPPED_REASON=$(echo "$TASK_INFO" | jq -r '.StoppedReason')
    
    if echo "$STOPPED_REASON" | grep -q "ResourceInitializationError\|secret"; then
      echo "❌ Task $TASK_ARN failed due to secret error:"
      echo "   $STOPPED_REASON"
    else
      echo "ℹ️  Task $TASK_ARN stopped for other reason:"
      echo "   $STOPPED_REASON"
    fi
  done
fi
echo ""

# Step 4: Verify task definition has correct secret mapping
echo "🔍 Step 4: Verifying task definition secret mapping..."
TASK_DEF_ARN=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --region "$REGION" \
  --query 'services[0].taskDefinition' \
  --output text)

echo "Task Definition: $TASK_DEF_ARN"

# Extract DATABASE_NAME secret configuration
DB_NAME_SECRET=$(aws ecs describe-task-definition \
  --task-definition "$TASK_DEF_ARN" \
  --region "$REGION" \
  --query 'taskDefinition.containerDefinitions[?name==`control-center`].secrets[?name==`DATABASE_NAME`]' \
  --output json)

if [ "$DB_NAME_SECRET" != "[]" ] && [ "$DB_NAME_SECRET" != "null" ]; then
  SECRET_KEY=$(echo "$DB_NAME_SECRET" | jq -r '.[0].valueFrom' | grep -oP ':[^:]*::$' | sed 's/:://g')
  
  if [ "$SECRET_KEY" = "database" ]; then
    echo "✅ DATABASE_NAME correctly uses 'database' key"
  elif [ "$SECRET_KEY" = "dbname" ]; then
    echo "❌ DATABASE_NAME incorrectly uses 'dbname' key (BUG!)"
  else
    echo "⚠️  DATABASE_NAME uses unexpected key: $SECRET_KEY"
  fi
else
  echo "ℹ️  DATABASE_NAME not found (database might be disabled)"
fi
echo ""

# Step 5: Check health endpoints (if ALB DNS is provided)
if [ -n "$ALB_DNS" ]; then
  echo "🔍 Step 5: Checking health endpoints..."
  
  echo "Testing /api/health..."
  HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "http://$ALB_DNS/api/health" || echo "000")
  HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -1)
  
  if [ "$HEALTH_CODE" = "200" ]; then
    echo "✅ /api/health returned 200 OK"
  else
    echo "❌ /api/health returned $HEALTH_CODE"
  fi
  
  echo "Testing /api/ready..."
  READY_RESPONSE=$(curl -s -w "\n%{http_code}" "http://$ALB_DNS/api/ready" || echo "000")
  READY_CODE=$(echo "$READY_RESPONSE" | tail -1)
  
  if [ "$READY_CODE" = "200" ]; then
    echo "✅ /api/ready returned 200 OK"
    echo "$READY_RESPONSE" | head -n-1 | jq .checks
  else
    echo "❌ /api/ready returned $READY_CODE"
  fi
else
  echo "ℹ️  Step 5: Skipped (set ALB_DNS env var to test health endpoints)"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

if [ "$DESIRED" -eq "$RUNNING" ]; then
  echo "✅ Service is stable"
  ((PASS++))
else
  echo "❌ Service is not stable"
  ((FAIL++))
fi

if [ "$CIRCUIT_BREAKER_COUNT" -eq 0 ]; then
  echo "✅ No circuit breaker events"
  ((PASS++))
else
  echo "❌ Circuit breaker events detected"
  ((FAIL++))
fi

if [ -z "$STOPPED_TASKS" ]; then
  echo "✅ No stopped tasks"
  ((PASS++))
else
  echo "⚠️  Stopped tasks found (check details above)"
  ((FAIL++))
fi

echo ""
echo "Checks passed: $PASS"
echo "Checks failed: $FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "✅ EPIC-10 fix verified successfully!"
  exit 0
else
  echo "❌ Some checks failed. Review output above for details."
  exit 1
fi
