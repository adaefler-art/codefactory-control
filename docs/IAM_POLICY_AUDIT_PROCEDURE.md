# IAM Policy Audit Procedure

## Purpose

This document defines the regular audit procedure for IAM policies in the AFU-9 system to ensure continued compliance with the **Least Privilege Principle** and prevent security drift over time.

## Audit Schedule

- **Frequency**: Quarterly (every 3 months)
- **Owner**: Security Team / DevOps Lead
- **Next Review Date**: Track in [SECURITY.md](SECURITY.md)

## Automated Validation

### CI/CD Integration

All IAM policy changes are automatically validated on every pull request via the `security-validation.yml` workflow:

```bash
# Manual execution
npm run validate-iam
```

**What it checks:**
- ✅ No wildcard resources on forbidden actions
- ✅ Resource scoping to `afu9/*` prefix
- ✅ No broad action permissions (`*` or `service:*`)
- ✅ Wildcard justifications are documented
- ✅ Required resource prefixes are present

### Running Validation Locally

```bash
# Install dependencies
npm install

# Run validation script
npm run security:check

# Or directly
npm run validate-iam
```

## Manual Audit Checklist

### 1. Policy Inventory Review

**Objective**: Verify all IAM roles are documented and necessary

**Steps:**

1. List all IAM roles in the account:
```bash
aws iam list-roles --query 'Roles[?RoleName | starts_with(@, `afu9`)].RoleName' --output table
```

2. Expected roles:
   - [ ] `afu9-ecs-task-execution-role-stage`
   - [ ] `afu9-ecs-task-execution-role-prod`
   - [ ] `afu9-ecs-task-role-stage`
   - [ ] `afu9-ecs-task-role-prod`
   - [ ] `afu9-github-actions-deploy-role`

3. Document any unexpected roles and determine if they should be removed

### 2. Wildcard Resource Audit

**Objective**: Confirm all wildcard resources are justified by AWS service limitations

**Steps:**

1. Review current wildcard usage in code:
```bash
grep -r "resources.*\['\\*'\]" lib/
```

2. Expected wildcards (as of 2024-12):
   - [ ] `ecr:GetAuthorizationToken` in `afu9-iam-stack.ts` (AWS limitation)
   - [ ] CloudWatch Metrics actions in `afu9-ecs-stack.ts` (AWS limitation)

3. For each wildcard found:
   - [ ] Check if it's in the `ALLOWED_WILDCARDS` list in `scripts/validate-iam-policies.ts`
   - [ ] Verify AWS documentation still confirms the limitation
   - [ ] Ensure in-code comment explains the justification
   - [ ] Check if AWS has added resource-level permissions since last review

4. If new wildcards appear:
   - [ ] Investigate why they were added
   - [ ] Request justification and AWS documentation
   - [ ] Add to validation script if legitimate
   - [ ] Remove if not necessary

### 3. Resource Scoping Audit

**Objective**: Ensure all resources remain scoped to AFU-9 namespace

**Steps:**

1. Review resource ARN patterns:
```bash
grep -A5 "resources:" lib/*-stack.ts | grep -E "arn:aws|afu9"
```

2. Verify resource scoping:
   - [ ] Secrets: All start with `afu9/` prefix
   - [ ] ECR Repositories: All in `afu9/*` namespace
   - [ ] ECS Resources: All use `afu9-cluster` or `afu9-*` prefix
   - [ ] CloudWatch Logs: All in `/ecs/afu9/*` namespace
   - [ ] No resources from other applications accessible

3. Check for hardcoded account IDs or regions:
   - [ ] Use `${this.account}` and `${this.region}` instead
   - [ ] Ensure cross-region access is intentional if found

### 4. Action Minimization Audit

**Objective**: Confirm each role has only necessary actions

**Steps:**

For each role, review actions and justify:

#### Task Execution Role
- [ ] ECR read permissions - Required for pulling images
- [ ] CloudWatch Logs write - Required for container logs
- [ ] Secrets Manager read - Required for injecting secrets

#### Task Role
- [ ] CloudWatch read permissions - Required for MCP Observability
- [ ] ECS describe permissions - Required for MCP Deploy monitoring
- [ ] ECS update permissions - Required for MCP Deploy automation
- [ ] Secrets Manager read - Required for runtime secret refresh

