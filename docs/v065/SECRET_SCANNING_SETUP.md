# GitHub Secret Scanning Setup — v0.6.5

**Release:** v0.6.5  
**Date:** 2025-12-30  
**Epic:** E66 (I661)  
**Type:** Security Hardening / GitHub Configuration

## Overview

GitHub Secret Scanning and Push Protection are critical security features that prevent secrets from being committed to the repository. This document provides setup instructions and operational guidance.

## Features

### 1. Secret Scanning

**What it does:**
- Scans repository for known secret patterns
- Detects GitHub tokens, AWS keys, API keys, etc.
- Creates alerts for detected secrets
- Runs on every push to the repository

**Supported Secret Types:**
- GitHub Personal Access Tokens (PATs)
- GitHub App tokens
- AWS Access Keys (AKIA*, ASIA*)
- OpenAI API keys
- Azure secrets
- Google Cloud keys
- Private SSH keys
- Database connection strings
- And 200+ other secret types

### 2. Push Protection

**What it does:**
- Blocks pushes that contain detected secrets
- Prevents secrets from entering git history
- Provides immediate feedback to developers
- Reduces incident response burden

**Developer Experience:**
```bash
# Example blocked push
$ git push origin my-branch
remote: —— GitHub Secret Scanning ——————————————————
remote: 
remote: ❌ Secret scanning detected the following secrets:
remote: 
remote:   commit: abc123def456 "Add GitHub integration"
remote:   
remote:   GitHub Personal Access Token
remote:   Locations:
remote:     - control-center/.env.local:5
remote: 
remote: ❌ Push blocked by secret scanning.
remote: 
remote: To push anyway, use '--no-verify' (not recommended)
remote: Or remove the secret and force push: git push --force
remote: 
To github.com:adaefler-art/codefactory-control.git
 ! [remote rejected] my-branch -> my-branch (push declined due to secret scanning)
```

## Setup Instructions

### Step 1: Enable Secret Scanning

1. Navigate to repository settings:
   ```
   https://github.com/adaefler-art/codefactory-control/settings/security_analysis
   ```

2. Under "Code security and analysis":
   - Click **Enable** next to "Secret scanning"
   - GitHub will immediately scan the repository

3. Review initial scan results:
   - Navigate to Security → Secret scanning
   - Review and remediate any detected secrets

### Step 2: Enable Push Protection

1. In the same settings page:
   ```
   https://github.com/adaefler-art/codefactory-control/settings/security_analysis
   ```

2. Under "Secret scanning":
   - Click **Enable** next to "Push protection"
   - This blocks pushes containing secrets

3. Configure bypass options:
   - Allow contributors to bypass (if needed for false positives)
   - Require bypass reason (recommended for audit trail)

### Step 3: Configure Custom Patterns (Optional)

GitHub's built-in patterns cover common secrets, but you can add custom patterns for AFU-9 specific secrets.

1. Navigate to:
   ```
   https://github.com/adaefler-art/codefactory-control/settings/security_analysis/custom_patterns
   ```

2. Click **New pattern**

3. Add custom patterns:

#### AFU-9 GitHub App Private Key Pattern

```regex
# Pattern name: AFU-9 GitHub App Private Key
# Description: Detects AFU-9 GitHub App private keys in various formats

# Use a regex that matches PEM blocks. The `[ ]` keeps this documentation free of literal
# PEM markers (avoids triggering secret scanners), but still matches the same content.

-----BEGIN (RSA )?PRIVATE[ ]KEY-----[\s\S]{1,4000}-----END (RSA )?PRIVATE[ ]KEY-----
```

#### AFU-9 Secret File Names Pattern

```regex
# Pattern name: AFU-9 Secret Files
# Description: Detects secret file references

(github-app-private-key|secret-final|secret-updated|github-app-secret)\.(pem|json|pkcs8\.pem)
```

#### Environment Variable Secret Pattern

```regex
# Pattern name: AFU-9 Environment Secrets
# Description: Detects hardcoded secrets in environment variable assignments

(GITHUB_TOKEN|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_PRIVATE_KEY)\s*=\s*["']([^"']{20,})["']
```

### Step 4: Verify Configuration

1. Test secret scanning:
   ```bash
   # Create a test branch
   git checkout -b test/secret-scanning
   
   # Add a fake secret (will be blocked)
   echo "GITHUB_TOKEN=ghp_test123456789test123456789" > test-secret.txt
   git add test-secret.txt
   git commit -m "test: verify secret scanning"
   git push origin test/secret-scanning
   
   # Expected: Push should be BLOCKED by GitHub
   ```

