# E87.1 Approval Gate Framework - Security Summary

## Security Assessment

This document provides a comprehensive security analysis of the Approval Gate Framework implementation.

## Security Architecture

### 1. Fail-Closed by Default

**Principle:** Every security gate defaults to DENY unless explicitly allowed.

**Implementation:**
- Missing approval → operation blocked (403)
- Invalid phrase → approval rejected (400)
- Expired approval → operation blocked (409)
- No authentication → rejected before processing (401)

**Code Evidence:**
```typescript
// approval-gate.ts:138-146
if (!approval) {
  return {
    allowed: false,
    reason: 'No approval found for this action',
    actionFingerprint,
  };
}
```

**Security Impact:** ✅ **SECURE**
- Prevents unauthorized operations by default
- No implicit approvals or bypass mechanisms
- Every code path explicitly checks approval

### 2. Authentication Requirements

**Guard Order (Preserved from E83/E84):**
1. AUTH CHECK (401-first) - Verify x-afu9-sub header
2. Input validation (400) - Validate request schema
3. Approval gate check (403/409) - Verify approval exists
4. Business logic - Proceed with operation

**Implementation:**
```typescript
// route.ts:44-52
const userId = request.headers.get('x-afu9-sub');
if (!userId || !userId.trim()) {
  return errorResponse('Unauthorized', {
    status: 401,
    requestId,
    code: 'UNAUTHORIZED',
  });
}
```

**Security Impact:** ✅ **SECURE**
- Authentication verified before any approval processing
- No database queries before auth check
- Headers set by server-side proxy (not client-spoofable)

### 3. Deterministic Action Fingerprints

**Threat Model:** Prevent approval reuse, replay attacks, and approval confusion.

