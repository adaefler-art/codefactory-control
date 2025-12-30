# E64.2: Deploy Determinism Check

## Overview

The Deploy Determinism Check (E64.2) is a comprehensive, automatable gate that validates deployment safety before CDK deployment. It ensures reproducible builds, deterministic synthesis, and prevents unintended destructive changes to critical infrastructure.

## Purpose

This check prevents:
- **Service downtime** from ECS service replacements
- **Data loss** from database replacements or deletions
- **DNS/certificate issues** causing service unavailability  
- **Non-deterministic deployments** that can't be validated
- **Routing failures** from ALB/Target Group changes

## Quick Start

### Run the full check

```powershell
npm run determinism:check
```

### Run with specific options

```powershell
# Skip tests only (useful during development)
$env:SKIP_TESTS="true"; npm run determinism:check

# Skip all validation steps (not recommended)
$env:SKIP_DETERMINISM_CHECK="true"; npm run determinism:check

# Check a specific stack only
npm run determinism:check -- --stack Afu9EcsStack
```

## What It Checks

The script performs the following validations in order:

### 1. **Test Validation**
- Runs `npm test` to ensure code quality
- Can be skipped with `$env:SKIP_TESTS="true"`

### 2. **Build Validation**
- Runs `npm run build` to ensure TypeScript compiles
- Can be skipped with `$env:SKIP_BUILD="true"`

### 3. **CDK Synth Determinism**
- Synthesizes CDK stacks twice
- Compares CloudFormation template hashes
- Ensures reproducible infrastructure-as-code
- Can be skipped with `$env:SKIP_SYNTH_CHECK="true"`

### 4. **CDK Diff Analysis**
- Analyzes diffs for all critical stacks:
  - `Afu9EcsStack` (or Stage/Prod variants)
  - `Afu9NetworkStack`
  - `Afu9DatabaseStack`
  - `Afu9DnsStack`
  - `Afu9RoutingStack`

## Gate Rules

### 🚫 BLOCKING Changes

These changes **prevent deployment**:

| Resource | Pattern | Risk | Reason |
|----------|---------|------|---------|
| ECS Service | `[~] ... (replacement)` | **HIGH** | Causes downtime |
| Load Balancer | `[~] ... (replacement)` | **HIGH** | Changes DNS endpoint |
| Target Group | `[-]` or replacement | **HIGH** | Breaks routing |
| RDS Instance | `[~] ... (replacement)` | **CRITICAL** | Data loss risk |
| Route53 Record | `[-]` or replacement | **HIGH** | Service unavailable |
| ACM Certificate | `[-]` or replacement | **HIGH** | Breaks HTTPS |
| Security Group | `[-]` | **MEDIUM** | Breaks connectivity |

### ⚠️ WARNING Changes

These are **allowed but flagged** for review:

- Security Group rule modifications
- IAM Role/Policy changes

### ✅ SAFE Changes

These are **allowed without warnings**:

- ECS TaskDefinition updates (normal deployments)
- Adding new resources (`[+]`)

## Output

### Console Output

The script provides color-coded, human-readable output:

```
✅ Deploy Determinism Check: PASSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Tests passed
✓ Build successful  
✓ CDK synth deterministic (2 runs)
✓ No blocking changes detected

Stacks analyzed: 5
  • Afu9EcsStack: Safe (1 TaskDefinition update)
  • Afu9NetworkStack: No changes
  • Afu9DatabaseStack: No changes
  • Afu9DnsStack: No changes
  • Afu9RoutingStack: No changes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Deployment is SAFE to proceed
```

### JSON Report

Machine-readable output is saved to `artifacts/determinism-report.json`:

```json
{
  "timestamp": "2025-12-30T09:00:00.000Z",
  "success": true,
  "testsPass": true,
  "buildSuccess": true,
  "synthDeterministic": true,
  "stacks": [
    {
      "name": "Afu9EcsStack",
      "hasChanges": false,
      "blockingChanges": [],
      "warningChanges": [],
      "safeChanges": []
    }
  ],
  "blockingIssues": [],
  "warnings": [],
  "summary": "All checks passed - deployment is SAFE to proceed"
}
```

## Integration

### Local Development

Run before committing infrastructure changes:

```powershell
npm run determinism:check
```

### CI/CD Pipeline

Add to GitHub Actions workflow:

```yaml
- name: Deploy Determinism Check
  run: npm run determinism:check
  env:
    AWS_REGION: ${{ secrets.AWS_REGION }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  
- name: Upload Determinism Report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: determinism-report
    path: artifacts/determinism-report.json
```

### Pre-Deploy Hook

Automatically run before deployment:

```powershell
npm run determinism:check; if ($LASTEXITCODE -eq 0) { npm run deploy }
```

## Exit Codes

- **0**: All checks passed, safe to deploy
- **1**: Checks failed, deployment blocked
- **2**: Script error or invalid usage

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKIP_DETERMINISM_CHECK` | `false` | Skip entire check (not recommended) |
| `SKIP_TESTS` | `false` | Skip test validation step |
| `SKIP_BUILD` | `false` | Skip build validation step |
| `SKIP_SYNTH_CHECK` | `false` | Skip synth determinism check |
| `AWS_REGION` | `eu-central-1` | AWS region for CDK operations |
| `AWS_PROFILE` | - | AWS profile to use (optional) |

## Related Documentation

- **Playbook**: [docs/playbooks/deploy-determinism-check.md](../../docs/playbooks/deploy-determinism-check.md) - Detailed operational playbook
- **CDK Diff Gate**: [scripts/validate-cdk-diff.ts](../validate-cdk-diff.ts) - Underlying diff validation logic
- **Synth Validation**: [scripts/synth-with-validation.ts](../synth-with-validation.ts) - Secret validation before synth
- **Build Determinism**: [docs/BUILD_DETERMINISM_CRITERIA.md](../../docs/BUILD_DETERMINISM_CRITERIA.md) - Build determinism criteria

## Testing

To test the script itself:

```bash
npx ts-node scripts/test-deploy-determinism-check.ts
```

## Troubleshooting

### Issue: CDK Synth Fails

**Solution**: Check AWS credentials and context values

```powershell
aws sts get-caller-identity
$env:SKIP_SECRET_VALIDATION="true"; npx cdk synth
```

### Issue: Non-Deterministic Synth

**Solution**: Review CDK code for timestamps, random values, or external API calls during synthesis

### Issue: Unexpected Blocking Changes

**Solution**: Review git diff and CDK code changes

```powershell
git diff
npx cdk diff <StackName> --exclusively
```

### Issue: False Positive Block

**Solutions**:
1. Review gate rules in the script
2. Document intentional change in PR
3. For emergency: `$env:SKIP_DIFF_GATE="true"; npm run deploy` (not recommended)

## Maintenance

Update this check when:
- New critical resource types are added
- Gate rules need adjustment based on operational experience
- CDK or AWS service behavior changes
- New deployment patterns are adopted

---

**Last Updated**: 2025-12-30  
**Issue**: E64.2  
**Version**: 1.0.0
