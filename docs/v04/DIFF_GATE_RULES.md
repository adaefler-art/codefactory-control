# AFU-9 CDK Diff Gate Rules

**Version:** 1.0  
**Issue:** I-03-01-DIFF-GATE  
**Last Updated:** 2025-12-20

## Overview

The Diff Gate is a mandatory validation step that runs before any CDK deployment. It analyzes the output of `cdk diff` to identify potentially dangerous infrastructure changes that could cause downtime, data loss, or service interruption.

**Key Principle:** Deploy should only proceed if the diff contains expected, safe changes.

## How It Works

```
┌─────────────────┐
│  CDK Diff       │
│  (Infrastructure│
│   Changes)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Diff Parser    │
│  (Pattern       │
│   Matching)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Gate Rules     │
│  - Blocking     │
│  - Warning      │
│  - Safe         │
└────────┬────────┘
         │
         ▼
    ┌────┴────┐
    │         │
    ▼         ▼
 ✗ FAIL    ✓ PASS
 Exit 1    Exit 0
```

## Blocking Changes

These changes **PREVENT** deployment. Manual review and explicit approval required.

### 1. ECS Service Replacement

**Pattern:** `[~] AWS::ECS::Service (replacement)`

**Why Blocked:**
- Causes service downtime during replacement
- Terminates existing tasks before starting new ones
- DNS endpoints may change
- Circuit breaker cannot prevent impact

**Example:**
```
[~] AWS::ECS::Service Afu9EcsStack/Afu9Service (replacement)
    └─ [~] ServiceName (requires replacement)
```

**How to Fix:**
- Avoid changing service name or cluster
- Use blue/green deployment instead
- Consider manual service migration

### 2. DNS Record Deletion or Replacement

**Pattern:** 
- `[-] AWS::Route53::RecordSet`
- `[~] AWS::Route53::RecordSet (replacement)`

**Why Blocked:**
- Breaks DNS resolution immediately
- Can cause service unavailability
- DNS propagation delays (up to 48 hours for some resolvers)
- No graceful migration path

**Example:**
```
[-] AWS::Route53::RecordSet Afu9NetworkStack/ControlCenterDNS
```

**How to Fix:**
- Never delete production DNS records without migration plan
- For replacement: create new record, test, then delete old
- Update DNS gradually with low TTL values

### 3. ACM Certificate Deletion or Replacement

**Pattern:**
- `[-] AWS::CertificateManager::Certificate`
- `[~] AWS::CertificateManager::Certificate (replacement)`

**Why Blocked:**
- Breaks HTTPS immediately
- Replacement requires DNS revalidation (can take hours)
- ALB listener update required
- No automatic rollback

**Example:**
```
[~] AWS::CertificateManager::Certificate Afu9DnsStack/Certificate (replacement)
    └─ [~] DomainName (requires replacement)
```

**How to Fix:**
- Create new certificate first
- Validate via DNS
- Update ALB listener
- Delete old certificate

### 4. Security Group Deletion

**Pattern:** `[-] AWS::EC2::SecurityGroup`

**Why Blocked:**
- Breaks connectivity for attached resources
- Cannot be reversed without recreating
- May affect multiple services
- Causes immediate service disruption

**Example:**
```
[-] AWS::EC2::SecurityGroup Afu9NetworkStack/EcsSecurityGroup
```

**How to Fix:**
- Create new security group first
- Migrate resources to new group
- Verify connectivity
- Delete old group

### 5. RDS Instance Replacement

**Pattern:** `[~] AWS::RDS::DBInstance (replacement)`

**Why Blocked:**
- Data migration required
- Downtime during replacement
- Snapshot/restore process needed
- Connection string changes

**Example:**
```
[~] AWS::RDS::DBInstance Afu9DatabaseStack/Database (replacement)
    └─ [~] DBInstanceClass (requires replacement)
```

**How to Fix:**
- Plan maintenance window
- Create snapshot
- Create new instance from snapshot
- Update connection strings
- Delete old instance

### 6. Load Balancer Replacement

**Pattern:** `[~] AWS::ElasticLoadBalancingV2::LoadBalancer (replacement)`

**Why Blocked:**
- DNS endpoint changes
- Requires DNS record update
- DNS propagation delays
- Service interruption during switch

**Example:**
```
[~] AWS::ElasticLoadBalancingV2::LoadBalancer Afu9NetworkStack/ALB (replacement)
    └─ [~] Scheme (requires replacement)
```

**How to Fix:**
- Create new ALB
- Configure target groups and listeners
- Update DNS to new ALB
- Monitor traffic switch
- Delete old ALB

## Warning Changes

These changes are **ALLOWED** but flagged for review. Deployment proceeds with warnings.

