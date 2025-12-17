#!/bin/bash
# Build Determinism Verification Script
# Validates that builds are reproducible by building twice and comparing outputs

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Build Determinism Verification"
echo "=================================="
echo ""

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to build and get image digest
build_and_get_digest() {
    local context=$1
    local dockerfile=$2
    local tag=$3
    local build_num=$4
    
    echo "Building $tag (build $build_num)..."
    
    # Build without cache to ensure clean build
    # Save full build log to temp file
    local log_file="/tmp/build-${name}-${build_num}.log"
    
    if ! docker build \
        --no-cache \
        --progress=plain \
        -f "$dockerfile" \
        -t "$tag" \
        "$context" > "$log_file" 2>&1; then
        echo "Build failed! Last 50 lines:"
        tail -n 50 "$log_file"
        return 1
    fi
    
    echo "Build completed. Last 20 lines:"
    tail -n 20 "$log_file"
    
    # Get image digest
    local digest=$(docker inspect "$tag" --format='{{.Id}}' 2>&1)
    if [ $? -ne 0 ]; then
        echo "Error getting image digest: $digest"
        return 1
    fi
    
    echo "$digest"
}

# Function to verify determinism for a component
verify_component() {
    local name=$1
    local context=$2
    local dockerfile=$3
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing: $name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Build twice
    local digest1=$(build_and_get_digest "$context" "$dockerfile" "test-$name:1" "1")
    echo ""
    local digest2=$(build_and_get_digest "$context" "$dockerfile" "test-$name:2" "2")
    
    echo ""
    echo "Results:"
    echo "  Build 1 digest: $digest1"
    echo "  Build 2 digest: $digest2"
    
    # Compare digests
    if [ -z "$digest1" ] || [ -z "$digest2" ]; then
        print_error "Build failed for $name (empty digest)"
        return 1
    elif [ "$digest1" = "$digest2" ]; then
        print_success "Build is deterministic for $name"
        
        # Cleanup
        docker rmi "test-$name:1" "test-$name:2" > /dev/null 2>&1 || true
        return 0
    else
        print_error "Build is NON-DETERMINISTIC for $name"
        echo "  Different digests detected!"
        
        # Keep images for inspection
        print_warning "Images kept for inspection: test-$name:1 and test-$name:2"
        return 1
    fi
}

# Track results
FAILED_COMPONENTS=()
TOTAL_TESTS=0
PASSED_TESTS=0

# Test Control Center
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if verify_component "control-center" \
    "./control-center" \
    "./control-center/Dockerfile"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_COMPONENTS+=("control-center")
fi

# Test MCP GitHub Server
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if verify_component "mcp-github" \
    "./mcp-servers" \
    "./mcp-servers/github/Dockerfile"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_COMPONENTS+=("mcp-github")
fi

# Test MCP Deploy Server
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if verify_component "mcp-deploy" \
    "./mcp-servers" \
    "./mcp-servers/deploy/Dockerfile"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_COMPONENTS+=("mcp-deploy")
fi

# Test MCP Observability Server
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if verify_component "mcp-observability" \
    "./mcp-servers" \
    "./mcp-servers/observability/Dockerfile"; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    FAILED_COMPONENTS+=("mcp-observability")
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $((TOTAL_TESTS - PASSED_TESTS))"

if [ ${#FAILED_COMPONENTS[@]} -eq 0 ]; then
    echo ""
    print_success "All builds are deterministic! 🎉"
    echo ""
    echo "Build Determinism Score: 100%"
    exit 0
else
    echo ""
    print_error "Some builds are non-deterministic:"
    for component in "${FAILED_COMPONENTS[@]}"; do
        echo "  - $component"
    done
    echo ""
    echo "Build Determinism Score: $((PASSED_TESTS * 100 / TOTAL_TESTS))%"
    echo ""
    print_warning "Target: ≥95% determinism score"
    exit 1
fi
