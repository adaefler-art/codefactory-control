# AWS Authentication Guide for AFU-9

This guide explains how to properly configure AWS authentication for AFU-9 automation, with emphasis on security best practices.

## Quick Start

### Step 1: Run the Authentication Doctor

Before using any AFU-9 scripts that interact with AWS, run the authentication doctor to diagnose your setup:

```powershell
.\scripts\aws-auth-doctor.ps1
```

This will analyze your current AWS authentication and provide specific guidance for your situation.

### Step 2: Set Up AWS SSO (Recommended)

AWS SSO provides temporary credentials that are more secure than long-term IAM user credentials:

```bash
# Configure SSO profile
aws configure sso

# Follow the prompts:
# - SSO start URL: Your organization's SSO portal URL
# - SSO region: Your SSO region (e.g., us-east-1)
# - SSO account: Select your AWS account
# - SSO role: Select your role
# - CLI profile name: Choose a name (e.g., "codefactory")
# - Default region: Your preferred region
# - Output format: json (recommended)
```

### Step 3: Log In to Your Profile

```bash
aws sso login --profile codefactory
```

This will open a browser for authentication and provide temporary credentials.

### Step 4: Verify Your Identity

Confirm that your identity is an assumed role (not root):

```bash
aws sts get-caller-identity --profile codefactory
```

Expected output (assumed role):
```json
{
    "UserId": "AROA...:user@example.com",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/RoleName/user@example.com"
}
```

❌ **NEVER use root credentials** (Arn ending with `:root`)

### Step 5: Use the Profile with AFU-9 Scripts

```powershell
# Run debug uploader with profile
.\scripts\run-debug.ps1 -Profile codefactory

# Or set environment variable
$env:AWS_PROFILE = "codefactory"
.\scripts\run-debug.ps1
```

## Security: Why Not Root?

### Root Account Risks

The AWS root account has **unrestricted access** to all resources and actions in your AWS account:
- Cannot be restricted by IAM policies
- Can delete or modify any resource
- Can change billing and close the account
- Credential compromise = complete account takeover

### AFU-9 Safety Mechanisms

AFU-9 scripts include automatic safety checks:

1. **`run-debug.ps1`**: Refuses to run if AWS identity is root
2. **`aws-auth-doctor.ps1`**: Alerts you if using root credentials
3. **Clear error messages**: Guides you to fix authentication issues

If you attempt to run with root credentials, you'll see:

```
ERROR: Refusing to run with AWS root credentials!

Running AFU-9 automation with root credentials is a security risk.
Root credentials have unrestricted access and should never be used for automation.

Required action:
  1. Clear any AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY environment variables
  2. Set up AWS SSO:
       aws configure sso
  3. Log in to your SSO profile:
       aws sso login --profile <profile-name>
  4. Rerun this script with the profile:
       .\run-debug.ps1 -Profile <profile-name>
```

## Authentication Methods

### 1. SSO / Assumed Role (✅ Recommended)

**Pros:**
- Temporary credentials (expire automatically)
- No long-term secrets to manage
- Easy credential rotation
- Auditable via CloudTrail

**Setup:**
```bash
aws configure sso
aws sso login --profile codefactory
```

**Identity ARN pattern:**
```
arn:aws:sts::123456789012:assumed-role/RoleName/user@example.com
```

### 2. IAM User (⚠️ Acceptable)

**Pros:**
- Works without SSO setup
- Simple to configure

**Cons:**
- Long-term credentials
- Manual rotation required
- Less auditable

**Setup:**
```bash
aws configure
```

**Identity ARN pattern:**
```
arn:aws:iam::123456789012:user/username
```

### 3. Root Account (❌ Never Use)

**DO NOT USE for automation or daily operations.**

**Identity ARN pattern:**
```
arn:aws:iam::123456789012:root
```

## Troubleshooting

### Issue: "Unable to locate credentials"

**Cause:** No AWS credentials configured.

**Solution:**
```bash
# Option 1: Configure SSO (recommended)
aws configure sso
aws sso login --profile codefactory

# Option 2: Configure IAM user
aws configure
```

### Issue: "Token expired"

**Cause:** SSO session expired (typical lifetime: 12 hours).

**Solution:**
```bash
aws sso login --profile codefactory
```

### Issue: "Access Denied"

**Cause:** Your role/user lacks necessary permissions.

