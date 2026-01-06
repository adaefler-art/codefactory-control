# E71.1: Repo Access Policy Configuration Guide

## Overview

The Repo Access Policy enforces allowlist-based access control for GitHub API operations in AFU-9. All GitHub operations must pass through the policy layer, which validates repository, branch, and path access before obtaining installation tokens.

## Key Features

- **Deny-by-default**: Only explicitly allowed repositories can be accessed
- **Branch pattern matching**: Support for exact branch names and glob patterns (e.g., `release/*`)
- **Path restrictions**: Optional path-level access control
- **Deterministic**: Same input always produces same result
- **Idempotent**: Safe to call repeatedly
- **Server-side only**: Tokens never exposed to client code

## Configuration

### Environment Variable

Set the `GITHUB_REPO_ALLOWLIST` environment variable with a JSON configuration:

```bash
export GITHUB_REPO_ALLOWLIST='
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "develop", "release/*", "hotfix/*"]
    },
    {
      "owner": "adaefler-art",
      "repo": "rhythmologicum-connect",
      "branches": ["main", "staging"],
      "paths": ["src/*", "docs/*"]
    }
  ]
}
'
```

### Configuration Schema

```typescript
{
  allowlist: [
    {
      owner: string;        // GitHub organization or user name
      repo: string;         // Repository name
      branches: string[];   // Allowed branch patterns (required, min 1)
      paths?: string[];     // Optional path restrictions
    }
  ]
}
```

### Branch Patterns

- **Exact match**: `"main"`, `"develop"`, `"staging"`
- **Glob patterns**: `"release/*"`, `"hotfix/*"`, `"feature/*"`, `"v*"`
- **Wildcard**: `"*"` matches any branch (use with caution)

### Path Patterns

Path restrictions are optional. If specified, only matching paths can be accessed.

- **Exact match**: `"src/app.ts"`, `"README.md"`
- **Glob patterns**: `"src/*"`, `"docs/*"`, `"*.ts"`
- **No restrictions**: Omit `paths` field to allow all paths

## Default Configuration (Development)

If `GITHUB_REPO_ALLOWLIST` is not set, the system uses a development default:

```json
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "develop", "release/*", "hotfix/*", "feature/*", "copilot/*"]
    }
  ]
}
```

**⚠️ Warning**: This default is permissive and should be replaced in production environments.

## Usage Examples

### Using the Auth Wrapper (Server-Side)

```typescript
import { 
  createAuthenticatedClient,
  getAuthenticatedToken,
  isRepoAllowed 
} from '@/lib/github/auth-wrapper';

// Check if repo is allowed (preflight)
if (!isRepoAllowed('adaefler-art', 'codefactory-control')) {
  console.error('Repository not allowed');
  return;
}

// Get authenticated token
const { token, expiresAt } = await getAuthenticatedToken({
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  branch: 'main',
});

// Or create authenticated client
const octokit = await createAuthenticatedClient({
  owner: 'adaefler-art',
  repo: 'codefactory-control',
  branch: 'main',
});

const { data: repo } = await octokit.rest.repos.get({
  owner: 'adaefler-art',
  repo: 'codefactory-control',
});
```

### Error Handling

```typescript
import { RepoAccessDeniedError } from '@/lib/github/auth-wrapper';

try {
  const client = await createAuthenticatedClient({
    owner: 'unauthorized',
    repo: 'repo',
    branch: 'main',
  });
} catch (error) {
  if (error instanceof RepoAccessDeniedError) {
    console.error('Access denied:', error.code); // "REPO_NOT_ALLOWED"
    console.error('Details:', error.details); // { owner, repo, branch, path }
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `REPO_NOT_ALLOWED` | Repository, branch, or path not in allowlist |
| `POLICY_CONFIG_ERROR` | Invalid `GITHUB_REPO_ALLOWLIST` configuration |
| `AUTH_MISCONFIGURED` | GitHub App credentials missing or invalid |

## Security Considerations

### Token Security

- ✅ **Server-side only**: All auth operations run server-side
- ✅ **No client exposure**: Tokens never sent to browser/client
- ✅ **Policy enforcement**: Validated before token acquisition
- ✅ **Deterministic**: No random behavior, reproducible results

### Best Practices

1. **Principle of least privilege**: Only allow repositories that need access
2. **Branch restrictions**: Limit branches to production/staging/release patterns
3. **Path restrictions**: Use when only specific files/dirs should be accessible
4. **Regular audits**: Review allowlist periodically
5. **Production override**: Always set `GITHUB_REPO_ALLOWLIST` explicitly in production

## Testing

Run the policy tests:

```powershell
# Run policy matcher tests
npm --prefix control-center test -- __tests__/lib/github-policy.test.ts

# Run auth wrapper tests
npm --prefix control-center test -- __tests__/lib/github-auth-wrapper.test.ts

# Run all tests
npm --prefix control-center test
```

## PowerShell Verification Commands

```powershell
# Install dependencies
npm --prefix control-center install

# Build packages
npm --prefix packages/deploy-memory run build
npm --prefix packages/verdict-engine run build

# Run tests
npm --prefix control-center test

# Build control-center
npm --prefix control-center run build

# Verify configuration (development)
# Ensure GITHUB_REPO_ALLOWLIST is set or uses default
$env:GITHUB_REPO_ALLOWLIST = @"
{
  "allowlist": [
    {
      "owner": "adaefler-art",
      "repo": "codefactory-control",
      "branches": ["main", "develop", "release/*"]
    }
  ]
}
"@
```

## Integration with Existing Code

The auth wrapper is designed as a drop-in replacement for direct `getGitHubInstallationToken` calls:

### Before (Direct Auth)
```typescript
import { getGitHubInstallationToken } from './github-app-auth';

const { token } = await getGitHubInstallationToken({ owner, repo });
const octokit = new Octokit({ auth: token });
```

### After (Policy-Enforced Auth)
```typescript
import { createAuthenticatedClient } from './github/auth-wrapper';

const octokit = await createAuthenticatedClient({ owner, repo, branch });
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Request                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Server-Side Route Handler                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         createAuthenticatedClient()                         │
│         (auth-wrapper.ts)                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         1. Policy Check (policy.ts)                         │
│            - Validate owner/repo/branch                     │
│            - Match against allowlist                        │
│            - Throw RepoAccessDeniedError if denied          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         2. Get Installation Token                           │
│            - Create GitHub App JWT                          │
│            - Lookup installation ID                         │
│            - Request installation access token              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         3. Return Authenticated Client                      │
│            - Octokit instance with token                    │
│            - Ready for GitHub API calls                     │
└─────────────────────────────────────────────────────────────┘
```

## Reference

- **Issue**: I711 (E71.1) - Repo Access Policy + Auth Wrapper
- **Files**:
  - `control-center/src/lib/github/policy.ts` - Policy matcher and config
  - `control-center/src/lib/github/auth-wrapper.ts` - Auth wrapper
  - `control-center/src/lib/github/config.ts` - Zod schemas
  - `control-center/__tests__/lib/github-policy.test.ts` - Policy tests
  - `control-center/__tests__/lib/github-auth-wrapper.test.ts` - Auth wrapper tests
- **Tests**: 37 new tests, all passing
- **Build**: ✅ Green
