# EPIC 07: Security & Blast Radius Minimization

## Overview

This document describes the security hardening measures implemented in EPIC 07 to minimize attack surface and enforce least privilege principles across all MCP servers and infrastructure components.

## Implementation Summary

### Date: December 2024
### Status: ✅ Complete

## Security Objectives

1. **Minimize Risks and Attack Vectors** for MCP servers through strict IAM policies
2. **Enforce Least Privilege Principle** for all components
3. **Eliminate Wildcard Access** where possible
4. **Ensure Reviewed Policies** before deployment

## Key Performance Indicator (KPI)

- **KPI**: Security Incidents
- **Target**: Zero security incidents related to IAM misconfiguration
- **Measurement**: Automated policy validation + manual review process

## Components Secured

### 1. MCP Servers

All MCP servers follow strict IAM policies with resource-level scoping:

#### GitHub MCP Server (`mcp-github`)
- **Secrets Access**: Scoped to `afu9/github` only
- **No AWS Permissions**: Uses GitHub token for API access
- **Authentication**: Token stored in AWS Secrets Manager

#### Deploy MCP Server (`mcp-deploy`)
- **ECS Permissions**: Scoped to `afu9-cluster` resources only
- **UpdateService**: Limited to `afu9-cluster/*` services
- **No Destructive Actions**: Cannot delete clusters or services

#### Observability MCP Server (`mcp-observability`)
- **CloudWatch Logs**: Scoped to `/ecs/afu9/*` log groups only
- **CloudWatch Metrics**: Global service (AWS limitation, documented)
- **Read-Only Focus**: No write permissions except PutMetricData

### 2. ECS Task Roles

#### Task Execution Role
- **Purpose**: Infrastructure operations only (pull images, write logs)
- **ECR Access**: Image pulls from `afu9/*` repositories
- **Secrets**: Read access to `afu9/*` secrets only
- **No Application Access**: Cannot query AWS services

#### Task Role
- **Purpose**: Application operations only
- **Scoped Resources**: All ARNs include `afu9` or `/ecs/afu9/` prefix
- **Minimal Actions**: Only actions required for MCP server functionality
- **Separated from Execution**: Clear boundary between infrastructure and app

### 3. GitHub Actions Deploy Role

- **OIDC Authentication**: No long-term credentials
- **Repository-Scoped**: Only specific GitHub repo can assume role
- **ECR Push**: Limited to `afu9/*` repositories
- **ECS Deploy**: Limited to `afu9-cluster` services
- **PassRole**: Can only pass two specific roles to ECS tasks

## Wildcard Usage Justification

All wildcard resource usages are **documented and justified**:

### Allowed Wildcards

| Action | Resource | Justification |
|--------|----------|---------------|
| `ecr:GetAuthorizationToken` | `*` | AWS service limitation - action doesn't support resource-level permissions |
| `cloudwatch:GetMetricStatistics` | `*` | AWS service limitation - CloudWatch Metrics is a global service |
| `cloudwatch:GetMetricData` | `*` | AWS service limitation - CloudWatch Metrics is a global service |
| `cloudwatch:ListMetrics` | `*` | AWS service limitation - CloudWatch Metrics is a global service |
| `cloudwatch:DescribeAlarms` | `*` | AWS service limitation - CloudWatch Metrics is a global service |
| `cloudwatch:PutMetricData` | `*` | AWS service limitation - CloudWatch Metrics is a global service |

### Secret Rotation Wildcards

Database secret ARNs use trailing wildcards (`afu9/database/master*`) to support AWS Secrets Manager rotation, which appends suffixes to secret names.

## Security Validation Tools

### 1. Automated IAM Policy Validator

**Script**: `scripts/validate-iam-policies.ts`

**Features**:
- Parses CDK TypeScript stacks to extract IAM policies
- Validates resource scoping to `afu9/*` prefix
- Checks for forbidden wildcard actions
- Verifies least privilege principles
- Provides actionable error messages

**Usage**:
```bash
npm run validate-iam
# or
npm run security:check
```

**Exit Codes**:
- `0`: All policies compliant
- `1`: Violations detected (blocks deployment)

### 2. GitHub Actions Security Workflow

**Workflow**: `.github/workflows/security-validation.yml`

**Triggers**:
- Pull requests modifying IAM policies
- Push to main branch
- Manual dispatch

**Checks**:
1. Automated policy validation
2. Detection of IAM policy changes
3. PR comment with security review checklist
4. Blocking on validation failures

### 3. Pre-Deployment Checklist

Before deploying any stack with IAM policies:

- [ ] Run `npm run validate-iam` locally
- [ ] Review all wildcard usages
- [ ] Verify resource scoping includes `afu9` prefix
- [ ] Check action permissions are minimal
- [ ] Update IAM justification docs if needed

