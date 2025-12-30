# v0.6.5 Security Hardening Documentation

**Release:** v0.6.5  
**Epic:** E66 (I661)  
**Focus:** Repository Security Hardening

## Overview

This directory contains documentation for the v0.6.5 security hardening initiative, focused on making the AFU-9 repository "safe-by-default" by preventing secrets from entering the codebase.

## Documents

### [SECURITY_ROTATION.md](./SECURITY_ROTATION.md)
**Purpose:** Secret rotation evidence and procedures

**Contents:**
- Rotation status for all AFU-9 secrets
- Verification evidence (working tree scan, git history scan)
- Best practices for secret storage
- Re-onboarding procedures after rotation
- Incident response procedures

**Use when:**
- Performing secret rotation
- Verifying no secrets are exposed
- Onboarding new team members
- Responding to a secret exposure incident

### [HISTORY_REWRITE.md](./HISTORY_REWRITE.md)
**Purpose:** Git history sanitization procedures

**Contents:**
- When history rewrite is needed
- Methods: git-filter-repo, BFG, git filter-branch
- Complete sanitization workflow
- Re-clone process for team members
- Common issues and solutions
- Prevention strategies

**Use when:**
- Secrets are found in git history
- Need to sanitize repository history
- Coordinating team-wide re-clone
- Investigating history rewrite options

### [SECRET_SCANNING_SETUP.md](./SECRET_SCANNING_SETUP.md)
**Purpose:** GitHub secret scanning configuration

**Contents:**
- GitHub secret scanning and push protection setup
- Custom pattern configuration
- Operational procedures for alerts
- Integration with CI/CD
- Metrics and reporting
- Best practices and troubleshooting

**Use when:**
- Setting up GitHub secret scanning
- Configuring push protection
- Responding to secret scanning alerts
- Adding custom secret patterns
- Training team on secret management

## Quick Reference

### Emergency: Secret Exposed

If a secret is accidentally committed:

1. **Revoke immediately** (< 1 hour)
   - GitHub PAT: Settings → Developer Settings → Revoke
   - AWS Key: IAM Console → Disable key
   - OpenAI: OpenAI Dashboard → Revoke key

2. **Remove from repository**
   ```bash
   git rm -f <secret-file>
   git commit -m "security: remove exposed secret"
   git push
   ```

3. **Check git history**
   ```bash
   git log --all --name-only -- <secret-file>
   ```
   
   If in history, follow [HISTORY_REWRITE.md](./HISTORY_REWRITE.md)

4. **Generate new secret**
   - Create replacement with minimal scopes
   - Update AWS Secrets Manager
   - Verify integrations work

5. **Document in [SECURITY_ROTATION.md](./SECURITY_ROTATION.md)**

### Verification Checklist

Use this checklist to verify repository security:

- [ ] No secrets in working tree
  ```bash
  find . -name ".env.local" -o -name "*.pem" | grep -v node_modules
  ```

- [ ] No secrets in git history
  ```bash
  git log --all --name-only --pretty=format: -- "*.pem" | sort -u
  ```

- [ ] .gitignore includes secret patterns
  ```bash
  grep -E "^\.env|\.pem|private-key" .gitignore
  ```

- [ ] CI gates are enforced
  ```bash
  # Check .github/workflows/security-gates.yml exists
  ls -la .github/workflows/security-gates.yml
  ```

- [ ] GitHub secret scanning enabled
  - Navigate to: Settings → Security → Code security and analysis
  - Verify: "Secret scanning" is enabled
  - Verify: "Push protection" is enabled

- [ ] Repo verification passes
  ```bash
  npm run repo:verify
  ```

### CI/CD Integration

The security hardening includes these CI gates:

1. **repo-verify.yml** - Repository structure verification
   - Route-map check
   - Forbidden paths check
   - Empty folders check
   - Mixed-scope check
   - **NEW:** Secret file patterns check

2. **security-gates.yml** - Secret scanning and security validation
   - Gitleaks secret scanning
   - Forbidden file detection
   - Secret pattern matching
   - Blocks PRs with detected secrets

3. **security-validation.yml** - IAM policy validation
   - Least privilege verification
   - Resource scope validation
   - Wildcard usage checks

## Related Documentation

### Security

- [../SECURITY-IAM.md](../SECURITY-IAM.md) - IAM security practices
- [../IAM-ROLES-JUSTIFICATION.md](../IAM-ROLES-JUSTIFICATION.md) - IAM role justifications
- [.gitignore](../../.gitignore) - Ignored file patterns

### Repository

- [../lawbook/repo-canon.md](../lawbook/repo-canon.md) - Repository structure rules
- [../CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [../../README.md](../../README.md) - Project overview

### Workflows

- [../../.github/workflows/repo-verify.yml](../../.github/workflows/repo-verify.yml) - Repo verification
- [../../.github/workflows/security-gates.yml](../../.github/workflows/security-gates.yml) - Security gates
- [../../.github/workflows/security-validation.yml](../../.github/workflows/security-validation.yml) - IAM validation

## Implementation Status

| Component | Status | Verification |
|-----------|--------|--------------|
| Documentation | ✅ Complete | This directory |
| .gitignore patterns | ✅ Complete | Includes all secret patterns |
| repo-verify.ts enhancement | ✅ Complete | Secret file detection |
| CI security gates | ✅ Complete | security-gates.yml |
| GitHub secret scanning | 📋 Manual | Requires GitHub UI configuration |
| Team notification | 📋 Manual | Communication needed |

## Rollout Plan

### Phase 1: Documentation & Local Verification (Complete)
- ✅ Create documentation (this directory)
- ✅ Update .gitignore with secret patterns
- ✅ Enhance repo-verify.ts with secret detection
- ✅ Test local verification

### Phase 2: CI Enforcement (In Progress)
- ✅ Create security-gates.yml workflow
- ✅ Test negative cases (forbidden files blocked)
- 📋 Verify CI gates on PR

### Phase 3: GitHub Configuration (Manual)
- 📋 Enable GitHub secret scanning (Repository Settings)
- 📋 Enable push protection (Repository Settings)
- 📋 Add custom secret patterns (Optional)
- 📋 Configure alert notifications

### Phase 4: Team Rollout (Manual)
- 📋 Notify team of new security gates
- 📋 Share documentation
- 📋 Conduct security training
- 📋 Monitor for false positives

## Maintenance

### Regular Reviews

- **Weekly:** Review secret scanning alerts
- **Monthly:** Audit resolved alerts and verify rotation evidence
- **Quarterly:** Update custom patterns, review metrics, conduct training

### Updates Required When

- **New secret type:** Add pattern to .gitleaks.toml and GitHub custom patterns
- **New integration:** Update SECURITY_ROTATION.md with rotation procedures
- **Security incident:** Document in SECURITY_ROTATION.md audit log

### Version History

| Version | Date       | Changes |
|---------|------------|---------|
| 1.0     | 2025-12-30 | Initial security hardening documentation |

## Contact

For questions about security hardening:

- **Documentation issues:** Open GitHub issue with `documentation` label
- **Security concerns:** #security-alerts channel
- **Emergency:** security@your-org.com

---

**Maintained by:** AFU-9 Security Team  
**Last Updated:** 2025-12-30  
**Related Epic:** E66 (I661)
