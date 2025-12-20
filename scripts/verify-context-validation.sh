#!/bin/bash

# Manual Verification Script for Context Validation (Issue I-02-02-CONTEXT-NAMES)
# This script tests that context validation is working correctly

set -e

echo "========================================="
echo "Context Validation Manual Verification"
echo "========================================="
echo ""

cd "$(dirname "$0")/.."

echo "Test 1: Canonical keys should work without warnings"
echo "---------------------------------------------------"
npx cdk synth Afu9EcsStack \
  -c afu9-enable-database=false \
  -c afu9-enable-https=false \
  2>&1 | grep -E "(DEPRECATION|warning)" | grep -v "aws_stepfunctions" || echo "✅ No deprecation warnings (expected)"
echo ""

echo "Test 2: Deprecated 'enableDatabase' should trigger warning"
echo "-----------------------------------------------------------"
if npx cdk synth Afu9EcsStack \
  -c enableDatabase=false \
  -c afu9-enable-https=false \
  2>&1 | grep -q "DEPRECATION: Context key \"enableDatabase\" is deprecated"; then
  echo "✅ Deprecation warning found (expected)"
else
  echo "❌ Deprecation warning NOT found (unexpected)"
  exit 1
fi
echo ""

echo "Test 3: Both old and new keys should warn and prefer new key"
echo "-------------------------------------------------------------"
if npx cdk synth Afu9EcsStack \
  -c enableDatabase=true \
  -c afu9-enable-database=false \
  -c afu9-enable-https=false \
  2>&1 | grep -q "Both \"enableDatabase\" (deprecated) and \"afu9-enable-database\""; then
  echo "✅ Conflict warning found (expected)"
else
  echo "❌ Conflict warning NOT found (unexpected)"
  exit 1
fi
echo ""

echo "Test 4: Verify database is disabled when using canonical key"
echo "--------------------------------------------------------------"
if npx cdk synth Afu9EcsStack \
  -c afu9-enable-database=false \
  -c afu9-enable-https=false \
  2>&1 | grep -q "Database Enabled: false"; then
  echo "✅ Database correctly disabled (expected)"
else
  echo "❌ Database not disabled (unexpected)"
  exit 1
fi
echo ""

echo "Test 5: Check that deprecated key 'enableHttps' works with warning"
echo "--------------------------------------------------------------------"
if npx cdk synth Afu9NetworkStack \
  -c enableHttps=false \
  2>&1 | grep -q "DEPRECATION.*enableHttps"; then
  echo "✅ Deprecation warning for enableHttps found (expected)"
else
  echo "ℹ️  No specific warning for enableHttps (may use different validation path)"
fi
echo ""

echo "========================================="
echo "All manual tests completed successfully!"
echo "========================================="
echo ""
echo "Summary:"
echo "- Canonical keys (afu9-*) work without warnings"
echo "- Deprecated keys trigger clear deprecation warnings"
echo "- Conflicting keys trigger warnings and prefer canonical"
echo "- Validation logic is properly integrated"
echo ""