**Solution:**
- Verify your identity: `aws sts get-caller-identity --profile codefactory`
- Check required permissions with your AWS administrator
- See [IAM-QUICK-REFERENCE.md](./IAM-QUICK-REFERENCE.md) for AFU-9 role permissions

### Issue: Root credentials detected

**Cause:** Using AWS root account access keys.

**Solution:**
1. **Clear environment variables:**
   ```powershell
   # PowerShell
   Remove-Item Env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
   Remove-Item Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
   ```
   ```bash
   # Bash
   unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
   ```

2. **Delete root access keys** (if they exist):
   - Log in to AWS Console as root
   - Go to IAM → My Security Credentials
   - Delete all access keys
   - Set up MFA instead

3. **Configure SSO:**
   ```bash
   aws configure sso
   aws sso login --profile codefactory
   ```

## Environment Variables

### Checked by AFU-9 Scripts

| Variable | Purpose | Example |
|----------|---------|---------|
| `AWS_PROFILE` | Active AWS profile | `codefactory` |
| `AWS_ACCESS_KEY_ID` | IAM access key (avoid using) | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key (avoid using) | `***` |
| `AWS_DEFAULT_REGION` | Default AWS region | `us-east-1` |

### Best Practice

**Prefer `AWS_PROFILE` over access key environment variables:**

```powershell
# Good: Use profile
$env:AWS_PROFILE = "codefactory"

# Avoid: Setting access keys directly
# $env:AWS_ACCESS_KEY_ID = "..."  # Don't do this
```

## Commands Reference

### Authentication Doctor

```powershell
# Run full diagnostic
.\scripts\aws-auth-doctor.ps1
```

**Output includes:**
- AWS CLI status
- Environment variables
- Current identity
- Configuration details
- Available profiles
- Authentication classification
- Actionable recommendations

### Debug Script

```powershell
# Run with default credentials
.\scripts\run-debug.ps1

# Run with specific profile
.\scripts\run-debug.ps1 -Profile codefactory

# Run with verbose output
.\scripts\run-debug.ps1 -Profile codefactory -Verbose

# Run with debug mode
.\scripts\run-debug.ps1 -DebugMode
```

### AWS STS Commands

```bash
# Check current identity
aws sts get-caller-identity

# Check with specific profile
aws sts get-caller-identity --profile codefactory

# Get session token (for MFA)
aws sts get-session-token --serial-number arn:aws:iam::123456789012:mfa/username
```

### AWS Configure Commands

```bash
# Interactive configuration
aws configure

# SSO configuration
aws configure sso

# List all profiles
aws configure list-profiles

# View current configuration
aws configure list

# Set specific values
aws configure set region us-east-1 --profile codefactory
```

## Profile Configuration Files

### Location

- **Linux/macOS:** `~/.aws/config` and `~/.aws/credentials`
- **Windows:** `%USERPROFILE%\.aws\config` and `%USERPROFILE%\.aws\credentials`

### Example SSO Profile

`~/.aws/config`:
```ini
[profile codefactory]
sso_start_url = https://my-org.awsapps.com/start
sso_region = us-east-1
sso_account_id = 123456789012
sso_role_name = DeveloperAccess
region = us-east-1
output = json
```

### Example IAM User Profile

`~/.aws/config`:
```ini
[profile myprofile]
region = us-east-1
output = json
```

`~/.aws/credentials`:
```ini
[myprofile]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

## Security Checklist

Before running AFU-9 automation:

- [ ] **NOT using root account** (verify with `aws sts get-caller-identity`)
- [ ] Using SSO or IAM user with appropriate permissions
- [ ] MFA enabled on root account (even if not using it)
- [ ] Root access keys deleted
- [ ] SSO session is active (if using SSO)
- [ ] Profile correctly specified (if not using default)
- [ ] No AWS credentials in source code or committed files

## Related Documentation

- [IAM-QUICK-REFERENCE.md](./IAM-QUICK-REFERENCE.md) - AFU-9 IAM roles and permissions
- [SECURITY-IAM.md](./SECURITY-IAM.md) - Comprehensive IAM security guide
- [AWS SSO Documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
- [AWS Security Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)

## Getting Help

If you encounter issues not covered here:

1. Run the authentication doctor: `.\scripts\aws-auth-doctor.ps1`
2. Check [IAM-QUICK-REFERENCE.md](./IAM-QUICK-REFERENCE.md) for permission details
3. Review CloudTrail logs for authentication events
4. Contact your AWS administrator for account-specific guidance