#### GitHub Actions Deploy Role
- [ ] ECR push permissions - Required for image deployment
- [ ] ECS update permissions - Required for triggering deployments
- [ ] IAM PassRole (constrained) - Required for ECS to use roles

### 5. Privilege Escalation Audit

**Objective**: Ensure no roles can escalate their own privileges

**Steps:**

1. Check for dangerous permission combinations:
   - [ ] No role has both `iam:CreateRole` and `iam:AttachRolePolicy`
   - [ ] No role has both `iam:PutRolePolicy` and `iam:PassRole` without conditions
   - [ ] No role can modify its own trust policy
   - [ ] No role can attach admin policies

2. Verify PassRole conditions:
```bash
grep -A10 "iam:PassRole" lib/*-stack.ts
```
   - [ ] PassRole is conditioned on `iam:PassedToService`
   - [ ] Only specific role ARNs can be passed
   - [ ] Passed roles are scoped to AFU-9 only

### 6. Cross-Service Permission Audit

**Objective**: Verify service-to-service access is appropriate

**Steps:**

1. Map service interactions:
   - [ ] Control Center → GitHub MCP (localhost)
   - [ ] Control Center → Deploy MCP (localhost)
   - [ ] Control Center → Observability MCP (localhost)
   - [ ] Deploy MCP → ECS (AWS API)
   - [ ] Observability MCP → CloudWatch (AWS API)
   - [ ] All MCP → Secrets Manager (AWS API)

2. Verify each service has only permissions for its responsibilities:
   - [ ] Control Center: No direct AWS permissions (MCP pattern)
   - [ ] Deploy MCP: Only ECS describe/update
   - [ ] Observability MCP: Only CloudWatch read
   - [ ] GitHub MCP: Only GitHub API (no AWS permissions needed)

### 7. Documentation Audit

**Objective**: Ensure all permissions are documented

**Steps:**

1. Review [IAM-ROLES-JUSTIFICATION.md](IAM-ROLES-JUSTIFICATION.md):
   - [ ] All roles documented
   - [ ] All permissions explained
   - [ ] Alternatives considered section is complete
   - [ ] Security best practices section is current

2. Review [SECURITY-IAM.md](SECURITY-IAM.md):
   - [ ] Policy examples are accurate
   - [ ] Resource scoping guidance is correct
   - [ ] Trust policies are up to date
   - [ ] Secrets management section reflects current practice

3. Check inline code comments:
```bash
grep -B5 -A5 "Justification:" lib/*-stack.ts
```
   - [ ] Each PolicyStatement has a justification comment
   - [ ] Resource scope reasoning is explained
   - [ ] Wildcard usage is explained

### 8. Change History Review

**Objective**: Track and understand policy evolution

**Steps:**

1. Review recent IAM-related commits:
```bash
git log --since="3 months ago" --oneline -- lib/*-stack.ts | grep -i "iam\|policy\|permission\|role"
```

2. For each change:
   - [ ] Understand why the change was made
   - [ ] Verify change was reviewed by security team
   - [ ] Check if documentation was updated
   - [ ] Confirm change aligns with least privilege

### 9. AWS Service Updates Check

**Objective**: Stay current with AWS permission model changes

**Steps:**

