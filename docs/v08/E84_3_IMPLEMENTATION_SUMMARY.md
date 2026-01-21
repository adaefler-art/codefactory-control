# E84.3 Implementation Summary

## Overview

This document summarizes the implementation of E84.3: Tool `rerun_failed_jobs` with bounded retry policy and comprehensive audit trail.

## Objective

Eliminate manual "Re-run failed jobs" actions while ensuring safety through:
- Only reruns jobs with eligible failure classes
- Bounded retry limits prevent endless reruns
- Complete audit trail for compliance
- Fail-closed authorization

## Scope

Automated rerun of failed GitHub workflow jobs/runs with:
- Policy-based job selection (flaky probable, infra transient)
- Maximum attempts enforcement per (pr, runId, jobName)
- Integration with E83.1 repository actions registry
- Append-only audit ledger

## Implementation

### 1. Database Migration: `062_job_rerun_attempts.sql`

**Purpose**: Append-only ledger for tracking job rerun attempts with bounded retry.

**Tables Created**:
- `job_rerun_attempts`: Core ledger table
  - Idempotency key: (resource_owner, resource_repo, pr_number, workflow_run_id, job_name)
  - Fields: attempt_number, decision, reason_code, prior_conclusion, failure_class, lawbook_hash, etc.
  - Indexes for idempotency checks, PR queries, audit queries, and analytics

**Views Created**:
- `job_rerun_attempt_counts`: Aggregated attempt counts for idempotency
- `recent_job_reruns`: Recent activity monitoring (last 100)

**Key Features**:
- Append-only (no UPDATE or DELETE operations)
- Composite indexes for efficient queries
- JSONB fields for flexible metadata storage
- Clear schema documentation (workflow_run_id vs check_suite_id)

### 2. Type Definitions: `src/lib/types/job-rerun.ts`

**Schemas Defined**:

```typescript
// Decision types
RerunDecisionSchema: 'RERUN_TRIGGERED' | 'NOOP' | 'BLOCKED'
RerunModeSchema: 'FAILED_ONLY' | 'ALL_JOBS'

// Job status
JobRerunStatusSchema: {
  jobName, jobId?, priorConclusion, 
  action: 'RERUN' | 'SKIP' | 'BLOCKED',
  attemptNumber, reasonCode?
}

// Complete result
RerunResultV1Schema: {
  schemaVersion: '1.0',
  requestId, lawbookHash, deploymentEnv,
  target: { prNumber, runId? },
  decision, reasons, jobs,
  metadata: { totalJobs, rerunJobs, blockedJobs, skippedJobs }
}

// API input
JobRerunInputSchema: {
  owner, repo, prNumber,
  runId?, // Auto-discovered if not provided
  mode: default 'FAILED_ONLY',
  maxAttempts: default 2, max 5,
  requestId?
}
```

### 3. Rerun Service: `src/lib/github/job-rerun-service.ts`

**Core Functions**:

1. **`getLawbookHash()`**: Retrieves lawbook version from env or default
2. **`getDeploymentEnv()`**: Determines staging vs prod environment
3. **`classifyFailureForRerun()`**: Determines job eligibility
   - Returns: 'flaky probable', 'infra transient', or null
   - Patterns:
     - Infra transient: timeout, network, rate limit, 500/502/503
     - Flaky probable: flaky, intermittent, random, race condition
4. **`getAttemptCount()`**: Queries DB for current attempt count
5. **`recordRerunAttempt()`**: Inserts attempt record (append-only)
6. **`recordAuditEvent()`**: Logs to workflow_action_audit table
7. **`rerunFailedJobs()`**: Main orchestration function

**Algorithm Flow**:

```
1. Authenticate with GitHub (policy enforcement)
2. Get PR details (find head SHA)
3. Fetch check runs with pagination (up to 500)
4. Auto-discover workflow run ID if not provided
5. For each check run:
   a. Skip if not failed (FAILED_ONLY mode)
   b. Classify failure (eligible or not)
   c. Check attempt count vs maxAttempts
   d. Record decision (RERUN, SKIP, or BLOCKED)
   e. Store in database
6. Trigger GitHub rerun API (if eligible jobs found)
7. Record audit event
8. Return RerunResultV1
```

**Key Features**:
- Idempotent (same inputs → same result)
- Pagination support (handles large repos)
- Automatic run ID discovery
- Comprehensive error handling
- Retry policy for GitHub API calls

### 4. API Route: `app/api/github/prs/[prNumber]/checks/rerun/route.ts`

**Endpoint**: `POST /api/github/prs/{prNumber}/checks/rerun`

