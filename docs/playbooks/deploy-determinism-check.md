# Deploy Determinism Check Playbook

## Purpose

This playbook defines a deterministic, automatable check that runs before every deploy to ensure:

1. **CDK synth is reproducible** - The synthesized CloudFormation templates are consistent
2. **Build artifacts are deterministic** - Code builds produce the same outputs
3. **CDK diff contains no unexpected changes** - No unintended resource replacements or deletions
4. **Critical resources are protected** - ECS services, ALB/TG, RDS, DNS, and certificates are safe

This check acts as a **deploy gate** to prevent:
- Unintended service downtime from resource replacements
- Data loss from database deletions
- DNS/certificate issues causing service unavailability
- Non-deterministic deployments that can't be validated

## Preconditions

Before running this check, ensure:

1. **AWS credentials are configured** - Either via AWS CLI profile or environment variables
   ```bash
   aws sts get-caller-identity
   ```

2. **Dependencies are installed**
   ```bash
   npm install
   ```

3. **Environment variables are set** (if needed)
   - `AWS_REGION` (default: eu-central-1)
   - `AWS_PROFILE` (optional)
   - `DOMAIN_NAME` or use context `-c afu9-domain=...`

4. **Clean working directory** - No uncommitted changes that could affect synth
   ```bash
   git status
   ```

## Steps

The deploy determinism check follows these steps in order:

### 1. Test Validation

Run existing tests to ensure code quality:

```bash
npm test
```

**Expected output:** All tests pass
**On failure:** Fix failing tests before proceeding

### 2. Build Validation

Build TypeScript to ensure compilation succeeds:

```bash
npm run build
```

**Expected output:** Clean TypeScript compilation with no errors
**On failure:** Fix TypeScript compilation errors

### 3. CDK Synth (First Pass)

Synthesize CDK stacks to CloudFormation templates:

```bash
npx cdk synth
```

**Expected output:** 
- Successful synthesis of all stacks
- CloudFormation templates written to `cdk.out/`

**On failure:**
- Check AWS credentials
- Verify CDK context values
- Review stack dependencies

### 4. CDK Synth (Second Pass - Determinism Check)

Re-synthesize to verify reproducibility:

```bash
npx cdk synth
```

**Expected output:**
- Identical CloudFormation templates to first synth
- No changes in `cdk.out/` directory

**Validation:** Compare outputs from both synth runs

### 5. CDK Diff Analysis

For each critical stack, run diff and analyze for destructive changes:

```bash
npx cdk diff --exclusively <StackName>
```

**Critical stacks to check:**
- `Afu9EcsStack` (or `Afu9EcsStageStack`, `Afu9EcsProdStack` in multi-env)
- `Afu9NetworkStack` (ALB, Target Groups)
- `Afu9DatabaseStack` (if database is enabled)
- `Afu9DnsStack` (if HTTPS is enabled)
- `Afu9RoutingStack` (if routing is configured)

**Expected output:** No blocking changes (see Gate Rules below)

### 6. Gate Rules Evaluation

The diff output is evaluated against these rules:

#### 🚫 BLOCKING Changes (Deployment NOT allowed)

These changes indicate potential service disruption or data loss:

| Resource Type | Change Pattern | Risk | Reason |
|--------------|----------------|------|---------|
| `AWS::ECS::Service` | `[~] ... (replacement)` | **HIGH** | Service replacement causes downtime |
| `AWS::ElasticLoadBalancingV2::LoadBalancer` | `[~] ... (replacement)` | **HIGH** | ALB replacement changes DNS endpoint |
| `AWS::ElasticLoadBalancingV2::TargetGroup` | `[-]` or `[~] ... (replacement)` | **HIGH** | Target group deletion breaks routing |
| `AWS::RDS::DBInstance` | `[~] ... (replacement)` | **CRITICAL** | Database replacement risks data loss |
| `AWS::Route53::RecordSet` | `[-]` or `[~] ... (replacement)` | **HIGH** | DNS changes cause service unavailability |
| `AWS::CertificateManager::Certificate` | `[-]` or `[~] ... (replacement)` | **HIGH** | Certificate changes break HTTPS |
| `AWS::EC2::SecurityGroup` | `[-]` | **MEDIUM** | Security group deletion breaks connectivity |

#### ⚠️ WARNING Changes (Review recommended)

