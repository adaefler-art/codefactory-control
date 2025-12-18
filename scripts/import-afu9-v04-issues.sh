#!/bin/bash

# Import AFU-9 v0.4 Issues and Milestones
# This script uses GitHub CLI (gh) to create issues and milestones

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${GITHUB_REPO:-adaefler-art/codefactory-control}"

echo "🚀 AFU-9 v0.4 Issue Import"
echo "📦 Target: $REPO"
echo ""

# Check if gh is installed and authenticated
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo "Install it from: https://cli.github.com/"
    echo ""
    echo "Alternative: Use the TypeScript script with a GitHub token:"
    echo "  GITHUB_TOKEN=<token> npm run import-v04-issues"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ GitHub CLI is not authenticated"
    echo "Run: gh auth login"
    echo ""
    echo "Alternative: Use the TypeScript script with a GitHub token:"
    echo "  GITHUB_TOKEN=<token> npm run import-v04-issues"
    exit 1
fi

echo "✅ GitHub CLI is authenticated"
echo ""

# Read the JSON data
JSON_FILE="$SCRIPT_DIR/afu9-v04-issues-data.json"

if [ ! -f "$JSON_FILE" ]; then
    echo "❌ Data file not found: $JSON_FILE"
    exit 1
fi

# Parse JSON using jq or node
if command -v jq &> /dev/null; then
    EPIC_COUNT=$(jq '.epics | length' "$JSON_FILE")
    ISSUE_COUNT=$(jq '.issues | length' "$JSON_FILE")
else
    EPIC_COUNT=$(node -e "console.log(require('$JSON_FILE').epics.length)")
    ISSUE_COUNT=$(node -e "console.log(require('$JSON_FILE').issues.length)")
fi

echo "📊 Will create $EPIC_COUNT milestones and $ISSUE_COUNT issues"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "=== STEP 1: Creating Milestones ==="
echo ""

# Create milestones using gh CLI
# Note: We'll use node to parse JSON since gh doesn't directly read milestone descriptions from JSON

node << 'EOF'
const { execSync } = require('child_process');
const data = require('./scripts/afu9-v04-issues-data.json');

const epicToMilestone = new Map();

for (const epic of data.epics) {
  console.log(`📌 Creating milestone: ${epic.title}`);
  
  try {
    // Create milestone using gh CLI
    const result = execSync(
      `gh api repos/:owner/:repo/milestones -f title="${epic.title}" -f description="${epic.description}" -f state=open`,
      { encoding: 'utf-8' }
    );
    
    const milestone = JSON.parse(result);
    epicToMilestone.set(epic.id, milestone.number);
    
    console.log(`✅ Created milestone #${milestone.number}: ${epic.title}`);
    
    // Small delay to avoid rate limiting
    execSync('sleep 0.5');
  } catch (error) {
    console.error(`❌ Error creating milestone ${epic.title}:`, error.message);
    process.exit(1);
  }
}

console.log('\n=== STEP 2: Creating Issues ===\n');

for (const issue of data.issues) {
  const milestoneNumber = epicToMilestone.get(issue.epicId);
  if (!milestoneNumber) {
    console.error(`❌ Milestone not found for epic ${issue.epicId}`);
    continue;
  }
  
  console.log(`📝 Creating issue: ${issue.title}`);
  
  try {
    // Prepare labels as JSON array
    const labelsJson = JSON.stringify(issue.labels);
    
    // Create issue using gh CLI
    const result = execSync(
      `gh api repos/:owner/:repo/issues -f title="${issue.title}" -f body="${issue.body}" -F milestone=${milestoneNumber} -f labels='${labelsJson}'`,
      { encoding: 'utf-8' }
    );
    
    const createdIssue = JSON.parse(result);
    console.log(`✅ Created issue #${createdIssue.number}: ${issue.title}`);
    
    // Small delay to avoid rate limiting
    execSync('sleep 0.5');
  } catch (error) {
    console.error(`❌ Error creating issue ${issue.title}:`, error.message);
    process.exit(1);
  }
}

console.log('\n✨ Import completed successfully!');
console.log(`📊 Summary: Created ${data.epics.length} milestones and ${data.issues.length} issues`);
EOF

echo ""
echo "🎉 Done! View the results:"
echo "  Milestones: https://github.com/$REPO/milestones"
echo "  Issues: https://github.com/$REPO/issues?q=is%3Aissue+label%3Av0.4"