2. Verify block message appears

3. Clean up test:
   ```bash
   git reset HEAD~1
   git checkout main
   git branch -D test/secret-scanning
   ```

## Operational Procedures

### Responding to Secret Scanning Alerts

When GitHub detects a secret:

1. **Assess the alert:**
   - Navigate to Security → Secret scanning
   - Review the detected secret and location
   - Determine if it's a true positive or false positive

2. **True Positive - Real Secret:**
   ```bash
   # Immediate actions:
   # 1. REVOKE the secret immediately
   #    - GitHub PAT: Settings → Developer Settings → Revoke
   #    - AWS: Disable access key
   #    - OpenAI: Revoke key in dashboard
   
   # 2. Remove from repository
   git rm <file-with-secret>
   git commit -m "security: remove exposed secret"
   git push
   
   # 3. Remove from git history (if pushed)
   # See HISTORY_REWRITE.md for procedures
   
   # 4. Generate new secret and update AWS Secrets Manager
   
   # 5. Mark alert as resolved in GitHub
   ```

3. **False Positive - Not a Real Secret:**
   ```bash
   # Examples of false positives:
   # - Test fixtures with fake tokens
   # - Documentation examples
   # - Pattern matches that aren't secrets
   
   # Action: Mark as false positive in GitHub UI
   # This helps train GitHub's detection
   ```

### Bypassing Push Protection (Emergency)

⚠️ **Only use when absolutely necessary**

If you need to bypass push protection (e.g., for a documented false positive):

```bash
# Push with bypass flag
git push --no-verify origin my-branch

# GitHub will require a bypass reason
# Provide clear justification: "Test fixture with fake token per docs/test-data.md"
```

**Best practice:** Instead of bypassing, remove the secret and use environment variables or test fixtures.

### Monitoring Secret Scanning Alerts

1. **Dashboard:**
   ```
   https://github.com/adaefler-art/codefactory-control/security/secret-scanning
   ```

2. **Alert Notifications:**
   - Configure in repository Settings → Notifications
   - Notify security team on new detections
   - Set up Slack/email alerts

3. **Regular Reviews:**
   - Weekly review of open alerts
   - Monthly audit of resolved alerts
   - Quarterly review of custom patterns

## Integration with CI/CD

### GitHub Actions Integration

Secret scanning results are available in GitHub Actions:

```yaml
# .github/workflows/security-gates.yml
jobs:
  check-secrets:
    name: Check for Secrets
    runs-on: ubuntu-latest
    permissions:
      security-events: read
    
    steps:
      - uses: actions/checkout@v4
      
      # GitHub's secret scanning is automatic
      # Push protection blocks secrets before they reach CI
      
      - name: Additional Secret Scanning with Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Local Development Integration

Use gitleaks locally before pushing:

```bash
# Install gitleaks
brew install gitleaks  # macOS
# or
docker pull zricethezav/gitleaks  # Docker

# Scan repository
gitleaks detect --source . --verbose

# Scan uncommitted changes
gitleaks protect --staged --verbose
```

## Custom Patterns Configuration

Create `.gitleaks.toml` for local scanning:

```toml
title = "AFU-9 Gitleaks Configuration"

[[rules]]
id = "github-pat"
description = "GitHub Personal Access Token"
regex = '''ghp_[0-9a-zA-Z]{36}'''
tags = ["key", "GitHub"]

[[rules]]
id = "github-app-private-key"
description = "GitHub App Private Key"
regex = '''-----BEGIN (RSA )?PRIVATE[ ]KEY-----[\s\S]{1,4000}-----END (RSA )?PRIVATE[ ]KEY-----'''
tags = ["key", "GitHub"]

[[rules]]
id = "openai-api-key"
description = "OpenAI API Key"
regex = '''sk-proj-[a-zA-Z0-9]{20,}'''
tags = ["key", "OpenAI"]

[[rules]]
id = "aws-access-key"
description = "AWS Access Key ID"
regex = '''AKIA[0-9A-Z]{16}'''
tags = ["key", "AWS"]

[[rules]]
id = "env-local-file"
description = ".env.local file"
path = '''\.env\.local'''
tags = ["file", "env"]

[[rules]]
id = "pem-file"
description = "PEM file"
path = '''.*\.pem$'''
tags = ["file", "key"]