## Security Best Practices Enforced

### 1. Least Privilege

✅ **All roles have minimum permissions needed**
- Task Execution Role: Only infrastructure operations
- Task Role: Only application operations needed by MCP servers
- Deploy Role: Only CI/CD operations

### 2. Resource Scoping

✅ **All resources include project-specific prefix**
- Secrets: `afu9/*`
- ECR: `afu9/*`
- ECS: `afu9-cluster`
- CloudWatch Logs: `/ecs/afu9/*`

### 3. No Wildcard Actions

✅ **No actions use wildcards or `*`**
- All actions explicitly listed
- No `service:*` permissions

### 4. Separation of Concerns

✅ **Clear role boundaries**
- Infrastructure vs Application
- Runtime vs Deployment
- Read vs Write operations

### 5. Defense in Depth

✅ **Multiple security layers**
- IAM roles (authorization)
- Security groups (network)
- Secrets Manager (credentials)
- VPC private subnets (isolation)

### 6. No Long-Term Credentials

✅ **Temporary credentials only**
- OIDC for GitHub Actions
- IAM roles for ECS tasks
- No access keys in code

## Security Testing

### Validation Coverage

The automated validator checks:

1. ✅ No wildcard resources on forbidden actions (e.g., `iam:DeleteRole`, `rds:DeleteDBInstance`)
2. ✅ Required resource prefixes present (`afu9/`, `afu9-cluster`, `/ecs/afu9/`)
3. ✅ No overly broad action permissions (`*`, `service:*`)
4. ✅ Documented justifications for allowed wildcards

### Test Results

```
================================================================================
AFU-9 IAM Policy Security Validation
EPIC 07: Security & Blast Radius Minimization
================================================================================

Validating: lib/afu9-ecs-stack.ts
  Found 5 policy statements

Validating: lib/afu9-iam-stack.ts
  Found 4 policy statements

================================================================================
VALIDATION RESULTS
================================================================================

ℹ️  INFO (for awareness):
  afu9-ecs-stack.ts:463 [CloudWatchMetricsAccess]
    Wildcard resource justified for: cloudwatch:GetMetricStatistics, ...
    Reason: AWS service limitation

  afu9-iam-stack.ts:94 [ECRAuthenticationAndImagePush]
    Wildcard resource justified for: ecr:GetAuthorizationToken
    Reason: AWS service limitation

================================================================================
SUMMARY
================================================================================
Errors:   0
Warnings: 0
Info:     2
================================================================================

✅ All IAM policies comply with security requirements!
```

## Documentation Updates

### Updated Files

1. **docs/SECURITY-IAM.md** - IAM roles and policies reference
2. **docs/IAM-ROLES-JUSTIFICATION.md** - Detailed justifications for all permissions
3. **SECURITY.md** - Overall security practices
4. **This file** - EPIC 07 implementation summary

### New Files

1. **scripts/validate-iam-policies.ts** - Automated security validation
2. **.github/workflows/security-validation.yml** - CI/CD security checks

## Deployment Impact

### Changes to Existing Policies

✅ **No breaking changes** - All existing policies remain compliant

### New Security Requirements

1. All new IAM policies must pass automated validation
2. Pull requests with IAM changes require manual security review
3. Wildcard usages must be documented with justifications

## Monitoring & Compliance

### Continuous Monitoring

- **CloudTrail**: All IAM role assumptions logged
- **CloudWatch Alarms**: Unauthorized API calls detected
- **GitHub Actions**: Automated validation on every PR

### Compliance Checklist

- [x] All IAM policies validated
- [x] Wildcard usages documented
- [x] Resource scoping enforced
- [x] Least privilege principle applied
- [x] Automated validation implemented
- [x] CI/CD integration complete
- [x] Documentation updated

## Future Enhancements

### Planned Improvements

1. **Service Control Policies (SCPs)**
   - Implement organization-level SCPs
   - Prevent privilege escalation

2. **AWS Config Rules**
   - Continuous compliance monitoring
   - Automatic remediation

3. **IAM Access Analyzer**
   - Detect overly permissive policies
   - External access validation

4. **Policy Simulator Testing**
   - Test policies before deployment
   - Validate permission boundaries

## References

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Principle of Least Privilege](https://csrc.nist.gov/glossary/term/least_privilege)
- [AWS Well-Architected Framework - Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)

## Contact

For security concerns or questions:
- Open an issue with `security` label
- Contact the security team
- **Do not** disclose vulnerabilities publicly

---

**Status**: ✅ COMPLETE  
**Impact**: Minimized attack surface across all AFU-9 components  
**KPI**: Zero security incidents related to IAM policies  
**Last Updated**: December 2024