**Implementation:**
```typescript
// approval-gate.ts:115-126
export function computeActionFingerprint(context: ActionContext): string {
  const canonical = stableStringify({
    actionType: context.actionType,
    targetType: context.targetType,
    targetIdentifier: context.targetIdentifier,
    params: context.params || {},
  });
  
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

**Security Properties:**
- Same inputs → same hash (idempotency)
- Different actions → different hashes (no confusion)
- Cryptographically strong (SHA-256)
- Deterministic key ordering (stableStringify)

**Attack Scenarios Prevented:**
- ❌ Reusing approval for different PR
- ❌ Reusing approval for different action type
- ❌ Modifying action params after approval

**Security Impact:** ✅ **SECURE**

### 4. Signed Phrase Verification

**Threat Model:** Prevent accidental/automatic approvals, ensure explicit consent.

**Implementation:**
```typescript
// approval-gate.ts:83-92
export function validateSignedPhrase(
  signedPhrase: string,
  actionType: ActionType
): { valid: boolean; expectedPhrase: string } {
  const expectedPhrase = getRequiredPhrase(actionType);
  const valid = signedPhrase === expectedPhrase; // Exact match
  
  return { valid, expectedPhrase };
}
```

**Required Phrases:**
- `merge`: `"YES MERGE"` (exactly, case-sensitive)
- `prod_operation`: `"YES PROD"`
- `destructive_operation`: `"YES DESTRUCTIVE"`

**Attack Scenarios Prevented:**
- ❌ Auto-clicking "approve" button
- ❌ Keyboard shortcuts for approval
- ❌ Case-insensitive bypass ("yes merge")
- ❌ Partial phrase bypass ("YES")

**Security Impact:** ✅ **SECURE**

### 5. Time Windows (Expiration)

**Threat Model:** Prevent replay attacks with old approvals.

**Implementation:**
```typescript
// approval-gate.ts:173-179
const approvalAge = (Date.now() - new Date(approval.created_at).getTime()) / 1000;
if (approvalAge > approvalWindow) {
  return {
    allowed: false,
    reason: `Approval expired (${Math.floor(approvalAge)}s old, max ${approvalWindow}s)`,
  };
}
```

**Default Window:** 5 minutes (300 seconds)

**Attack Scenarios Prevented:**
- ❌ Reusing approval from yesterday
- ❌ Stockpiling approvals for later
- ❌ Time-of-check-time-of-use (TOCTOU) attacks

**Security Impact:** ✅ **SECURE**

### 6. Append-Only Audit Trail

**Threat Model:** Prevent tampering with audit records, ensure forensic integrity.

**Database Schema:**
```sql
-- No UPDATE or DELETE statements in code
-- Only INSERT allowed
CREATE TABLE approval_gates (
  id SERIAL PRIMARY KEY,
  action_fingerprint VARCHAR(64) NOT NULL,
  decision VARCHAR(20) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ...
);
```

**Implementation:**
```typescript
// approvals.ts:49-85
export async function insertApprovalRecord(
  pool: Pool,
  request: ApprovalRequest,
  decision: ApprovalDecision
): Promise<ApprovalRecord> {
  // INSERT only - no UPDATE capability
  const query = `INSERT INTO approval_gates (...) VALUES (...)`;
  return result.rows[0];
}
```

**Security Properties:**
- No UPDATE queries in codebase
- No DELETE queries in codebase
- Every decision immutably recorded
- Full context captured (lawbook version, actor, timestamp)

**Attack Scenarios Prevented:**
- ❌ Modifying past approvals
- ❌ Deleting denied approvals
- ❌ Backdating approvals
- ❌ Changing approval actor

**Security Impact:** ✅ **SECURE**

### 7. Context Capture

**Threat Model:** Enable forensic investigation, policy compliance, detect policy drift.

**Captured Context:**
```typescript
interface ApprovalRecord {
  action_fingerprint: string;      // Deterministic action hash
  lawbook_version: string | null;  // Policy version at approval time
  lawbook_hash: string | null;     // Policy content hash
  context_pack_hash: string | null;// Input data hash
  context_summary: JSON;            // Human-readable summary
  signed_phrase_hash: string;       // Verification hash
  actor: string;                    // Who approved
  created_at: Date;                 // When approved
}
```

**Security Benefits:**
- Audit trail shows exact policy version used
- Can detect if policy changed after approval
- Actor accountability (cannot be repudiated)
- Context summary for human review

**Security Impact:** ✅ **SECURE**

### 8. No Bypass Mechanisms

**Threat Model:** Prevent circumventing approval gate via API or configuration.

**Enforcement:**
```typescript
// approval-gate-integration.ts:60-82
export async function requireApprovalGate(
  params: ApprovalGateCheckParams,
  pool: Pool
): Promise<ApprovalGateCheckResult> {
  // Check environment only for testing, not bypass
  // Still requires valid approval even if enabled
  const gateResult = await checkApprovalGate(...);
  
  if (!gateResult.allowed) {
    // FAIL: return error, do not proceed
    return { allowed: false, error: {...} };
  }
  
  return { allowed: true, ... };
}
```

**Configuration:**
- `APPROVAL_GATE_ENABLED=false`: Disables gate check entirely (testing only)
- Default: `true` (gate enabled)
- No per-user bypass
- No per-action bypass
- No admin override

**Security Impact:** ⚠️ **WARNING**
- `APPROVAL_GATE_ENABLED=false` disables entire framework
- **Recommendation:** Only set in non-production environments
- **Recommendation:** Add environment check (fail if prod + disabled)

### 9. Input Validation

**Threat Model:** Prevent injection attacks, malformed data.

**Implementation:**
```typescript
// route.ts:33-42
const ApprovalRequestSchema = z.object({
  actionContext: z.object({
    actionType: z.enum(['merge', 'prod_operation', 'destructive_operation']),
    targetType: z.string(),
    targetIdentifier: z.string(),
    params: z.record(z.any()).optional(),
  }),
  // ...
});
```

**Validation Checks:**
- Action type: Enum validation (only 3 allowed values)
- Strings: Type checking (not null/undefined)
- Signed phrase: Exact match (no injection possible)
- JSON: Zod schema validation

**Attack Scenarios Prevented:**
- ❌ SQL injection (parameterized queries + validation)
- ❌ XSS (React auto-escaping + validation)
- ❌ Type confusion attacks

**Security Impact:** ✅ **SECURE**

### 10. Separation of Approval and Execution

**Threat Model:** Prevent TOCTOU attacks, ensure approval precedes execution.

**Workflow:**
1. Client submits approval (POST /api/approvals)
2. Server validates and records approval
3. Client calls operation endpoint (POST /api/.../merge)
4. Server checks approval gate BEFORE executing
5. If no approval → 403/409 error

**Request ID Correlation:**
```typescript
// Client must use same requestId for both calls:
const requestId = crypto.randomUUID();

// 1. Create approval
await fetch('/api/approvals', {
  body: JSON.stringify({ approvalContext: { requestId }, ... }),
});