These changes are allowed but should be reviewed:

| Resource Type | Change Pattern | Note |
|--------------|----------------|------|
| `AWS::EC2::SecurityGroup` | `[~] ... SecurityGroupIngress/Egress` | Verify access requirements |
| `AWS::IAM::Role` | `[~]` | Verify permissions are correct |
| `AWS::IAM::Policy` | `[~]` | Verify least privilege principle |

#### ✅ SAFE Changes (Allowed)

| Resource Type | Change Pattern | Note |
|--------------|----------------|------|
| `AWS::ECS::TaskDefinition` | `[~]` | Normal deployments (image updates) |
| Any | `[+]` | Adding resources is non-destructive |

### 7. Report Generation

Generate machine-readable and human-readable reports:

**JSON Report:** `artifacts/determinism-report.json`
```json
{
  "timestamp": "2025-12-30T09:00:00.000Z",
  "success": true,
  "buildDeterministic": true,
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
  "warnings": []
}
```

**Console Output:** Summary with color-coded results

## Expected Outputs

### Success Case

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

### Failure Case

```
❌ Deploy Determinism Check: BLOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Tests passed
✓ Build successful
✓ CDK synth deterministic
✗ BLOCKING CHANGES DETECTED

Blocking Issues:
  1. Afu9EcsStack
     [~] AWS::ECS::Service (replacement)
     Reason: ECS Service replacement causes downtime
     Path: Resources/Afu9EcsService/Resource

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Deployment is BLOCKED - Review required
```

## Troubleshooting

### Issue: CDK Synth Fails

**Symptoms:** Error during `npx cdk synth`

**Common Causes:**
1. Missing AWS credentials
2. Invalid context values
3. Missing secrets in Secrets Manager
4. TypeScript compilation errors

**Solutions:**
```bash
# Check credentials
aws sts get-caller-identity

# Verify context
npx cdk context

# Skip secret validation for local dev
SKIP_SECRET_VALIDATION=true npx cdk synth

# Check TypeScript
npm run build
```

### Issue: Non-Deterministic Synth

**Symptoms:** CDK output differs between runs

**Common Causes:**
1. Timestamps in templates
2. Random resource names
3. External API calls during synth

**Solutions:**
- Review CDK code for non-deterministic constructs
- Use fixed timestamps or hashes
- Mock external calls

### Issue: Unexpected Blocking Changes

**Symptoms:** Diff shows resource replacements not intended

**Common Causes:**
1. Changed CDK code modifying resource properties
2. Context value changes
3. Dependency updates changing resource behavior

**Solutions:**
```bash
# Review what changed
git diff

# Check CDK diff in detail
npx cdk diff <StackName> --exclusively

# Revert unintended changes
git checkout <file>
```

### Issue: False Positive Blocks

**Symptoms:** Gate blocks a legitimate change

**Solutions:**
1. Review the gate rules in the script
2. If the change is intentional and safe:
   - Document the change in PR
   - Get manual approval
   - Consider updating gate rules if pattern is safe
3. For emergency deploys:
   ```bash
   SKIP_DIFF_GATE=true npm run deploy
   ```
   ⚠️ **Not recommended** - Use only with manual verification

## Integration Points

### Local Development

Run before committing infrastructure changes:

```bash
npm run determinism:check
```

### CI/CD Pipeline

Add as a required check in GitHub Actions:

```yaml
- name: Deploy Determinism Check
  run: npm run determinism:check
  
- name: Upload Report
  uses: actions/upload-artifact@v3
  with:
    name: determinism-report
    path: artifacts/determinism-report.json
```

### Pre-Deploy Hook

Run automatically before deploy:

```bash
npm run determinism:check && npm run deploy
```

## Related Documentation

- [Build Determinism Criteria](../BUILD_DETERMINISM_CRITERIA.md)
- [Deploy Process](../runbooks/deploy-process.md)
- [CDK Diff Gate Validation](../../scripts/validate-cdk-diff.ts)
- [Synth with Validation](../../scripts/synth-with-validation.ts)

## Maintenance

This playbook should be reviewed and updated when:

1. New critical resource types are added to infrastructure
2. Gate rules need adjustment based on operational experience
3. CDK or AWS service behavior changes
4. New deployment patterns are adopted

Last updated: 2025-12-30
