# E82.4 & E84: GitHub Rate-Limit & Retry Policy + Post-Publish Workflow Automation

## Overview

This implementation adds two major features:

1. **E82.4**: GitHub API retry policy with deterministic backoff and rate-limit handling
2. **E84**: Semi-automated post-publish workflow automation UI for managing PRs and issues

## Features Implemented

### 1. GitHub Retry Policy (E82.4)

#### Retry Policy Module (`control-center/src/lib/github/retry-policy.ts`)

- **Deterministic exponential backoff** with configurable parameters:
  - `maxRetries`: Maximum number of retry attempts (default: 3, max: 10)
  - `initialDelayMs`: Initial delay before first retry (default: 1000ms)
  - `maxDelayMs`: Maximum delay cap (default: 32000ms)
  - `backoffMultiplier`: Exponential growth factor (default: 2)
  - `jitterFactor`: Random jitter to prevent thundering herd (default: 25%)

- **Rate limit detection and handling**:
  - Primary rate limit (HTTP 429)
  - Secondary rate limit (abuse detection)
  - Respects `x-ratelimit-*` headers
  - Calculates appropriate wait times from reset timestamps

- **Error classification**:
  - Rate limit errors → Retry with calculated delay
  - Server errors (5xx) → Retry with exponential backoff
  - Network errors → Retry with exponential backoff
  - Client errors (4xx except 429) → Don't retry
  - Unknown errors → Don't retry (fail-safe)

- **Bounded retries**:
  - Maximum retry attempts enforced
  - Maximum delay enforced to prevent indefinite waits
  - Graceful failure after exhausting retries

#### Integration with GitHub Auth Wrapper

Updated `control-center/src/lib/github/auth-wrapper.ts`:
- `getAuthenticatedToken()` now uses retry logic for token acquisition
- `createAuthenticatedClient()` creates Octokit with throttle plugin
- `postGitHubIssueComment()` wraps comment creation with retry logic

#### Tests

Comprehensive test suite in `control-center/__tests__/lib/github-retry-policy.test.ts`:
- Error classification tests
- Backoff calculation tests
- Rate limit delay calculation
- Retry decision logic
- End-to-end retry scenarios

### 2. Post-Publish Workflow Automation (E84)

#### Database Schema (`database/migrations/057_workflow_action_audit.sql`)

**`workflow_action_audit` table**:
- Tracks all workflow actions (merge, rerun checks, assign, etc.)
- Records action metadata, parameters, and results
- Maintains error details for failed actions
- Supports audit trail with timestamps

**`github_status_cache` table**:
- Caches PR/Issue status from GitHub
- Stores check runs, CI status, review decisions
- Tracks mergeability and draft status
- Includes sync metadata and rate limit info

**Helper views**:
- `recent_workflow_actions`: Last 100 workflow actions
- `mergeable_prs`: PRs ready to merge (green checks, approved, mergeable)

#### GitHub Status Sync API (`control-center/app/api/github/status/sync/route.ts`)

**POST `/api/github/status/sync`**:
- Fetches PR data from GitHub (with retry policy)
- Retrieves check runs, commit status, and reviews
- Calculates aggregated status (checks, CI, reviews)
- Caches results in database
- Returns comprehensive status data

**GET `/api/github/status/sync`**:
- Retrieves cached status from database
- Avoids unnecessary GitHub API calls
- Query params: `owner`, `repo`, `number`, `resource_type`

#### Workflow Runner UI (`control-center/app/workflow-runner/page.tsx`)

Features:
- **Next Items List**: View actionable PRs and issues
- **Status Dashboard**:
  - Real-time PR mergeability check
  - Check runs status (passed/failed/pending)
  - CI status aggregation
  - Review decision display
  - Last sync timestamp
- **Action Buttons**:
  - Merge PR (disabled if checks not green)
  - Rerun Failed Checks
  - Request Review
  - View on GitHub
- **Guardrails**:
  - Merge button only enabled when all checks pass
  - Visual indicators for blockers
  - Warning about permissions and audit
- **Audit Trail**: (placeholder for future integration)
  - Displays action history
  - Shows status and timing

## Usage

### Using Retry Policy

```typescript
import { withRetry, DEFAULT_RETRY_CONFIG } from '@/lib/github/retry-policy';

// Use default retry config
const result = await withRetry(async () => {
  return await somGitHubAPICall();
});

// Custom retry config
const customConfig = {
  maxRetries: 5,
  initialDelayMs: 2000,
  maxDelayMs: 60000,
  backoffMultiplier: 3,
  jitterFactor: 0.1,
};

const result = await withRetry(
  async () => await somGitHubAPICall(),
  customConfig,
  (decision, attempt) => {
    console.log(`Retry ${attempt + 1}: ${decision.reason}`);
  }
);
```