### 1. Security Group Rule Modifications

**Pattern:**
- `[~] AWS::EC2::SecurityGroup SecurityGroupIngress`
- `[~] AWS::EC2::SecurityGroup SecurityGroupEgress`

**Why Warning:**
- May restrict or expand access unintentionally
- Could break connectivity if not carefully planned
- Requires verification of access requirements

**Best Practice:**
- Review ingress/egress rules carefully
- Verify required ports and protocols
- Test connectivity after deployment
- Document rule purposes

### 2. IAM Role Modifications

**Pattern:** `[~] AWS::IAM::Role`

**Why Warning:**
- May grant or revoke permissions
- Could break service if permissions removed
- Security implications if permissions expanded

**Best Practice:**
- Follow least privilege principle
- Review permission changes
- Test service functionality
- Document permission justifications

### 3. IAM Policy Modifications

**Pattern:** `[~] AWS::IAM::Policy`

**Why Warning:**
- Direct impact on service capabilities
- Potential security implications
- May cause permission denied errors

**Best Practice:**
- Review policy changes in detail
- Use AWS IAM Policy Simulator to test
- Verify all required actions are permitted
- Check for overly broad permissions

## Safe Changes

These changes are **EXPLICITLY SAFE** and proceed without warnings.

### 1. ECS Task Definition Updates

**Pattern:** `[~] AWS::ECS::TaskDefinition`

**Why Safe:**
- Rolling update with zero downtime
- Circuit breaker can rollback
- Container image updates are expected
- Environment variable changes are safe

**Example:**
```
[~] AWS::ECS::TaskDefinition Afu9EcsStack/TaskDef
    └─ [~] ContainerDefinitions[0].Image
        └─ [~] .Image:
            ├─ [-] xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:abc1234
            └─ [+] xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:def5678
```

**Validation:**
- Circuit breaker enabled: tasks must pass health checks
- Rolling deployment: old tasks continue serving traffic
- Automatic rollback on failure

### 2. New Resources

**Pattern:** `[+] AWS::*`

**Why Safe:**
- Additive change (non-destructive)
- Doesn't affect existing resources
- Can be reversed by deletion

**Example:**
```
[+] AWS::CloudWatch::Alarm Afu9AlarmsStack/HighCPUAlarm
[+] AWS::Lambda::Function Afu9DeployMemoryStack/AnalysisFunction
```

**Validation:**
- New resources don't interfere with existing ones
- Proper IAM permissions configured
- Resources tagged appropriately

## Usage

### Command Line

```bash
# Validate specific stack
npm run validate:diff -- Afu9EcsStack

# With context parameters
npm run validate:diff -- Afu9EcsStack -c environment=production

# Output as JSON for CI/CD
OUTPUT_JSON=true npm run validate:diff -- Afu9EcsStack
```

### GitHub Actions Integration

```yaml
- name: CDK Diff Gate
  run: npm run validate:diff -- Afu9EcsStack
  env:
    AWS_REGION: eu-central-1
```

### Skip Gate (NOT Recommended)

```bash
# Only for emergency or testing
SKIP_DIFF_GATE=true npm run validate:diff -- Afu9EcsStack
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Diff is safe to deploy | Proceed with deployment |
| 1 | Diff contains blocking changes | Review and fix, or get approval |
| 2 | Script error or invalid input | Fix script usage or configuration |

## Output Format

### Console Output (Default)

```
=====================================
CDK Diff Gate Validation Results
=====================================

Stack: Afu9EcsStack
Status: ✓ PASS

✓ SAFE CHANGES (2 total):

  ✓ AWS::ECS::TaskDefinition (modify)
     [~] TaskDefinition image update

  ✓ AWS::CloudWatch::Alarm (add)
     [+] New alarm for monitoring

=====================================
✓ Diff is safe to deploy (2 safe changes)
=====================================
```

### JSON Output

```json
{
  "success": true,
  "changes": [
    {
      "changeType": "modify",
      "resourceType": "AWS::ECS::TaskDefinition",
      "resourcePath": "[~] AWS::ECS::TaskDefinition ...",
      "severity": "safe",
      "reason": "Task Definition update (e.g., image tag change)"
    }
  ],
  "blockingChanges": [],
  "warningChanges": [],
  "safeChanges": [...],
  "message": "✓ Diff is safe to deploy (2 safe changes)"
}
```

## CI/CD Integration

### Automated Gate in GitHub Actions

The diff gate is integrated into deployment workflows:

1. **Pre-Deployment:** Gate runs before `cdk deploy`
2. **Blocking:** Workflow fails if blocking changes detected
3. **Warning:** Workflow continues with warnings logged
4. **Safe:** Workflow continues without warnings

### Manual Override Process

If blocking changes are **intentional and approved**:

1. **Document Justification:** Create issue or PR comment
2. **Get Approval:** Team lead or SRE approves
3. **Manual Deployment:** Skip gate with `SKIP_DIFF_GATE=true`
4. **Post-Deployment Verification:** Confirm services operational

## Examples

### Example 1: Safe Image Update

**Scenario:** Updating container image tag

**Diff:**
```
Stack Afu9EcsStack
[~] AWS::ECS::TaskDefinition Afu9EcsStack/TaskDef
 └─ [~] ContainerDefinitions[0].Image
