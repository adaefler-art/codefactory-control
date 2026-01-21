# E84.3 Security Summary

## Security Review - Rerun Failed Jobs Tool

### Overview
This implementation adds a `rerun_failed_jobs` API endpoint with bounded retry policy and comprehensive audit trail. The security review focused on input validation, SQL injection prevention, authorization controls, and rate limiting.

### Security Measures Implemented

#### 1. Input Validation ✅
- **Zod Schema Validation**: All inputs validated using `JobRerunInputSchema`
  - Owner, repo, prNumber are required and validated
  - maxAttempts has hard cap of 5 (prevents resource exhaustion)
  - Mode is enum-validated (FAILED_ONLY or ALL_JOBS)
- **Type Safety**: TypeScript strict mode ensures type correctness throughout

#### 2. SQL Injection Prevention ✅
- **Parameterized Queries**: All database queries use parameterized placeholders (`$1, $2, ...`)
  - `getAttemptCount()`: Uses 5 parameters for WHERE clause
  - `recordRerunAttempt()`: Uses 16 parameters for INSERT
  - `recordAuditEvent()`: Uses 9 parameters for INSERT
- **No String Interpolation**: No SQL queries constructed with string concatenation
- **JSON Serialization**: JSONB fields use `JSON.stringify()` before insertion

#### 3. Authorization & Access Control ✅
- **Fail-Closed by Default**: Production blocks requests if repository not in registry (409)
- **Repo Access Policy**: Enforced via `auth-wrapper` with `RepoAccessDeniedError` (403)
- **Action Authorization**: Validates `rerun_failed_jobs` action is allowed in registry
- **Registry Integration**: Respects E83.1 repo actions registry configuration
- **Guardrail Order**: 401 → 409 → 403 → policy check → GitHub write

#### 4. Rate Limiting & Bounded Retry ✅
- **Max Attempts Enforcement**: Hard cap of 5 attempts, default 2
- **Idempotency Tracking**: Uses composite key (owner, repo, prNumber, runId, jobName)
- **Attempt Counter**: Database-backed, append-only ledger prevents circumvention
- **Decision Blocking**: Jobs exceeding maxAttempts get `BLOCKED` decision
- **Registry Override**: Registry's `maxRetries` can further restrict attempts

#### 5. Audit Trail ✅
- **Append-Only Ledger**: `job_rerun_attempts` table never updated, only inserted
- **Complete Context**: Records decision, reasons, attempt number, lawbook hash
- **Dual Logging**: 
  - Job-level: `job_rerun_attempts` table
  - Action-level: `workflow_action_audit` table
- **Request Tracking**: Every request gets unique `requestId`

#### 6. GitHub API Safety ✅
- **Authenticated Client**: Uses `createAuthenticatedClient()` with policy enforcement
- **Retry Policy**: GitHub API calls wrapped with `withRetry()` for transient failures
- **Error Handling**: GitHub API errors caught and logged, don't expose sensitive data
- **Scoped Actions**: Only calls `reRunWorkflowFailedJobs()`, not broader permissions

#### 7. Information Disclosure Prevention ✅
- **Error Responses**: Generic error messages, sensitive details only in logs
- **Request ID**: Returned in response headers for debugging without exposing internals
- **Status Codes**: Standard HTTP codes (400, 401, 403, 404, 409, 500)
- **No Token Leakage**: GitHub tokens never returned in API responses

#### 8. Resource Protection ✅
- **Pagination Limit**: Check runs pagination capped at 500 (prevents memory exhaustion)
- **Job Selection Policy**: Only reruns jobs with eligible failure classes
  - `flaky probable`: Pattern-based detection
  - `infra transient`: Timeout/network failures
  - Deterministic failures: SKIP (not eligible)
- **Deployment Environment**: Reads from `DEPLOY_ENV`, defaults to staging (safe)

### Potential Concerns & Mitigations

#### ⚠️ Environment Variable Usage
**Issue**: Uses `process.env.LAWBOOK_HASH` and `process.env.DEPLOY_ENV`  
**Mitigation**: 
- Falls back to safe defaults (`v1.0.0-dev`, `staging`)
- No user-controlled environment variables
- Values validated before use

#### ⚠️ GitHub API Dependency
**Issue**: Relies on external GitHub API  
**Mitigation**:
- Retry policy handles transient failures
- Error handling prevents cascading failures
- GitHub errors don't crash the service

#### ⚠️ Pagination Limit
**Issue**: 500 check runs limit might miss jobs in very large repositories  
**Mitigation**:
- Reasonable limit for most use cases
- Prevents memory/performance issues
- Can be adjusted if needed via configuration

### Vulnerabilities Found

**None identified.** 

The implementation follows security best practices:
- Input validation at all layers
- Parameterized SQL queries
- Fail-closed authorization
- Bounded retry prevents abuse
- Comprehensive audit trail
- No injection vectors found

### Compliance & Best Practices

✅ **OWASP Top 10**:
- A01: Broken Access Control - ✅ Addressed (registry + auth-wrapper)
- A02: Cryptographic Failures - N/A (no encryption in scope)
- A03: Injection - ✅ Addressed (parameterized queries)
- A04: Insecure Design - ✅ Addressed (fail-closed, bounded retry)
- A05: Security Misconfiguration - ✅ Addressed (safe defaults)
- A06: Vulnerable Components - ✅ No new dependencies
- A07: Authentication Failures - ✅ Addressed (GitHub auth required)
- A08: Software and Data Integrity - ✅ Addressed (audit trail)
- A09: Logging Failures - ✅ Addressed (comprehensive logging)
- A10: SSRF - ✅ Addressed (GitHub API only, no user URLs)

✅ **Least Privilege**: Only requests necessary GitHub permissions  
✅ **Defense in Depth**: Multiple layers (auth, registry, policy, limits)  
✅ **Fail-Safe Defaults**: Production blocks unknown repos  
✅ **Separation of Duties**: Registry defines policy, service enforces  

### Recommendations

1. ✅ **Implemented**: Use parameterized queries (already done)
2. ✅ **Implemented**: Add comprehensive input validation (already done)
3. ✅ **Implemented**: Enforce fail-closed authorization (already done)
4. ✅ **Implemented**: Add rate limiting via bounded retry (already done)
5. ✅ **Implemented**: Create audit trail (already done)

### Conclusion

**Security Posture: STRONG** 🟢

The implementation demonstrates excellent security practices:
- No SQL injection vulnerabilities
- No authorization bypasses
- No information disclosure risks
- Proper input validation
- Comprehensive audit logging
- Defense in depth architecture

**Ready for production deployment** with current security controls.

---

**Reviewed By**: GitHub Copilot  
**Date**: 2026-01-13  
**Scope**: E84.3 - Tool: rerun_failed_jobs (bounded retry + audit)  
**Result**: ✅ APPROVED - No security issues found
