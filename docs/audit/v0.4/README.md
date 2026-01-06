# v0.4 Audit Documentation

## Security Audits

### IAM Policy Audit Procedure
**File**: [IAM_POLICY_AUDIT_PROCEDURE.md](IAM_POLICY_AUDIT_PROCEDURE.md)

**Purpose**: Quarterly IAM policy review procedure to ensure least privilege compliance.

**Key Areas**:
- Policy inventory review
- Wildcard resource audit
- Resource scoping validation
- Action permission review
- Cross-environment access checks

**Automation**:
```bash
npm run validate-iam
```

**Schedule**: Quarterly (every 3 months)

---

See [v0.4 Release Documentation](../../v04/README.md) for full version details.