```

**Result:** ✓ PASS (Safe change)

### Example 2: Blocked ECS Service Replacement

**Scenario:** Changing ECS service name

**Diff:**
```
Stack Afu9EcsStack
[~] AWS::ECS::Service Afu9EcsStack/Service (replacement)
 └─ [~] ServiceName (requires replacement)
```

**Result:** ✗ BLOCKED

**Fix:** Don't change service name, or plan migration

### Example 3: Warning for Security Group Rule

**Scenario:** Adding new ingress rule to security group

**Diff:**
```
Stack Afu9NetworkStack
[~] AWS::EC2::SecurityGroup Afu9NetworkStack/EcsSecurityGroup
 └─ [~] SecurityGroupIngress
```

**Result:** ✓ PASS (Warning issued)

**Action:** Review rule before deployment

## Troubleshooting

### Issue: Diff gate fails with "Stack does not exist"

**Cause:** Stack hasn't been deployed yet

**Solution:**
- For first deployment, skip gate: `SKIP_DIFF_GATE=true`
- Or deploy manually first time
- Gate activates on subsequent deployments

### Issue: Legitimate change is blocked

**Cause:** Pattern matches blocking rule

**Solution:**
1. Verify change is intentional
2. Get team approval
3. Document in PR/issue
4. Deploy with `SKIP_DIFF_GATE=true`
5. Consider updating gate rules if pattern is too broad

### Issue: False positive on safe change

**Cause:** Change not recognized by safe patterns

**Solution:**
1. Review the change manually
2. If safe, update `SAFE_PATTERNS` in script
3. Submit PR to improve gate logic

## Maintenance

### Updating Gate Rules

To add or modify gate rules:

1. Edit `scripts/validate-cdk-diff.ts`
2. Update `BLOCKING_PATTERNS`, `WARNING_PATTERNS`, or `SAFE_PATTERNS`
3. Test with sample diffs
4. Update this documentation
5. Submit PR for review

### Testing Gate Rules

```bash
# Test with known safe changes
npm run validate:diff -- Afu9EcsStack

# Test with blocking changes (in feature branch)
# 1. Make blocking change in code
# 2. Run validation
# 3. Verify it blocks correctly
# 4. Revert change
```

## References

- [AWS Deploy Runbook](./AWS_DEPLOY_RUNBOOK.md)
- [ECS Deployment Guide](./ECS-DEPLOYMENT.md)
- [ECS Configuration Reference](./ECS_CONFIG_REFERENCE.md)
- [CDK Best Practices](https://docs.aws.amazon.com/cdk/latest/guide/best-practices.html)

## Appendix: Complete Pattern List

### Blocking Patterns

```typescript
const BLOCKING_PATTERNS = [
  { pattern: /\[~\].*AWS::ECS::Service.*\(replacement\)/i },
  { pattern: /\[-\].*AWS::Route53::RecordSet/i },
  { pattern: /\[~\].*AWS::Route53::RecordSet.*\(replacement\)/i },
  { pattern: /\[-\].*AWS::CertificateManager::Certificate/i },
  { pattern: /\[~\].*AWS::CertificateManager::Certificate.*\(replacement\)/i },
  { pattern: /\[-\].*AWS::EC2::SecurityGroup/i },
  { pattern: /\[~\].*AWS::RDS::DBInstance.*\(replacement\)/i },
  { pattern: /\[~\].*AWS::ElasticLoadBalancingV2::LoadBalancer.*\(replacement\)/i },
];
```

### Warning Patterns

```typescript
const WARNING_PATTERNS = [
  { pattern: /\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupIngress/i },
  { pattern: /\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupEgress/i },
  { pattern: /\[~\].*AWS::IAM::Role/i },
  { pattern: /\[~\].*AWS::IAM::Policy/i },
];
```

### Safe Patterns

```typescript
const SAFE_PATTERNS = [
  { pattern: /\[~\].*AWS::ECS::TaskDefinition/i },
  { pattern: /\[\+\]/i },  // All new resources
];
```

---

**Document Version:** 1.0  
**Compatible with:** AFU-9 v0.2.5+  
**Last Tested:** 2025-12-20