[allowlist]
description = "Global allowlist"
paths = [
  '''^\.git/''',
  '''^node_modules/''',
  '''^\.next/''',
  '''test/fixtures/.*''',  # Test fixtures are allowed
  '''docs/examples/.*'''   # Documentation examples are allowed
]
```

## Metrics and Reporting

### Key Metrics

Track these metrics for security posture:

1. **Secret Scanning Coverage:**
   - % of repositories with secret scanning enabled: 100%
   - % of repositories with push protection enabled: 100%

2. **Alert Response Time:**
   - Time to detect secret: < 1 minute (automatic)
   - Time to revoke secret: < 1 hour (target)
   - Time to remediate in code: < 24 hours (target)

3. **Alert Trends:**
   - Number of secrets detected per month
   - Number of successful blocks by push protection
   - Number of bypass requests

### Reporting Dashboard

Generate monthly security report:

```bash
# Get secret scanning alerts via GitHub API
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/adaefler-art/codefactory-control/secret-scanning/alerts

# Filter by state (open/resolved)
# Filter by date range
# Aggregate metrics
```

## Compliance and Audit

### Audit Trail

All secret scanning events are logged:

1. **Secret Detection:** Logged with commit SHA, file path, secret type
2. **Bypass Attempts:** Logged with user, reason, timestamp
3. **Alert Resolution:** Logged with resolver, action taken, timestamp

### Compliance Alignment

Secret scanning supports:

- **SOC 2 Type II:** Continuous monitoring of sensitive data
- **ISO 27001:** Access control and information security
- **GDPR:** Data protection and breach notification
- **PCI DSS:** Protection of cardholder data

### Regular Audits

Schedule quarterly audits:

- [ ] Review all secret scanning alerts (open and resolved)
- [ ] Verify push protection is enabled and enforced
- [ ] Test bypass workflows
- [ ] Update custom patterns based on new secret types
- [ ] Train team on secret scanning best practices

## Best Practices

### For Developers

1. **Never commit secrets:**
   - Use environment variables
   - Use AWS Secrets Manager
   - Use `.env.local` for local development

2. **Use test fixtures:**
   ```javascript
   // Good: Use fake data in tests
   const testToken = "test_fake_token_123";
   
   // Bad: Use real tokens in tests
   const testToken = process.env.GITHUB_TOKEN; // ❌
   ```

3. **Review before pushing:**
   ```bash
   # Check what you're committing
   git diff --staged
   
   # Run local secret scan
   gitleaks protect --staged
   ```

4. **Use .gitignore:**
   - Ensure secret files are ignored
   - Never use `git add -f` to force add ignored files

### For Repository Admins

1. **Enable all security features:**
   - Secret scanning: ✅
   - Push protection: ✅
   - Dependabot alerts: ✅
   - Code scanning: ✅

2. **Configure notifications:**
   - Immediate alerts for secret detection
   - Weekly security summary
   - Monthly compliance report

3. **Regular training:**
   - Onboard new developers on secret management
   - Quarterly security awareness training
   - Incident response drills

## Troubleshooting

### Issue: Push blocked but no secret visible

**Cause:** Secret might be in previous commits in the push

**Solution:**
```bash
# Review all commits in the push
git log origin/main..HEAD --all -S "pattern"

# Remove secret from history
git rebase -i origin/main
# Mark commit with secret for editing
# Remove secret, continue rebase
```

### Issue: False positive blocking legitimate code

**Cause:** Pattern matches non-secret code

**Solution:**
1. Verify it's truly not a secret
2. Bypass with justification: "Test fixture per docs/testing.md"
3. Add to allowlist in custom pattern configuration
4. Consider refactoring code to avoid pattern match

### Issue: Secret detected in old commit

**Cause:** Secret was committed before push protection enabled

**Solution:**
1. Revoke the secret immediately
2. Remove from history (see HISTORY_REWRITE.md)
3. Mark alert as resolved in GitHub

## Resources

- [GitHub Secret Scanning Documentation](https://docs.github.com/en/code-security/secret-scanning)
- [GitHub Push Protection](https://docs.github.com/en/code-security/secret-scanning/push-protection-for-repositories-and-organizations)
- [Gitleaks Documentation](https://github.com/gitleaks/gitleaks)
- [SECURITY_ROTATION.md](./SECURITY_ROTATION.md) - Secret rotation procedures
- [HISTORY_REWRITE.md](./HISTORY_REWRITE.md) - Git history sanitization

## Support

For questions or issues:

1. Check this documentation
2. Review GitHub's secret scanning docs
3. Contact security team: #security-alerts
4. Emergency: security@your-org.com

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-30  
**Maintained by:** AFU-9 Security Team
