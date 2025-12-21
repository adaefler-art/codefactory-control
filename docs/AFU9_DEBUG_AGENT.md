# AFU-9 Debug Agent

Universal workflow failure debugging agent with automatic fix generation and auto-merge capabilities.

## Overview

The AFU-9 Debug Agent automatically monitors all GitHub Actions workflows (except itself) for failures, analyzes the root cause, generates fixes, and creates auto-merge PRs with strict guardrails.

## Features

### 1. Multi-Workflow Monitoring
Monitors these workflows for failures:
- Deploy AFU-9 to ECS
- Deploy CDK Stack with Diff Gate
- Build Determinism Check
- Sync Check
- Health Check Contract Tests
- Security Validation
- Auto-assign Deploy Failure Issues

### 2. Evidence Pack Collection
For each failure, collects:
- Exact failed step identification
- Relevant log extracts (max 30 lines)
- Affected AWS resources (ECS, Secrets, ECR, etc.)
- Failure timestamp and commit SHA
- Workflow run metadata

### 3. Root Cause Analysis
Pattern-based detection for common failures:
- ECS service issues (ServiceNotActive, insufficient capacity)
- CDK synthesis and stack errors
- Build and compilation failures
- IAM permission issues
- Secret management problems
- Database migration failures
- Health check failures

### 4. Strict Guardrails
Enforces limits to prevent dangerous changes:
- ✅ ≤200 lines of code changed
- ✅ ≤10 files modified
- ✅ No IAM wildcard expansion
- ✅ No secret restoration/undelete
- ✅ No new product concepts
- ✅ Maximum 5 fix attempts per incident

### 5. Verification Gates
Before creating PRs, validates:
- **Build Gate**: `npm run build` must pass
- **CDK Synth Gate**: `npx cdk synth` must succeed (if CDK changes)
- **CDK Diff Gate**: No critical resource replacements (ECS Service, ALB, RDS)

### 6. Auto-Merge Workflow
- Creates PR with standardized template
- Auto-approves if all guardrails pass
- Auto-merges with squash strategy
- Deletes branch after successful merge

### 7. HOLD Logic
Creates HOLD issues instead of PRs when:
- Guardrails violated
- Maximum attempts (5) exceeded
- Automatic fix not available
- Manual investigation required

## Usage

### Automatic Trigger
The workflow automatically runs when any monitored workflow fails.

### Manual Trigger
```bash
# Via GitHub CLI
gh workflow run "AFU-9 Debug Agent" \
  --field run_id=<workflow-run-id> \
  --field workflow_name="Deploy AFU-9 to ECS" \
  --field create_pr=true \
  --field auto_merge=true

# Via GitHub UI
# Go to Actions > AFU-9 Debug Agent > Run workflow
# Optionally specify run ID and workflow name
```

### Workflow Dispatch Inputs
- `run_id`: Specific workflow run to debug (optional)
- `workflow_name`: Workflow to debug (auto-detected if empty)
- `create_pr`: Create auto-fix PR (default: true)
- `auto_merge`: Enable auto-merge (default: true)

## Configuration

### Environment Variables
```yaml
AWS_REGION: eu-central-1
MAX_FIX_ATTEMPTS: 5
MAX_LOC_CHANGES: 200
MAX_FILES_CHANGED: 10
```

### Required Secrets
- `GITHUB_TOKEN`: For PR creation and auto-merge
- `AWS_DEPLOY_ROLE_ARN`: For AWS diagnostics (ECS, CloudFormation)

### Required Permissions
```yaml
permissions:
  actions: read          # Read workflow runs and logs
  contents: write        # Create branches and commits
  issues: write          # Create HOLD issues
  pull-requests: write   # Create and merge PRs
  id-token: write        # AWS authentication
```

## Pattern Matcher Tool

Use the standalone pattern matcher to test log analysis:

```bash
# Test with a log file
node scripts/debug-agent-pattern-matcher.js test-failure.log

# Example output
=== AFU-9 Debug Agent Pattern Matcher ===

✓ Pattern Matches Found:
  - ecs_service_not_active (line 4)

Root Cause Analysis:
  Hypothesis: ECS Service is not in ACTIVE state
  Severity: high
  Affected Resources: ECS Service
  Fix Strategy: Check ECS service status, verify no pending deployments
```

### Testing Different Failure Scenarios

Create test log files:

```bash
# ECS failure
cat > test-ecs-failure.log << 'EOF'
Error: ServiceNotActiveException - Service was not ACTIVE
EOF

# CDK failure
cat > test-cdk-failure.log << 'EOF'
Error: Synthesis failed
EOF

# Build failure
cat > test-build-failure.log << 'EOF'
error TS2345: Argument of type 'string' is not assignable to type 'number'
EOF

# Run pattern matcher
node scripts/debug-agent-pattern-matcher.js test-ecs-failure.log
```

## PR Template

When fixes are generated, PRs follow this template:

```markdown
## 🤖 AFU-9 Debug Agent Auto-Fix

### Evidence Pack
**Failed Workflow:** Deploy AFU-9 to ECS Run #123
**Failed Step:** `Deploy to ECS`
**SHA:** `abc123...`
**Failure Time:** 2025-12-21T16:35:48Z

**Log Extract:**
```
Error: ServiceNotActiveException
Service was not ACTIVE
```

**Affected Resource:** ECS Service

### Root Cause
ECS Service is not in ACTIVE state - likely stuck in UPDATE_IN_PROGRESS

### Fix Summary
**Changed Files:** 2 (≤10 ✅)
**LOC Changed:** 45 (≤200 ✅)
**Fix Strategy:** Reset ECS service deployment

### Verification Results
- ✅ Build: `npm run build` passed
- ✅ CDK Synth: passed
- ✅ CDK Diff: No critical replacements

### Guardrail Compliance
- ✅ No IAM wildcard expansion
- ✅ No secret restoration
- ✅ No new product concepts
- ✅ ≤200 LOC
- ✅ ≤10 Files

---
*Auto-generated by AFU-9 Debug Agent*
*Attempt 1/5 for incident deploy-ecs-2025-12-21*
```

## HOLD Issue Template

When manual intervention is needed:

```markdown
## 🔴 AFU-9 Debug Agent: HOLD

**Workflow:** Deploy AFU-9 to ECS
**Run:** #123
**Incident ID:** `deploy-ecs-2025-12-21`
**Reason:** Maximum fix attempts (5) exceeded

### Evidence Pack
[... same as PR template ...]

### Why HOLD?
Maximum fix attempts exceeded. Automatic fixes did not resolve the issue.

### Manual Action Required
- [ ] Review Evidence Pack
- [ ] Verify Root Cause Hypothesis
- [ ] Approve manual fix OR adjust guardrails
```

## State Management

### Incident Tracking
- **Incident ID Format**: `{workflow-name}-{date}`
- **Attempt Tracking**: Via GitHub issue labels (`attempt-1`, `attempt-2`, etc.)
- **Max Attempts**: 5 per incident
- **State Store**: GitHub Issues API

### Issue Labels
- `afu9-debug-agent`: All agent-created issues
- `hold`: HOLD status
- `attempt-N`: Attempt number (1-5)
- `needs-manual-review`: Requires human intervention
- `{workflow-name}-failure`: Workflow-specific

## AWS Diagnostics

For ECS/CDK failures, collects:
- ECS service status and events
- Stopped task details
- CloudFormation stack status
- Task definition validation

## Architecture

```
Workflow Failure
    ↓
Evidence Collection
    ↓
Root Cause Analysis (Pattern Matching)
    ↓
Fix Generation (Placeholder)
    ↓
Guardrail Validation
    ↓
Verification Gates (Build, CDK)
    ↓
Decision: PR or HOLD?
    ↓
If PR: Auto-Approve → Auto-Merge → Cleanup
If HOLD: Create Issue → Assign
```

## Limitations

### Current Placeholders
1. **Fix Generation**: Pattern matching identifies issues but doesn't generate code fixes yet
2. **IAM Detection**: Requires actual file diff analysis
3. **Secret Detection**: Requires file content inspection

### Future Enhancements
- Domain-specific fix generation
- ML-based pattern learning
- Cross-repository pattern sharing
- Advanced observability integration
- Automated rollback on fix failure

## Development

### Adding New Patterns

Edit `scripts/debug-agent-pattern-matcher.js`:

```javascript
FAILURE_PATTERNS.my_new_pattern = {
  pattern: /regex pattern/i,
  rootCause: 'Description of root cause',
  affectedResources: ['Resource Type'],
  fixStrategy: 'How to fix it',
  severity: 'high|medium|low'
};
```

### Testing

```bash
# Test pattern matcher
node scripts/debug-agent-pattern-matcher.js test-logs/failure.log

# Validate workflow syntax
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/debug-deploy-failures.yml'))"

# Dry-run workflow (requires act)
act workflow_dispatch -W .github/workflows/debug-deploy-failures.yml
```

## Monitoring

Check debug agent performance:
- Successful auto-fixes: Count merged PRs with `afu9-debug-agent` label
- HOLD rate: Count issues with `hold` label
- Average attempts: Analyze `attempt-N` label distribution

## Security

### Guardrail Enforcement
- No secrets in code
- No IAM permission expansion
- No destructive infrastructure changes
- Limited blast radius (≤10 files, ≤200 LOC)

### Audit Trail
- All changes via PRs (reviewable)
- All decisions in GitHub Issues
- Full workflow run logs retained

## Support

For issues or questions:
1. Check HOLD issues for similar failures
2. Review Evidence Pack in debug agent runs
3. Manually trigger debug agent with specific run ID
4. Escalate to @adaefler-art

## Version

AFU-9 Debug Agent v1.0 (Initial Release)

## License

Internal tool for codefactory-control repository
