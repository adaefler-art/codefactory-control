# Quick Reference: AFU-9 Automated Debugging Agent

## TL;DR

**Problem**: Manual copy-paste debugging between GitHub Actions and VS Code Copilot is tedious.

**Solution**: Automated agent that:
- ✅ Monitors deployment failures
- ✅ Collects diagnostic data automatically
- ✅ Generates AI-ready debugging prompts
- ✅ Creates GitHub issues with analysis
- ✅ Can be run manually for past failures

## Quick Start

### Option 1: Automatic (Default)

Just let it work! When `deploy-ecs.yml` fails:
1. Debug workflow automatically triggers
2. GitHub issue is created with analysis
3. Check issues labeled `automated-debugging`

### Option 2: Manual Trigger (GitHub UI)

1. Go to **Actions** → **Debug Deploy Failures**
2. Click **Run workflow**
3. Leave run_id empty for latest failure, or specify one
4. Check the run outputs and created issue

### Option 3: Local Analysis

```bash
# Set your GitHub token
export GITHUB_TOKEN="ghp_your_token_here"

# Analyze latest failure
node scripts/analyze-workflow-failure.js --latest-failure

# Create an issue with the analysis
node scripts/analyze-workflow-failure.js --latest-failure --create-issue

# Analyze specific run
node scripts/analyze-workflow-failure.js --run-id 1234567890
```

## Using with VS Code Copilot

### Before (Manual Process - OLD WAY ❌)

1. Go to GitHub Actions
2. Find failed workflow
3. Open failed job
4. Copy error messages
5. Open VS Code
6. Paste into Copilot chat
7. Ask for help
8. Repeat for each error...

### After (Automated - NEW WAY ✅)

**Method 1: From GitHub Issue**
1. Check GitHub issues for `automated-debugging` label
2. Open the issue created for your failed deployment
3. Expand the "AI Analysis Prompt" section
4. Copy the entire prompt
5. Paste into VS Code Copilot / ChatGPT / Claude
6. Get comprehensive analysis immediately

**Method 2: From Local Analysis**
1. Run: `node scripts/analyze-workflow-failure.js --latest-failure`
2. Open generated `ai-debug-prompt.txt`
3. Copy entire content
4. Paste into your AI assistant
5. Get detailed debugging suggestions

**Method 3: From Workflow Artifacts**
1. Go to the Debug workflow run
2. Download artifacts: `debug-info.json`, `ai-debug-prompt.txt`
3. Use the prompt with your AI assistant

## What You Get

### Structured Analysis
- Failed jobs and steps identified
- Error patterns detected and categorized
- Specific recommendations for each error type
- Links to relevant documentation

### Error Categories Detected
- AWS Authentication issues
- Database Migration failures
- ECS Deployment problems
- Task Definition errors
- Preflight check failures
- Health check issues
- Secrets Management problems
- Container Build errors

### AI-Ready Prompt
Includes:
- Full system context (AFU-9 architecture)
- Deployment guardrails and constraints
- Specific failure details
- Structured analysis request
- Focus areas for investigation

## Common Workflows

### Debugging a Failed Deployment

```bash
# 1. Get the analysis
node scripts/analyze-workflow-failure.js --latest-failure --verbose

DOCS_VERSION=$(cat docs/CURRENT_VERSION)

# 2. Review the report
cat "docs/$DOCS_VERSION/generated/workflow-failure-report.md"

# 3. Check recommendations
cat "docs/$DOCS_VERSION/generated/workflow-failure-analysis.json" | jq '.recommendations'

# 4. Use AI for deeper analysis
cat ai-debug-prompt.txt | pbcopy  # macOS
# Or: cat ai-debug-prompt.txt | xclip -selection clipboard  # Linux
# Paste into your AI assistant
```

### Creating a Debugging Issue

```bash
# Analyze and create issue in one command
GITHUB_TOKEN=$GH_TOKEN node scripts/analyze-workflow-failure.js \
  --latest-failure \
  --create-issue
```

### Checking Patterns Over Time

```bash
# Analyze last 5 failures and compare patterns
for i in {1..5}; do
  echo "=== Failure $i ===" 
  node scripts/analyze-workflow-failure.js --latest-failure 2>/dev/null | \
    grep "Error Pattern"
done
```

