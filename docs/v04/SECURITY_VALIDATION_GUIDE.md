# Security Validation Quick Reference

## EPIC 07: Security & Blast Radius Minimization

### Quick Commands

```bash
# Validate all IAM policies
npm run validate-iam

# Run security checks (alias)
npm run security:check

# Run full test suite including validation
npx ts-node scripts/test-iam-validation.ts
```

### Pre-Deployment Checklist

Before deploying any stack with IAM policies:

- [ ] Run `npm run security:check` locally
- [ ] All validation checks pass (exit code 0)
- [ ] Review any INFO messages for wildcard justifications
- [ ] Ensure no ERROR or WARNING messages
- [ ] Document any new wildcard usages

### Automated Checks

The following are automatically validated on every PR:

✅ **No wildcard resources on forbidden actions**
- `iam:CreateRole`, `iam:DeleteRole`
- `rds:DeleteDBInstance`, `rds:DeleteDBCluster`
- `ec2:TerminateInstances`, `ec2:DeleteSecurityGroup`
- `ecs:DeleteCluster`, `ecs:DeleteService`
- `s3:DeleteBucket`

✅ **Resource scoping enforced**
- Secrets Manager: Must include `afu9/` prefix
- ECR: Must include `afu9/` prefix
- ECS: Must include `afu9-cluster`
- CloudWatch Logs: Must include `/ecs/afu9/`

✅ **No broad action permissions**
- No `service:*` permissions
- No `*` in action field

✅ **Justified wildcards only**
- `ecr:GetAuthorizationToken` with `*` - AWS limitation ✓
- `cloudwatch:*` with `*` - AWS limitation ✓

### Understanding Results

#### Exit Code 0 - ✅ Pass
All policies comply. Safe to deploy.

#### Exit Code 1 - ❌ Fail
Policy violations detected. Must fix before deploying.

#### Result Categories

**ERROR** - Must fix
- Blocks deployment
- Security violation detected
- Manual review required

**WARNING** - Should review
- Potential issue
- May need justification
- Consider revision

**INFO** - For awareness
- Documented exception
- AWS service limitation
- No action needed

### Example Output

```
================================================================================
VALIDATION RESULTS
================================================================================

ℹ️  INFO (for awareness):
  afu9-ecs-stack.ts:463 [CloudWatchMetricsAccess]
    Wildcard resource justified for: cloudwatch:GetMetricStatistics
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

### Adding New IAM Policies

When adding new IAM policies:

1. **Scope resources** to `afu9/*` prefix
2. **Use specific actions** (no wildcards)
3. **Document wildcards** if absolutely necessary
4. **Run validation** before committing
5. **Update allowed list** if justified

Example:
```typescript
new iam.PolicyStatement({
  sid: 'MyNewPolicy',
  effect: iam.Effect.ALLOW,
  actions: [
    's3:GetObject',
    's3:PutObject',
  ],
  resources: [
    `arn:aws:s3:::afu9-bucket/*`,  // ✓ Scoped to afu9
  ],
})
```

### Common Issues

#### Issue: "Action must have resources scoped to: afu9/"
**Solution**: Add `afu9/` prefix to resource ARN

#### Issue: "Wildcard resource used for unallowed action"
**Solution**: Either scope the resource or add justification

#### Issue: "Overly broad action permissions"
**Solution**: Replace `service:*` with specific actions

### Documentation

- Full implementation: `EPIC07_SECURITY_IMPLEMENTATION.md`
- IAM justifications: `docs/IAM-ROLES-JUSTIFICATION.md`
- Security guide: `docs/SECURITY-IAM.md`
- Main security doc: `SECURITY.md`

### Support

For questions or issues:
- Open an issue with `security` label
- Review existing documentation
- Contact the security team

---

**Remember**: Security is everyone's responsibility. When in doubt, ask for review.
