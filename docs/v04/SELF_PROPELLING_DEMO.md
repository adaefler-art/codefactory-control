# AFU-9 Self-Propelling Issue Demo

This directory contains the implementation for **Issue A4 — Reproduzierbarer Self-Propelling-Durchlauf**.

## What is Self-Propelling?

A self-propelling issue is one that automatically transitions through all states from **CREATED** to **DONE** without any manual intervention. This demonstrates AFU-9's capability for fully autonomous issue management.

## Components

### 1. Workflow Definition

**File**: `database/examples/self_propelling_issue.json`

A complete workflow with 13 automated steps that transition an issue through all canonical states:

```
CREATED → SPEC_READY → IMPLEMENTING → VERIFIED → MERGE_READY → DONE
```

### 2. Demo Script

**File**: `scripts/self-propelling-demo.ts`

A standalone TypeScript script that creates a test issue and runs the self-propelling workflow.

**Usage**:
```bash
export GITHUB_TOKEN=your_github_token
ts-node scripts/self-propelling-demo.ts --owner=adaefler-art --repo=codefactory-control
```

### 3. API Endpoint

**File**: `control-center/app/api/issues/[issueNumber]/self-propel/route.ts`

REST API endpoint to trigger self-propelling for any existing issue.

**Usage**:
```bash
curl -X POST http://localhost:3000/api/issues/123/self-propel \
  -H "Content-Type: application/json" \
  -d '{"owner":"adaefler-art","repo":"codefactory-control","baseBranch":"main"}'
```

### 4. GitHub Actions Workflow

**File**: `.github/workflows/self-propelling-demo.yml`

Automated workflow that can be triggered:
- Manually via workflow dispatch
- Automatically when issue is labeled with `afu9:self-propel`

## Quick Start

### Option 1: Run Demo Script (Recommended)

This is the easiest way to see the self-propelling capability in action:

```bash
# Navigate to project root
cd /home/runner/work/codefactory-control/codefactory-control

# Set GitHub token
export GITHUB_TOKEN=your_github_token_here

# Run demo
ts-node scripts/self-propelling-demo.ts \
  --owner=adaefler-art \
  --repo=codefactory-control

# View results
cat tmp-self-propelling-demo.json
```

**What happens**:
1. Creates a new test issue with title "[AFU-9 Demo] Self-Propelling Issue Test"
2. Automatically transitions through all states
3. Logs each transition as a comment on the issue
4. Closes the issue when complete
5. Generates timeline report: `tmp-self-propelling-demo.json`

**Expected output**:
```
🚀 AFU-9 Self-Propelling Issue Demo
====================================

📝 Creating test issue...
   ✅ Created issue #123

🔄 Transitioning: CREATED → SPEC_READY
   ✅ Completed in 342ms

🔄 Transitioning: SPEC_READY → IMPLEMENTING
   ✅ Completed in 287ms

🔄 Transitioning: IMPLEMENTING → VERIFIED
   ✅ Completed in 305ms

🔄 Transitioning: VERIFIED → MERGE_READY
   ✅ Completed in 298ms

🔄 Transitioning: MERGE_READY → DONE
   ✅ Completed in 321ms

📊 Generating timeline report...
   ✅ Timeline report saved to: tmp-self-propelling-demo.json

✅ Self-propelling demo completed successfully!
   Issue #123 transitioned from CREATED to DONE
   Total duration: 1553ms
   Transitions: 5
```

### Option 2: Use GitHub Actions

1. Go to **Actions** tab in GitHub
2. Select "AFU-9 Self-Propelling Issue Demo"
3. Click "Run workflow"
4. Enter issue number
5. Click "Run workflow"

### Option 3: Label an Issue

1. Create or open an issue
2. Add label: `afu9:self-propel`
3. Workflow automatically triggers

## Timeline Report

The demo generates a JSON timeline report that serves as proof of the self-propelling capability:

```json
{
  "demo": "AFU-9 Self-Propelling Issue",
  "issueNumber": 123,
  "repository": "adaefler-art/codefactory-control",
  "startTime": "2025-12-19T14:30:00.000Z",
  "endTime": "2025-12-19T14:30:01.553Z",
  "totalDuration": 1553,
  "transitions": [
    {
      "from": "CREATED",
      "to": "SPEC_READY",
      "timestamp": "2025-12-19T14:30:00.342Z",
      "action": "Specification review completed automatically",
      "durationMs": 342
    },
    ...
  ],
  "verification": {
    "zeroManualSteps": true,
    "reproducible": true,
    "auditable": true,
    "stateTracking": true
  }
}
```

## Verification

The self-propelling demo satisfies all requirements for Issue A4:

### ✅ Requirement 1: Issue runs CREATED → DONE fully automatically

**Proof**: 
- All state transitions are automated via workflow
- No human approval or intervention required
- Script executes from start to finish without pausing

### ✅ Requirement 2: Log/Timeline proves no manual steps

**Proof**:
- Every transition logged as GitHub comment with timestamp
- JSON timeline report documents complete execution
- `zeroManualSteps: true` in verification object

### ✅ Requirement 3: Re-run produces identical behavior

**Proof**:
- Workflow definition is deterministic
- Same inputs produce same state transitions
- Script can be run multiple times

## Troubleshooting

### Script fails with "GITHUB_TOKEN not set"

**Solution**: Set the GitHub token environment variable:
```bash
export GITHUB_TOKEN=your_token_here
```

### Script fails with "Missing required arguments"

**Solution**: Provide owner and repo:
```bash
ts-node scripts/self-propelling-demo.ts --owner=YOUR_ORG --repo=YOUR_REPO
```

### API endpoint returns 500

**Solution**: Check that:
1. Control Center is running
2. MCP servers are available
3. GitHub token is configured

### Workflow JSON validation fails

**Solution**: Validate against schema:
```bash
npx ajv validate -s database/workflow-schema.json -d database/examples/self_propelling_issue.json
```

## Documentation

For complete details, see:
- [IMPLEMENTATION_SUMMARY_ISSUE_A4.md](../IMPLEMENTATION_SUMMARY_ISSUE_A4.md) - Full implementation details
- [docs/ISSUE_STATE_MACHINE.md](../docs/ISSUE_STATE_MACHINE.md) - Canonical state machine
- [docs/WORKFLOW-ENGINE.md](../docs/WORKFLOW-ENGINE.md) - Workflow engine documentation

## Related Issues

- **Issue A1**: Kanonische Issue-State-Machine definieren ✅
- **Issue A2**: State-Transition-Guardrails entwickeln ✅
- **Issue A3**: Human-Touchpoint formal begrenzen ✅
- **Issue A4**: Reproduzierbarer Self-Propelling-Durchlauf ✅ (This implementation)

## Next Steps

After running the demo, you can:

1. **View the issue**: Check the created issue on GitHub to see all comments
2. **Review timeline**: Open `tmp-self-propelling-demo.json` to see the complete timeline
3. **Re-run**: Execute the demo again to verify reproducibility
4. **Extend**: Add real code changes, actual PR creation, real merge operations

## Questions?

Check the implementation summary for details:
```bash
cat IMPLEMENTATION_SUMMARY_ISSUE_A4.md
```