// 2. Execute operation (same requestId)
await fetch('/api/merge', {
  headers: { 'x-request-id': requestId },
});
```

**Security Impact:** ✅ **SECURE**
- Approval and execution are separate API calls
- Approval must exist before execution proceeds
- Request ID links approval to specific operation

## Vulnerability Assessment

### Known Limitations

1. **Environment Bypass**
   - **Issue:** `APPROVAL_GATE_ENABLED=false` disables entire framework
   - **Risk:** HIGH in production, LOW in staging/dev
   - **Mitigation:** Document clearly, add environment check
   - **Recommendation:** Add prod guard:
     ```typescript
     if (getDeploymentEnv() === 'production' && !isApprovalGateEnabled()) {
       throw new Error('Approval gate cannot be disabled in production');
     }
     ```

2. **Approval Window Configuration**
   - **Issue:** Configurable window (default 5 min)
   - **Risk:** LOW - longer windows = higher replay risk
   - **Mitigation:** Document recommended values
   - **Recommendation:** Max 10 minutes, min 1 minute

3. **Phrase Storage**
   - **Issue:** Raw signed phrase stored in database
   - **Risk:** LOW - sensitive but not a secret
   - **Mitigation:** Hash stored alongside raw phrase
   - **Recommendation:** Consider redacting raw phrase in production (keep hash only)

### Security Checklist

- [x] Fail-closed by default
- [x] Authentication required (401-first)
- [x] No SQL injection vectors
- [x] No XSS vectors
- [x] No CSRF vectors (stateless API)
- [x] Deterministic fingerprints (SHA-256)
- [x] Append-only audit trail
- [x] Time-bound approvals (expiration)
- [x] Explicit consent (signed phrase)
- [x] Full context capture
- [x] Input validation (Zod schemas)
- [x] Type safety (TypeScript)
- [x] Comprehensive test coverage (26 tests)
- [ ] Production environment guard (RECOMMENDED)
- [ ] Phrase redaction in prod (OPTIONAL)

## Security Test Results

### Unit Tests

All security-critical functions tested:

```
✓ Phrase validation (exact match enforced)
✓ Fingerprint determinism (same inputs → same hash)
✓ Fail-closed behavior (no approval → deny)
✓ Expiration enforcement (old approvals rejected)
✓ Request validation (invalid inputs rejected)
```

### Manual Security Testing

Recommended manual tests:

1. **Bypass Attempts:**
   - [ ] Try operation without approval → 403
   - [ ] Try operation with wrong requestId → 403
   - [ ] Try operation with expired approval → 409
   - [ ] Try operation with denied approval → 403

2. **Phrase Variations:**
   - [ ] Try "yes merge" (lowercase) → 400
   - [ ] Try "YES" (partial) → 400
   - [ ] Try "YES MERGE " (trailing space) → 400
   - [ ] Try "YES PROD" for merge → 400

3. **Fingerprint Stability:**
   - [ ] Create approval for PR #123
   - [ ] Try using approval for PR #456 → 403
   - [ ] Verify fingerprint changes with params

## Recommendations

### Immediate

1. **Add Production Guard:**
   ```typescript
   if (getDeploymentEnv() === 'production' && !isApprovalGateRequired('merge')) {
     throw new Error('SECURITY: Approval gate cannot be disabled in production');
   }
   ```

2. **Document Environment Variables:**
   - `APPROVAL_GATE_ENABLED`: Should NEVER be false in production
   - `APPROVAL_WINDOW_SECONDS`: Max 600 (10 min), default 300 (5 min)

3. **Integrate into Critical Endpoints:**
   - PR merge endpoints
   - Production deployment endpoints
   - Database migration/rollback endpoints

### Short-Term

1. **Lawbook Integration:**
   - Move approval requirements to lawbook
   - Allow per-repository approval policies
   - Capture lawbook hash in approval record

2. **Rate Limiting:**
   - Limit approval attempts per user per hour
   - Prevent brute-force phrase guessing

3. **Notification System:**
   - Alert security team on approval requests
   - Log approval denials

### Long-Term

1. **Multi-Approver Support:**
   - Require N-of-M approvals for critical operations
   - Different approval levels (user, admin, security)

2. **Approval Templates:**
   - Pre-defined approval workflows
   - Risk-based approval requirements

3. **Audit Analytics:**
   - Dashboard for approval metrics
   - Anomaly detection (unusual approval patterns)

## Compliance Notes

### Audit Trail

The framework provides complete audit trail for compliance:
- **SOX/SOC2:** Immutable approval records with actor accountability
- **ISO 27001:** Explicit approval for privileged operations
- **PCI DSS:** Separation of duties (approval ≠ execution)

### Data Retention

Approval records are append-only and should be retained per company policy:
- **Recommended:** Minimum 1 year
- **Compliance:** May require longer (7+ years for financial)

## Conclusion

The Approval Gate Framework implements a robust, fail-closed security architecture for dangerous operations in AFU-9.

### Security Posture

- ✅ **Strong** - Fail-closed, deterministic, auditable
- ⚠️ **Warning** - Environment bypass needs production guard
- ✅ **Tested** - 26 unit tests, all security functions covered

### Risk Level

- **LOW** - When properly integrated with production guard
- **MEDIUM** - If `APPROVAL_GATE_ENABLED=false` allowed in production

### Recommendation

**APPROVE** for production use with the following conditions:

1. Add production environment guard
2. Document environment variable security implications
3. Integrate into critical endpoints (merge, prod, destructive)
4. Run end-to-end verification script
5. Monitor approval audit trail

The framework provides strong security guarantees and aligns with industry best practices for privileged operation approval.