1. Review AWS IAM service updates:
   - [ ] Check [AWS IAM What's New](https://aws.amazon.com/iam/whats-new/)
   - [ ] Review [AWS Security Blog](https://aws.amazon.com/blogs/security/)
   - [ ] Check for new resource-level permission support

2. Services to monitor:
   - [ ] Amazon ECR
   - [ ] Amazon ECS
   - [ ] AWS Secrets Manager
   - [ ] Amazon CloudWatch
   - [ ] AWS IAM

3. Apply improvements:
   - [ ] If wildcard can now be scoped, update policy
   - [ ] If new condition keys available, add constraints
   - [ ] If finer-grained permissions available, use them

### 10. Incident Review

**Objective**: Learn from security events

**Steps:**

1. Review CloudTrail for IAM-related events:
```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceType,AttributeValue=AWS::IAM::Role \
  --start-time $(date -d '3 months ago' +%s) \
  --max-results 50
```

2. Check for:
   - [ ] AccessDenied errors (might indicate overly restrictive policies)
   - [ ] Suspicious AssumeRole calls
   - [ ] Policy modification attempts
   - [ ] Unusual API call patterns

3. Review CloudWatch Logs for application errors:
   - [ ] Permission denied errors in application logs
   - [ ] Failed AWS API calls
   - [ ] Secrets access failures

## Audit Report Template

After completing the audit, document findings:

```markdown
# IAM Policy Audit Report
**Date**: [YYYY-MM-DD]
**Auditor**: [Name]
**Audit Period**: [Start Date] to [End Date]

## Executive Summary
[Brief overview of findings]

## Findings

### Compliant Items
- [List policies/roles that passed all checks]

### Issues Found
| Severity | Issue | Location | Recommendation | Status |
|----------|-------|----------|----------------|--------|
| High/Medium/Low | Description | File:Line | Action needed | Open/Resolved |

### Changes Since Last Audit
- [List any policy changes in the audit period]

### Recommendations
1. [Recommendation 1]
2. [Recommendation 2]

## Action Items
- [ ] [Action item 1 - Owner - Due date]
- [ ] [Action item 2 - Owner - Due date]

## Next Audit
**Scheduled Date**: [YYYY-MM-DD]
**Focus Areas**: [Any specific areas to review]
```

## Remediation Process

If issues are found:

### High Severity (Immediate Action Required)
- **Examples**: Wildcard on forbidden actions, privilege escalation path
- **Timeline**: Fix within 24 hours
- **Process**:
  1. Create emergency fix PR
  2. Get security team approval
  3. Deploy to production immediately
  4. Update documentation

### Medium Severity (Action Required)
- **Examples**: Overly broad resource scope, missing documentation
- **Timeline**: Fix within 1 week
- **Process**:
  1. Create fix PR with proper justification
  2. Get peer review
  3. Deploy in next maintenance window
  4. Update audit checklist if needed

### Low Severity (Improvement Opportunity)
- **Examples**: Could use finer-grained permissions, better naming
- **Timeline**: Fix in next quarterly cycle
- **Process**:
  1. Add to backlog
  2. Prioritize against other work
  3. Include in next regular release

## Continuous Improvement

### Metrics to Track

Track these metrics over time to measure security posture:

1. **Wildcard Resource Count**
   - Target: ≤ 2 (only AWS service limitations)
   - Current: [X]

2. **Policy Statements per Role**
   - Task Execution Role: [X]
   - Task Role: [X]
   - Deploy Role: [X]

3. **Average Actions per Statement**
   - Target: ≤ 10 actions per statement
   - Current: [X]

4. **Resource Scope Compliance**
   - Target: 100% scoped to afu9 namespace
   - Current: [X]%

5. **Documentation Coverage**
   - Target: 100% of policies have justifications
   - Current: [X]%

6. **Access Denied Errors (False Positives)**
   - Target: 0 per month
   - Current: [X]

7. **Time to Remediate Issues**
   - High: [X] hours
   - Medium: [X] days
   - Low: [X] weeks

### Improvement Initiatives

Based on audit findings, consider:

1. **Policy Optimization**
   - Combine related statements
   - Use more specific actions
   - Add conditions to further restrict

2. **Automation Enhancement**
   - Add more checks to validation script
   - Create automated remediation for common issues
   - Improve error messages

3. **Documentation Improvement**
   - Add more examples
   - Create decision flowcharts
   - Document common pitfalls

4. **Training**
   - Security training for developers
   - IAM best practices workshops
   - Share audit findings

## References

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Least Privilege Principle](https://csrc.nist.gov/glossary/term/least_privilege)
- [AFU-9 IAM Roles Justification](IAM-ROLES-JUSTIFICATION.md)
- [AFU-9 Security IAM Guide](SECURITY-IAM.md)
- [AWS Service Authorization Reference](https://docs.aws.amazon.com/service-authorization/latest/reference/)

## Contact

For questions or concerns about IAM policies:
- **Security Team**: security@yourdomain.com
- **DevOps Lead**: devops@yourdomain.com
- **Escalation**: CTO

---

**Last Updated**: 2024-12-17
**Next Review**: 2025-03-17
**Document Owner**: Security Team