## Example Output

### Console Output
```
Found latest failed run: 1234567890

# AFU-9 Deployment Failure Analysis

**Workflow Run**: [#123](https://github.com/...)
**Branch**: `main`
**SHA**: `abc1234`
**Triggered by**: @user
**Status**: failure
**Created**: 2024-12-21T15:30:00Z

## Failed Jobs

### Build and Deploy to ECS

- **Status**: failure
- [View Job Logs](https://github.com/...)

**Failed Steps**:
- 15. `Run database migrations (gate)`

## Detected Error Patterns

- **Database Migration** (detected in: Run database migrations (gate))

## Recommendations

1. Check database connectivity, migration scripts, and RDS security groups

## Next Steps

1. Review the [workflow run logs](...)
2. Check the specific failed steps listed above
3. Consult the deployment documentation:
   ...

✅ Analysis saved to:
  - docs/v06/generated/workflow-failure-analysis.json
  - docs/v06/generated/workflow-failure-report.md
```

### GitHub Issue Created

Title: **🔴 Deploy Failure: main (Run #123)**

Body includes:
- All the analysis above
- Expandable AI prompt section
- Links to documentation
- Next steps checklist

## Files Generated

| File | Description | Use Case |
|------|-------------|----------|
| `debug-info.json` | Raw workflow data | Machine processing, scripting |
| `docs/v06/generated/workflow-failure-analysis.json` | Structured analysis | Programmatic access, trending |
| `docs/v06/generated/workflow-failure-report.md` | Human-readable report | Reading, sharing, documentation |
| `ai-debug-prompt.txt` | AI assistant prompt | Copy-paste to AI tools |
| `ecs-services.json` | ECS diagnostics | AWS debugging |
| `ecs-stopped-tasks.json` | Task failures | Container debugging |

## Configuration

### Workflow Triggers

Edit `.github/workflows/debug-deploy-failures.yml`:

```yaml
on:
  workflow_run:
    workflows: ["Deploy AFU-9 to ECS"]  # Monitored workflow
    types:
      - completed
```

Customize in the workflow:

```yaml
labels: ['deployment', 'automated-debugging', 'needs-triage']
```

### AWS Region

Change in workflow env:

```yaml
env:
  AWS_REGION: eu-central-1  # Your region
```

## Troubleshooting

### "No failed workflow runs found"
- Check that deploy-ecs.yml has actually failed
- Verify workflow name matches exactly
- Use `--run-id` to specify a specific run

### "GitHub API error: 401"
- Ensure GITHUB_TOKEN is set and valid
- Token needs `repo` and `workflow` scopes
- In Actions, use `${{ secrets.GITHUB_TOKEN }}`

### "AWS CLI command failed"
- AWS diagnostics are optional
- Check AWS credentials configuration
- Verify OIDC provider setup

### Workflow doesn't trigger automatically
- Ensure workflow is on default branch
- Check GitHub Actions permissions
- Verify workflow_run trigger configuration

## Pro Tips

1. **Bookmark the Issues Page** with `label:automated-debugging` filter
2. **Set up notifications** for the `automated-debugging` label
3. **Use verbose mode** (`--verbose`) when developing or debugging the debugger
4. **Save common prompts** in AI assistant for quick access
5. **Review patterns regularly** to identify systemic issues

## Integration Examples

### CI/CD Pipeline
```yaml
# In another workflow
- name: Analyze if deployment failed
  if: failure()
  run: |
    node scripts/analyze-workflow-failure.js \
      --run-id ${{ github.run_id }} \
      --create-issue
```

### Slack Notification (Future)
```yaml
- name: Send to Slack
  if: steps.analyze.conclusion == 'success'
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {
        "text": "Deployment failed - analysis available",
        "attachments": [
          {
            "text": "${{ steps.analyze.outputs.summary }}"
          }
        ]
      }
```

## Links

- [Full Documentation](../docs/AUTOMATED_DEBUGGING_AGENT.md)
- [Workflow File](../.github/workflows/debug-deploy-failures.yml)
- [Analysis Script](../scripts/analyze-workflow-failure.js)
- [Deploy System Prompt](../docs/deploy/AFU9_DEPLOY_SYSTEM_PROMPT.md)
