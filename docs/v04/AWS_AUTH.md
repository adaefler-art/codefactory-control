# AWS Cognito Authentication for AFU-9 Control Center

This guide explains how to configure and use AWS Cognito authentication for the AFU-9 Control Center.

## Overview

The Control Center uses AWS Cognito User Pool for authentication with the following features:
- Username/password authentication (USER_PASSWORD_AUTH flow)
- JWT-based session management with HttpOnly cookies
- Environment-based access control via Cognito groups
- Automatic token verification and validation

## Environment Variables

Configure the following environment variables in `.env.local` (based on `.env.local.template`):

```bash
# Cognito Configuration
COGNITO_REGION=eu-central-1
COGNITO_USER_POOL_ID=eu-central-1_XXXXXXXXX
COGNITO_CLIENT_ID=your_client_id_here
COGNITO_ISSUER_URL=https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_XXXXXXXXX
```

### Getting Configuration Values

After deploying the `Afu9AuthStack`, retrieve the values from CloudFormation outputs:

```bash
# Deploy the auth stack
npx cdk deploy Afu9AuthStack

# View outputs
aws cloudformation describe-stacks \
  --stack-name Afu9AuthStack \
  --region eu-central-1 \
  --query 'Stacks[0].Outputs'
```

The outputs will include:
- `UserPoolId` - Use for `COGNITO_USER_POOL_ID`
- `UserPoolClientId` - Use for `COGNITO_CLIENT_ID`
- `IssuerUrl` - Use for `COGNITO_ISSUER_URL`
- `Region` - Use for `COGNITO_REGION`

## Deploying Cognito Stack

Deploy the authentication stack using AWS CDK:

```bash
# Navigate to the repository root
cd /path/to/codefactory-control

# Deploy the auth stack
npx cdk deploy Afu9AuthStack --region eu-central-1

# Optional: Create a Cognito domain for hosted UI
npx cdk deploy Afu9AuthStack \
  -c afu9-cognito-domain-prefix=afu9-control-center
```

## Creating Users and Assigning Groups

### Console Steps

1. **Create a User:**
   - Open AWS Console → Cognito → User Pools
   - Select `afu9-control-center` user pool
   - Go to "Users" tab → "Create user"
   - Enter username (e.g., `engineer1`)
   - Set temporary password or send invitation
   - Mark user as confirmed (skip email verification)

2. **Create Groups:**
   - In the same user pool, go to "Groups" tab
   - Create the following groups:
     - `afu9-admin-prod` - Full access to production environment
     - `afu9-engineer-stage` - Full access to stage environment
     - `afu9-readonly-stage` - Read-only access to stage environment

3. **Assign User to Group:**
   - Go to "Users" tab → Select user
   - Click "Add user to group"
   - Select appropriate group(s)
   - Save changes

### CLI Commands

```bash
# Create a user
aws cognito-idp admin-create-user \
  --user-pool-id eu-central-1_XXXXXXXXX \
  --username engineer1 \
  --temporary-password TempPass123! \
  --region eu-central-1

# Confirm user (skip email verification)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id eu-central-1_XXXXXXXXX \
  --username engineer1 \
  --region eu-central-1

# Create groups
aws cognito-idp create-group \
  --user-pool-id eu-central-1_XXXXXXXXX \
  --group-name afu9-engineer-stage \
  --description "Engineers with stage environment access" \
  --region eu-central-1

# Add user to group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id eu-central-1_XXXXXXXXX \
  --username engineer1 \
  --group-name afu9-engineer-stage \
  --region eu-central-1

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id eu-central-1_XXXXXXXXX \
  --username engineer1 \
  --password SecurePass123! \
  --permanent \
  --region eu-central-1
```

## Login Endpoint Usage

### API Endpoint

**POST** `/api/auth/login`

**Request:**
```json
{
  "username": "engineer1",
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful"
}
```

The response sets three HttpOnly, Secure cookies:
- `afu9_id` - ID token (contains user info and groups) - 1 hour expiry
- `afu9_access` - Access token (for API calls) - 1 hour expiry
- `afu9_refresh` - Refresh token (for token renewal) - 30 days expiry

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

### Testing with cURL (Linux/macOS/PowerShell Core)

```bash
# Login request
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"engineer1","password":"SecurePass123!"}' \
  -c cookies.txt

# Access protected route with cookies
curl http://localhost:3000/api/features \
  -b cookies.txt
```

### Testing with PowerShell

```powershell
# Login request
$body = @{
    username = "engineer1"
    password = "SecurePass123!"
} | ConvertTo-Json

$response = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/auth/login" `
  -Method POST `
  -Body $body `
  -ContentType "application/json" `
  -SessionVariable session

Write-Host "Login successful: $($response.success)"

# Access protected route with session cookies
$features = Invoke-RestMethod `
  -Uri "http://localhost:3000/api/features" `
  -WebSession $session

$features
```

## Environment-Based Access Control

Access to the Control Center is controlled by Cognito groups and request hostname:

### Group to Environment Mapping

| Cognito Group | Environment Access |
|---------------|-------------------|
| `afu9-admin-prod` | Production (`afu-9.com`, `prod.afu-9.com`) |
| `afu9-engineer-stage` | Stage (`stage.afu-9.com`, `localhost`) |
| `afu9-readonly-stage` | Stage (`stage.afu-9.com`, `localhost`) |

### Access Flow

1. User authenticates via `/api/auth/login`
2. JWT tokens are stored in HttpOnly cookies
3. Middleware verifies JWT on each request:
   - Checks signature using JWKS
   - Validates issuer and expiration
   - Extracts `cognito:groups` from ID token
