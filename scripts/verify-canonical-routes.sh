#!/bin/bash

# Script to verify all client code uses canonical API routes
# Part of Issue #3: API Route Canonicalization

set -e

echo "=== AFU-9 API Route Canonicalization Verification ==="
echo ""

ERRORS=0

# Check for deprecated /api/github/webhook usage
echo "Checking for deprecated /api/github/webhook usage..."

# Exclude specific files from the check:
# - Test files (.test.ts) - tests may reference deprecated routes
# - The deprecated route file itself (api/github/webhook/route.ts)
# - The canonical route file (webhooks/github/route.ts)
# - Middleware public routes config (middleware-public-routes.ts)
# - Route constants definition (src/lib/api-routes.ts)
DEPRECATED_GITHUB_WEBHOOK=$(grep -r "/api/github/webhook" control-center/app control-center/src 2>/dev/null \
  | grep -v ".test.ts" \
  | grep -v "api/github/webhook/route.ts" \
  | grep -v "webhooks/github/route.ts" \
  | grep -v "middleware-public-routes.ts" \
  | grep -v "src/lib/api-routes.ts" \
  || true)

if [ -n "$DEPRECATED_GITHUB_WEBHOOK" ]; then
  echo "❌ FAIL: Found usage of deprecated /api/github/webhook route:"
  echo "$DEPRECATED_GITHUB_WEBHOOK"
  echo ""
  echo "  Migration: Replace with /api/webhooks/github"
  echo ""
  ERRORS=$((ERRORS + 1))
else
  echo "✅ PASS: No deprecated /api/github/webhook usage found"
fi

echo ""

# Verify all routes have tests
echo "Checking for routes without tests..."
ROUTES_WITHOUT_TESTS=0

# Routes that are exempt from test coverage requirements
# (typically internal/utility routes that don't need explicit API tests)
SKIP_TEST_CHECK=(
  "deps/ready"
  "build-info"
  "build-metadata"
)

# Get all route files
for route_file in $(find control-center/app/api -name "route.ts" | sort); do
  route_path=$(echo "$route_file" | sed 's|control-center/app/api/||' | sed 's|/route.ts$||')
  route_test_pattern=$(echo "$route_path" | sed 's|\[id\]|\\[id\\]|g')
  
  # Skip routes that are exempt from testing
  skip=false
  for skip_route in "${SKIP_TEST_CHECK[@]}"; do
    if [[ "$route_path" == "$skip_route" ]]; then
      skip=true
      break
    fi
  done
  
  if [ "$skip" = true ]; then
    continue
  fi
  
  # Check if test file exists
  if ! grep -r "/$route_test_pattern" control-center/__tests__/api/ > /dev/null 2>&1; then
    echo "  ⚠️  No test found for: /api/$route_path"
    ROUTES_WITHOUT_TESTS=$((ROUTES_WITHOUT_TESTS + 1))
  fi
done

if [ $ROUTES_WITHOUT_TESTS -gt 0 ]; then
  echo ""
  echo "⚠️  WARNING: $ROUTES_WITHOUT_TESTS routes found without explicit tests"
  echo "  (This is informational only and does not fail the check)"
else
  echo "✅ All major routes have test coverage"
fi

echo ""

# Summary
if [ $ERRORS -gt 0 ]; then
  echo "=== VERIFICATION FAILED ==="
  echo "Found $ERRORS error(s) that must be fixed"
  exit 1
else
  echo "=== VERIFICATION PASSED ==="
  echo "All client code uses canonical routes"
  exit 0
fi
