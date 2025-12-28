# GitHub App installationId Resolution Fix - Implementation Summary

## Issue
AFU-9 was using a hardcoded/cached installationId from configuration, violating governance and idempotency rules.

## Solution
Implemented deterministic, repository-based installationId resolution using the GitHub API.

## Changes Made

### 1. Core Authentication Layer (`control-center/src/lib/github-app-auth.ts`)

#### Removed installationId from Configuration
- **GitHubAppSecret type**: Removed `installationId` field
- **GitHubAppConfig type**: Removed `installationId` field  
- **loadGitHubAppConfig()**: No longer loads/caches installationId from AWS Secrets Manager or environment variables
- **Environment variable**: Removed `GITHUB_APP_INSTALLATION_ID` requirement

#### Implemented Dynamic Lookup
- **New function: `getInstallationIdForRepo()`**
  - Uses `GET /repos/{owner}/{repo}/installation` API endpoint
  - Returns the installation ID for a specific repository
  - Includes comprehensive error handling
  - Logs lookup operations: `owner/repo → installationId`

#### Updated Token Generation
- **Modified: `getGitHubInstallationToken()`**
  - Now requires `owner` and `repo` parameters (no longer optional)
  - Calls `getInstallationIdForRepo()` for each request
  - **Deliberately does NOT cache** to enforce governance rules
  - Includes comment explaining why caching is avoided

#### Updated API Functions
- **Modified: `postGitHubIssueComment()`**
  - Passes `owner` and `repo` to `getGitHubInstallationToken()`

### 2. File Import Layer (`control-center/src/lib/github/fetch-file.ts`)

- **Modified: `fetchGitHubFile()`**
  - Passes `owner` and `repo` from options to `getGitHubInstallationToken()`
  - Updated comment to reflect repo-specific authentication

### 3. Documentation (`docs/GITHUB_APP_INTEGRATION.md`)

- Removed `installationId` from secret JSON schema example
- Added new section: "Installation ID Resolution"
  - Explains the dynamic lookup mechanism
  - Documents governance compliance
  - Lists benefits: no hidden state, deterministic auth, works with reinstallation
- Updated troubleshooting section
- Removed `GITHUB_APP_INSTALLATION_ID` from environment variable list

### 4. Tests

#### Updated Existing Test (`control-center/__tests__/github-app/jwt.test.ts`)
- Removed `GITHUB_APP_INSTALLATION_ID` from environment setup
- Test still passes, verifying JWT creation works without installationId

#### Added Integration Test (`test/test-installation-id-resolution.ts`)
- Verifies module exports new functions
- Checks type definitions don't contain installationId
- Validates `getInstallationIdForRepo()` implementation
- Confirms `getGitHubInstallationToken()` uses repo lookup
- Verifies logging is present
- Checks `fetchGitHubFile()` integration
- Validates documentation updates
- **All 7 test cases pass**

## Governance Compliance

✅ **No hidden state**: Installation ID is never cached or stored
✅ **Deterministic auth**: Each repository lookup is explicit and traceable
✅ **GREEN Verdict only with repo installation**: Failed lookups throw clear errors
✅ **Works on reinstallation**: No configuration changes needed when app is reinstalled

## Logging

All installation ID lookups are logged with the format:
```
[getInstallationIdForRepo] Looking up installation for {owner}/{repo}
[getInstallationIdForRepo] Found installationId {id} for {owner}/{repo}
```

## Error Handling

Clear error messages for all failure cases:
- `Failed to get installation for {owner}/{repo} (404)`: App not installed on repository
- `Invalid installation response`: Missing or invalid installation ID in response
- `Failed to create installation token`: Token generation failed

## Security

- **CodeQL scan**: 0 alerts
- **No secrets in code**: All secrets loaded from AWS Secrets Manager or environment variables
- **Proper input validation**: Owner/repo parameters are URL-encoded
- **No caching**: Prevents stale installation IDs from being used

## Testing Results

✅ Integration test: All 7 checks pass
✅ GitHub App tests: 2/2 pass
✅ TypeScript compilation: Success
✅ CodeQL security scan: 0 alerts
✅ Code review: All feedback addressed

## Migration Notes

### For AWS Secrets Manager Secret
**Before:**
```json
{
  "appId": "123456",
  "installationId": "12345678",
  "webhookSecret": "...",
  "privateKeyPem": "..."
}
```

**After:**
```json
{
  "appId": "123456",
  "webhookSecret": "...",
  "privateKeyPem": "..."
}
```

### For Environment Variables
**Remove:** `GITHUB_APP_INSTALLATION_ID`

**Keep:**
- `GITHUB_APP_ID`
- `GITHUB_APP_WEBHOOK_SECRET`
- `GITHUB_APP_PRIVATE_KEY_PEM`

## Performance Considerations

The installation ID lookup adds one additional GitHub API call per token request. This is acceptable because:
1. Token requests are infrequent (tokens last ~1 hour)
2. Governance requirement: no caching allowed
3. Lookup is fast (~100-200ms)
4. Ensures always-current installation state

## DoD Verification

✅ Import `docs/roadmaps/afu9_v0_6_backlog.md` will work (fetchGitHubFile uses repo-based lookup)
✅ No "Invalid installationId" errors (ID is always looked up fresh)
✅ Works on repo reinstallation (no cached/hardcoded ID)
✅ Governance: No hidden state ✓ Deterministic auth ✓ GREEN Verdict only on repo lookup ✓

## Files Changed

1. `control-center/src/lib/github-app-auth.ts` - Core authentication logic
2. `control-center/src/lib/github/fetch-file.ts` - File import integration
3. `control-center/__tests__/github-app/jwt.test.ts` - Updated test
4. `docs/GITHUB_APP_INTEGRATION.md` - Documentation
5. `test/test-installation-id-resolution.ts` - New integration test (added)

## Conclusion

The implementation successfully removes all hardcoded/cached installationId usage and replaces it with deterministic, repository-based lookup. This ensures AFU-9 adheres to governance and idempotency rules while maintaining clear error handling and comprehensive logging.