4. Hostname determines required environment:
   - `stage.afu-9.com` → requires stage access
   - `prod.afu-9.com` or `afu-9.com` → requires prod access
5. If user's groups don't match required environment → 403 redirect to landing page

## Token Verification and Troubleshooting

### JWT Token Structure

The ID token contains:
```json
{
  "sub": "user-uuid",
  "cognito:groups": ["afu9-engineer-stage"],
  "email_verified": false,
  "iss": "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_XXXXXXXXX",
  "cognito:username": "engineer1",
  "aud": "client-id",
  "token_use": "id",
  "exp": 1234567890,
  "iat": 1234567800
}
```

### Common Issues

#### 1. "Authentication service not configured"

**Cause:** Missing or invalid environment variables.

**Solution:**
- Verify `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` are set
- Check values match CloudFormation outputs
- Restart Next.js dev server after updating `.env.local`

#### 2. "Invalid username or password"

**Cause:** Incorrect credentials or user not confirmed.

**Solution:**
- Verify username and password are correct
- Check user status in Cognito console
- Confirm user if necessary:
  ```bash
  aws cognito-idp admin-confirm-sign-up \
    --user-pool-id eu-central-1_XXXXXXXXX \
    --username engineer1 \
    --region eu-central-1
  ```

#### 3. "JWT verification failed" or "Token expired"

**Cause:** Invalid token, expired token, or JWKS fetch failure.

**Solution:**
- Log in again to get fresh tokens
- Check JWKS URL is accessible: `https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/jwks.json`
- Verify `COGNITO_ISSUER_URL` matches the issuer in the JWT
- Check server clock is synchronized (JWT exp validation)

#### 4. 403 Forbidden or redirect to landing page

**Cause:** User doesn't have access to the requested environment.

**Solution:**
- Check user's Cognito groups in AWS Console
- Verify group names match the expected format (e.g., `afu9-engineer-stage`)
- Add user to appropriate group
- Log out and log in again to refresh token with new groups

#### 5. JWKS fetch error or invalid token

**Cause:** Network issues, incorrect configuration, or fail-closed security.

**Solution:**
- The middleware fails closed on JWKS errors for security
- Check network connectivity to AWS Cognito
- Verify `COGNITO_REGION` and `COGNITO_USER_POOL_ID` are correct
- Check CloudWatch logs for detailed error messages

### Debugging Tips

1. **Check browser cookies:**
   - Open DevTools → Application → Cookies
   - Look for `afu9_id`, `afu9_access`, `afu9_refresh`
   - Verify they're HttpOnly and Secure

2. **Decode JWT tokens:**
   ```bash
   # Copy token from cookie and decode (don't verify online for security)
   echo "eyJ..." | base64 -d
   ```

3. **Check server logs:**
   ```bash
   # Look for middleware and login route logs
   npm run dev
   # Check console output for JWT verification errors
   ```

4. **Verify JWKS endpoint:**
   ```bash
   curl https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_XXXXXXXXX/.well-known/jwks.json
   ```

## Security Best Practices

### ⚠️ Never Use AWS Root Credentials

- **Do not** create IAM access keys for the root user
- **Do not** set `AWS_ACCESS_KEY_ID` for root in environment variables
- Use IAM users or roles with least privilege
- Enable MFA on root account

### Cognito Security

- Use strong password policy (configured in stack)
- Rotate user passwords regularly
- Monitor failed login attempts
- Use CloudWatch Logs for audit trail
- Keep refresh tokens secure (HttpOnly cookies)

### Development vs Production

```bash
# Development (localhost)
# - Cookies set with Secure=false for HTTP
# - Accepts stage environment access

# Production
# - Cookies set with Secure=true for HTTPS
# - Hostname-based environment checks
# - Fail closed on errors
```

## Related Documentation

- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [JWT Verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)

## Support

For issues or questions:
1. Check CloudWatch Logs for error details
2. Verify environment variables are correctly set
3. Test authentication flow with curl/PowerShell
4. Review Cognito User Pool configuration in AWS Console

## Local Testing Guide

For detailed local testing instructions with curl and PowerShell examples, see the testing steps below.

### Quick Test Setup

1. Deploy the auth stack and get outputs:
   ```bash
   npx cdk deploy Afu9AuthStack --region eu-central-1
   aws cloudformation describe-stacks --stack-name Afu9AuthStack --region eu-central-1 --query 'Stacks[0].Outputs'
   ```

2. Update `control-center/.env.local` with the CloudFormation outputs

3. Create a test user and group:
   ```bash
   # Create user
   aws cognito-idp admin-create-user \
     --user-pool-id <UserPoolId> \
     --username testuser \
     --temporary-password TestPass123! \
     --region eu-central-1

   # Set permanent password
   aws cognito-idp admin-set-user-password \
     --user-pool-id <UserPoolId> \
     --username testuser \
     --password TestPass123! \
     --permanent \
     --region eu-central-1

   # Create group
   aws cognito-idp create-group \
     --user-pool-id <UserPoolId> \
     --group-name afu9-engineer-stage \
     --region eu-central-1

   # Add user to group
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id <UserPoolId> \
     --username testuser \
     --group-name afu9-engineer-stage \
     --region eu-central-1
   ```

4. Start dev server:
   ```bash
   cd control-center
   npm run dev
   ```

5. Test login (see examples in "Login Endpoint Usage" section above)

### Expected Test Results

- ✓ Login returns `{"success": true, "message": "Login successful"}`
- ✓ Three HttpOnly cookies set: `afu9_id`, `afu9_access`, `afu9_refresh`
- ✓ Protected routes accessible with valid cookies
- ✓ Unauthenticated requests redirect to landing page
- ✓ Invalid/expired tokens redirect to landing page