**Request Body**:
```json
{
  "owner": "string",
  "repo": "string",
  "runId": "number?",
  "mode": "FAILED_ONLY | ALL_JOBS",
  "maxAttempts": 2,
  "requestId": "string?"
}
```

**Response** (200):
```json
{
  "schemaVersion": "1.0",
  "requestId": "string",
  "lawbookHash": "string",
  "deploymentEnv": "staging | prod",
  "target": { "prNumber": 123, "runId": 456 },
  "decision": "RERUN_TRIGGERED | NOOP | BLOCKED",
  "reasons": ["string"],
  "jobs": [JobRerunStatus],
  "metadata": {
    "totalJobs": 10,
    "rerunJobs": 3,
    "blockedJobs": 1,
    "skippedJobs": 6
  }
}
```

**Status Codes**:
- 200: Success
- 400: Invalid input (bad PR number, missing params)
- 401: Authentication required
- 403: Repository access denied OR action not allowed
- 404: PR or workflow run not found
- 409: Repository not in registry (production fail-closed)
- 500: Internal error

**Guardrails Order**:
1. 401: GitHub authentication required
2. 409: Repository not in registry (prod only)
3. 403: Action not allowed by registry policy
4. Policy check: Failure class must be eligible
5. GitHub write: Trigger rerun

**Registry Integration**:
- Checks for `rerun_failed_jobs` action in registry
- Respects registry's `maxRetries` configuration
- Fail-closed: production blocks unknown repos

### 5. Tests

**Service Tests** (`__tests__/lib/job-rerun-service.test.ts`):
- ✅ Attempt counter logic (1st attempt allowed)
- ✅ Bounded retry (2nd attempt allowed, 3rd blocked)
- ✅ Deterministic job selection (only eligible failures)
- ✅ Audit event creation (database records)

**API Tests** (`__tests__/api/github-prs-checks-rerun.test.ts`):
- ✅ Valid request in staging
- ✅ Production fail-closed (no registry)
- ✅ Action not allowed by registry
- ✅ Registry maxRetries respected
- ✅ Invalid inputs (400 errors)
- ✅ Default parameter handling

### 6. Verification Script

**PowerShell**: `scripts/verify-e84-3-rerun-jobs.ps1`

**Usage**:
```powershell
.\scripts\verify-e84-3-rerun-jobs.ps1 `
  -BaseUrl "http://localhost:3000" `
  -Owner "test-owner" `
  -Repo "test-repo" `
  -PrNumber 123 `
  -RunId 456