### Using GitHub Status Sync

```bash
# Sync PR status
curl -X POST http://localhost:3000/api/github/status/sync \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "number": 1,
    "resource_type": "pull_request"
  }'

# Get cached status
curl "http://localhost:3000/api/github/status/sync?owner=adaefler-art&repo=codefactory-control&number=1&resource_type=pull_request"
```

### Using Workflow Runner UI

1. Navigate to `/workflow-runner`
2. Select a PR from the list
3. Click "Refresh" to sync status from GitHub
4. Review status indicators:
   - Green = Ready to merge
   - Yellow = Checks pending
   - Red = Checks failed or not mergeable
5. Use action buttons to manage PR:
   - Merge PR (only enabled when ready)
   - Rerun checks
   - Request review

## Configuration

### Retry Policy Configuration

Environment variables (optional):
- None required - uses sensible defaults

Code configuration:
```typescript
const config: RetryPolicyConfig = {
  maxRetries: 3,          // 0-10
  initialDelayMs: 1000,   // 100-10000ms
  maxDelayMs: 32000,      // 1000-300000ms
  backoffMultiplier: 2,   // 1-5
  jitterFactor: 0.25,     // 0-1 (0=no jitter, 1=100% jitter)
};
```

### GitHub Status Sync

Database connection required:
- Uses existing PostgreSQL connection from `@/lib/db`
- Requires migration `057_workflow_action_audit.sql` to be applied

## Architecture

### Retry Policy Flow

```
API Call
  ↓
withRetry()
  ↓
Execute → Success → Return result
  ↓
Error
  ↓
Classify Error
  ↓
Retryable? → No → Throw error
  ↓ Yes
Check max retries → Exceeded → Throw error
  ↓ Not exceeded
Calculate backoff delay
  ↓
Wait (with jitter)
  ↓
Retry (loop back to Execute)
```

### Workflow Automation Flow

```
User selects PR
  ↓
Frontend calls /api/github/status/sync
  ↓
Backend fetches from GitHub (with retry)
  ├─ PR data
  ├─ Check runs
  ├─ Commit status (CI)
  └─ Reviews
  ↓
Calculate aggregated status
  ↓
Store in github_status_cache
  ↓
Return to frontend
  ↓
Display status dashboard
  ↓
User clicks action button
  ↓
Validate prerequisites (checks, permissions)
  ↓
Execute action (future)
  ↓
Log to workflow_action_audit
```

## Testing

### Running Tests

```bash
# Run retry policy tests
cd control-center
npm test -- --testPathPattern=github-retry-policy

# Run all tests
npm test
```

### Build Verification

```bash
# Build control center
cd control-center
npm run build
```

## Acceptance Criteria

### E82.4: GH Rate-limit & Retry Policy

- [x] Deterministic exponential backoff implemented
- [x] Bounded retries (max attempts, max delay)
- [x] Rate-limit detection and handling (primary & secondary)
- [x] Integration with GitHub auth wrapper
- [x] Comprehensive test coverage

### E84: Post-Publish Workflow Automation

- [x] Workflow Runner UI created
- [x] Read-only status sync for PR checks, CI, mergeability
- [x] Action buttons (merge, rerun checks, request review)
- [x] Guardrails: merge disabled without green checks
- [x] Audit trail table and schema
- [x] Fail-closed permission model (via auth-wrapper integration)

## Future Enhancements

1. **Action Implementation**:
   - Implement actual merge, rerun checks, request review actions
   - Connect action buttons to backend APIs
   - Full audit trail logging

2. **Issue Support**:
   - Extend status sync to handle issues
   - Add issue-specific actions (assign, close, label)

3. **Automated Workflow**:
   - Auto-merge PRs with green checks
   - Scheduled status sync
   - Webhook integration for real-time updates

4. **Enhanced UI**:
   - Real-time status updates (WebSocket)
   - Filtering and search
   - Batch operations
   - Custom workflow definitions

5. **Analytics**:
   - Merge time metrics
   - Check failure patterns
   - Review turnaround time

## References

- **E82.4**: GH Rate-limit & Retry Policy (deterministic backoff, bounded)
- **E84**: Post-Publish Workflow Automation (semi-automated "run the loop")
- **I711**: Repo Access Policy (used for permission checks)
- GitHub REST API: https://docs.github.com/en/rest
- Octokit throttling: https://github.com/octokit/plugin-throttling.js
