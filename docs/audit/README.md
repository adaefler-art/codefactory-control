# AFU-9 Audit Documentation

This directory contains all audit reports, compliance checks, and security reviews organized by version.

## Version-Specific Audits

### [v0.4 Audits](v0.4/)
- IAM Policy Audit Procedure

### [v0.7 Audits](v0.7/)
- Comprehensive v0.7 Audit (PR #632)
  - Roadmap Parity Report
  - Endpoint Inventory (137 endpoints)
  - Endpoint-UI Matrix
  - Documentation Index (93 files)
  - Configuration Surface Audit (70+ env vars)
  - Docs Policy
- Consistency Report (API handlers, error envelopes)
- Issue #3 Guard Audit (Production guards)

---

## Audit Types

### 1. Version Release Audits
Comprehensive reviews before version releases covering:
- Feature completeness (roadmap parity)
- API endpoint inventory
- UI exposure analysis
- Documentation completeness
- Configuration surface

### 2. Security Audits
- IAM policy reviews
- Secret handling
- Production guard implementations
- Access control policies

### 3. Technical Consistency Audits
- API handler patterns
- Error envelope shapes
- Code style consistency
- Naming conventions

---

## Running Audits

### Automated Checks

```bash
# IAM policy validation
npm run validate-iam

# Endpoint inventory generation
node scripts/generate-endpoint-inventory.js

# Build determinism check
npm run determinism:check
```

### Manual Audits

Follow the procedures in version-specific folders:
- [v0.4 IAM Policy Audit](v0.4/IAM_POLICY_AUDIT_PROCEDURE.md)
- [v0.7 Comprehensive Audit](v0.7/README.md)

---

## Audit Schedule

| Audit Type | Frequency | Owner |
|------------|-----------|-------|
| IAM Policies | Quarterly | Security Team |
| API Consistency | Per Release | Tech Lead |
| Documentation | Per Release | Product Owner |
| Version Comprehensive | Before Major/Minor Release | Engineering Lead |

---

See also:
- [Guardrails Documentation](../guardrails/)
- [Security Policy](../../SECURITY.md)
- [Docs Policy](v0.7/DOCS_POLICY.md)