```

**Test Scenarios**:
1. Basic rerun request (FAILED_ONLY, maxAttempts=2)
2. Idempotency verification (second request)
3. Max attempts limit (maxAttempts=1)

**Validations**:
- Schema version
- Request ID presence
- Lawbook hash
- Decision validity
- Jobs array structure
- Metadata completeness

## Acceptance Criteria

✅ **Can rerun failed jobs on a staging PR**
- Implemented via API endpoint
- Tested with mock GitHub responses
- Verification script provided

✅ **Won't rerun endlessly; respects maxAttempts**
- Bounded retry logic in service
- Database-backed attempt counter
- BLOCKED decision when limit exceeded
- Hard cap of 5 attempts

✅ **Produces audit rows for each job decision**
- `job_rerun_attempts` table (job-level)
- `workflow_action_audit` table (action-level)
- Append-only ledger
- Complete context (decision, reasons, lawbook hash)

✅ **Deterministic job selection**
- Failure classification logic
- Only eligible classes rerun (flaky, infra transient)
- Deterministic failures skipped
- Test coverage for selection logic

✅ **PowerShell verification**
- Comprehensive script provided
- Multiple test scenarios
- Response validation
- Clear output formatting

## Technical Decisions

### Why Make runId Optional?

**Original Spec**: `runId?: number` (optional)

**Decision**: Keep optional, auto-discover from workflow runs

**Rationale**:
- Better UX: caller doesn't need to look up run ID
- Fallback mechanism: query GitHub for recent workflow runs
- Error handling: if discovery fails, SKIP jobs with `no_run_id` reason

### Why Pagination Limit at 500?

**Decision**: Cap check runs pagination at 500

**Rationale**:
- Most repositories have < 100 checks per run
- Prevents memory exhaustion in extreme cases
- 500 is reasonable upper bound
- Can be adjusted via configuration if needed

### Why Fail-Closed in Production?

**Decision**: Return 409 if repository not in registry (prod only)

**Rationale**:
- Security: unknown repos blocked by default
- E83.1 compliance: registry is source of truth
- Staging flexibility: allow testing without registry
- Explicit opt-in: repos must be registered

### Why Two Audit Tables?

**Decision**: Use both `job_rerun_attempts` and `workflow_action_audit`

**Rationale**:
- Different granularity: job-level vs action-level
- `job_rerun_attempts`: Specific to E84.3, idempotency tracking
- `workflow_action_audit`: General workflow actions (E84 series)
- Allows separate querying: job attempts vs overall actions

## Files Changed

### New Files
1. `database/migrations/062_job_rerun_attempts.sql` (114 lines)
2. `control-center/src/lib/types/job-rerun.ts` (149 lines)
3. `control-center/src/lib/github/job-rerun-service.ts` (484 lines)
4. `control-center/app/api/github/prs/[prNumber]/checks/rerun/route.ts` (233 lines)
5. `control-center/__tests__/lib/job-rerun-service.test.ts` (353 lines)
6. `control-center/__tests__/api/github-prs-checks-rerun.test.ts` (333 lines)
7. `scripts/verify-e84-3-rerun-jobs.ps1` (223 lines)
8. `E84_3_SECURITY_SUMMARY.md` (this document's companion)

**Total**: ~1,889 lines of code + tests + docs

### Modified Files
None (clean implementation, no modifications to existing files)

## Integration Points

### Upstream Dependencies
- `src/lib/github/auth-wrapper`: GitHub authentication + policy enforcement
- `src/lib/github/retry-policy`: API retry logic
- `src/lib/repo-actions-registry-service`: E83.1 registry integration
- `src/lib/db`: Database connection pool
- `src/lib/logger`: Structured logging

### Downstream Consumers
- Future workflow automation tools (E84.4+)
- CI/CD monitoring dashboards
- Audit compliance reports

## Deployment Checklist

### Prerequisites
- [x] Database migration 062 applied
- [x] Environment variables configured:
  - `LAWBOOK_HASH` (optional, defaults to v1.0.0-dev)
  - `DEPLOY_ENV` (optional, defaults to staging)
- [ ] Repository actions registry configured (E83.1)
- [ ] GitHub App permissions verified (actions:write)

### Post-Deployment Verification
1. Run PowerShell verification script
2. Monitor `job_rerun_attempts` table for entries
3. Check `workflow_action_audit` for action logs
4. Verify fail-closed behavior in production
5. Test bounded retry limits

## Known Limitations

1. **Pagination Limit**: 500 check runs max
   - Impact: Very large repos might miss some checks
   - Mitigation: Configurable limit if needed

2. **Check Suite vs Workflow Run**: 
   - runId must be workflow run ID, not check suite ID
   - Auto-discovery helps but requires additional API call
   - Documented in schema and code comments

3. **Failure Classification**:
   - Pattern-based (not ML/heuristics)
   - May misclassify edge cases
   - Conservative: skips if unsure

4. **No Concurrent Reruns**:
   - Multiple simultaneous requests might create race conditions
   - Database transactions mitigate
   - Append-only ledger prevents data loss

## Future Enhancements

### Potential Improvements
1. **ML-based Failure Classification**: More accurate detection of flaky tests
2. **Configurable Patterns**: Allow repos to define custom failure patterns
3. **Batch Operations**: Rerun jobs across multiple PRs
4. **Webhook Integration**: Auto-rerun on failure events
5. **Cost Tracking**: Monitor GitHub Actions minutes consumed
6. **Advanced Analytics**: Failure pattern analysis and recommendations

### API Evolution
- v1.1: Add `dryRun` mode for testing
- v1.2: Support for custom failure classifiers
- v2.0: Batch operations and webhook support

## References

- **Epic E84**: Post-Publish Workflow Automation
- **E84.1**: Checks Triage Analyzer (upstream)
- **E84.2**: Copilot Prompt Generator (related)
- **E83.1**: Repository Actions Registry (dependency)
- **I711**: Repo Access Policy + Auth Wrapper (security)
- **E82.4**: GH Rate-limit & Retry Policy (infrastructure)

## Conclusion

E84.3 implementation successfully delivers a production-ready tool for automated job reruns with:
- ✅ Comprehensive security controls
- ✅ Bounded retry to prevent abuse
- ✅ Complete audit trail
- ✅ Fail-closed authorization
- ✅ Extensive test coverage
- ✅ Operational verification tooling

**Status**: Ready for deployment  
**Next Steps**: E84.4 (if applicable) or production rollout

---

**Implemented By**: GitHub Copilot  
**Date**: 2026-01-13  
**Version**: 1.0  
**Status**: ✅ COMPLETE
