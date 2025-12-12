#!/bin/bash
# Example usage of GitHub MCP Server tools
# This demonstrates how to call the various tools provided by the server

set -e

SERVER_URL="${SERVER_URL:-http://localhost:3001}"

echo "=== GitHub MCP Server Example Usage ==="
echo "Server URL: $SERVER_URL"
echo ""

# Function to make JSON-RPC calls
call_tool() {
  local tool=$1
  local args=$2
  local id=$3
  
  echo "Calling tool: $tool"
  curl -s -X POST "$SERVER_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"jsonrpc\": \"2.0\",
      \"id\": \"$id\",
      \"method\": \"tools/call\",
      \"params\": {
        \"tool\": \"$tool\",
        \"arguments\": $args
      }
    }" | python3 -m json.tool
  echo ""
}

# 1. Health Check
echo "1. Health Check"
curl -s "$SERVER_URL/health" | python3 -m json.tool
echo ""

# 2. List Available Tools
echo "2. List Available Tools"
curl -s -X POST "$SERVER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "list",
    "method": "tools/list",
    "params": {}
  }' | python3 -m json.tool | head -50
echo ""

# 3. Get Issue Example
echo "3. Get Issue (Example)"
call_tool "getIssue" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "number": 1
}' "get-issue"

# 4. List Issues Example
echo "4. List Issues (Example)"
call_tool "listIssues" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "state": "open"
}' "list-issues"

# 5. Create Branch Example
echo "5. Create Branch (Example)"
call_tool "createBranch" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "branch": "feature/test-branch",
  "from": "main"
}' "create-branch"

# 6. Commit File Changes Example
echo "6. Commit File Changes (Example)"
call_tool "commitFileChanges" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "branch": "feature/test-branch",
  "message": "Add test file",
  "files": [
    {
      "path": "test.txt",
      "content": "Hello, World!"
    }
  ]
}' "commit-files"

# 7. Create Pull Request Example
echo "7. Create Pull Request (Example)"
call_tool "createPullRequest" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "title": "Test PR",
  "body": "This is a test pull request",
  "head": "feature/test-branch",
  "base": "main"
}' "create-pr"

# 8. Merge Pull Request Example
echo "8. Merge Pull Request (Example)"
call_tool "mergePullRequest" '{
  "owner": "adaefler-art",
  "repo": "codefactory-control",
  "pull_number": 1,
  "commit_title": "Merge test PR",
  "merge_method": "squash"
}' "merge-pr"

echo "=== All examples completed ==="
echo ""
echo "Note: These examples will fail if you don't have a valid GITHUB_TOKEN"
echo "or if the repository/resources don't exist. They demonstrate the API structure."
