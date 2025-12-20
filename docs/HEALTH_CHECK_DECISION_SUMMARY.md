# Health Check Decision Summary & Related Issues

**Date:** 2025-12-20  
**Status:** Post PR #228 - ALB Health Check Fix  
**Scope:** ECS Health & Readiness Infrastructure, Documentation, Related Issues

## Executive Summary

Following PR #228 which fixed ECS health check rollbacks by updating the ALB health check path from `/api/ready` to `/api/health`, this document:

1. Documents the health check decision logic
2. Clarifies the distinction between liveness (`/api/health`) and readiness (`/api/ready`)
3. Provides guidance on related open issues
4. Defines the contract requirements for CI/CD

## 1. Current State (Post PR #228)

### ALB Health Check Configuration
- **Path:** `/api/health` (liveness probe)
- **Purpose:** Confirm Node.js process is alive and responding
- **Expected Response:** Always `200 OK` when process is running
- **No Dependency Checks:** Database, MCP servers, secrets are NOT checked
- **Use Case:** ALB target health, ECS container health checks

### Container Health Checks
- **Control Center:** `http://127.0.0.1:3000/api/health`
- **MCP GitHub:** `http://127.0.0.1:3001/health`
- **MCP Deploy:** `http://127.0.0.1:3002/health`
- **MCP Observability:** `http://127.0.0.1:3003/health`
- **Start Period:** 120 seconds to allow for cold start
- **Interval:** 30 seconds
- **Timeout:** 5 seconds
- **Retries:** 3

### Readiness Endpoint (Optional)
- **Path:** `/api/ready`
- **Purpose:** Comprehensive dependency checks
- **Expected Response:** `200 OK` when ready, `503` when not ready
- **Dependency Checks:** Database (if enabled), environment variables, MCP servers (optional)
- **Use Case:** Manual verification, monitoring, future Kubernetes readiness probes

## 2. Decision Tree: When to Use Which Endpoint

```
┌─────────────────────────────────────────────────────────┐
│ WHEN TO USE /api/health (LIVENESS)                     │
├─────────────────────────────────────────────────────────┤
│ ✓ ALB Target Group health checks                       │
│ ✓ ECS Container health checks                          │
│ ✓ Kubernetes liveness probes (future)                  │
│ ✓ Any check where false positives would cause outage   │
│ ✓ Automated restart/replace decisions                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ WHEN TO USE /api/ready (READINESS)                     │
├─────────────────────────────────────────────────────────┤
│ ✓ Manual deployment verification                       │
│ ✓ Monitoring dashboards and alerts                     │
│ ✓ Kubernetes readiness probes (future)                 │
│ ✓ Pre-deployment smoke tests                           │
│ ✓ Troubleshooting dependency issues                    │
│ ✗ NOT for ALB health checks (causes false negatives)   │
└─────────────────────────────────────────────────────────┘
```

### Decision Criteria

| Scenario | Endpoint | Rationale |
|----------|----------|-----------|
| Database temporarily unavailable | `/api/health` → 200<br>`/api/ready` → 503 | Service is alive but not ready. ALB keeps routing to allow recovery. |
| Node.js process crashed | `/api/health` → No response<br>`/api/ready` → No response | Both fail. ALB/ECS replaces container. |
| Startup phase (DB connecting) | `/api/health` → 200<br>`/api/ready` → 503 | Service is starting. ALB waits during grace period. |
| `DATABASE_ENABLED=false` | `/api/health` → 200<br>`/api/ready` → 200 | Service is ready, no dependencies required. |
| MCP server temporarily down | `/api/health` → 200<br>`/api/ready` → 200 (warning) | MCP servers are optional dependencies. |

## 3. Why PR #228 Was Necessary

### Problem (Before PR #228)
- ALB health check pointed to `/api/ready`
- `/api/ready` returned `503` during startup when database was initializing
- ECS Circuit Breaker interpreted `503` as failure → rollback
- Service was actually healthy but not yet ready

### Root Cause
- Confusion between **liveness** (is process alive?) and **readiness** (can process accept traffic?)
- ALB health checks should use liveness, not readiness

### Solution (PR #228)
- Changed ALB health check path from `/api/ready` to `/api/health`
- `/api/health` always returns `200` when Node.js is running
- No more false negatives during startup
- `/api/ready` remains available for manual checks

## 4. Related Issues Analysis

### Issue #199: Dual Semantics Health vs Ready, Doku vs Code
**Status:** Can be CLOSED after this documentation update  
**Reason:** 
- Documentation now clearly distinguishes liveness vs readiness
- Code already implements correct semantics (PR #228)
- Contract tests verify behavior (`control-center/__tests__/api/health-contract.test.ts`)

**Action:** Close issue after PR merges

---

### Issue #200: Decision Logic - ECS/ALB HealthCheck Signals
**Status:** RESOLVED by PR #228, update needed  
**Required Update:**
- ALB health check is `/api/health` (liveness)
- No ALB-dependent readiness logic needed
- Policy: ALB only uses liveness checks, never readiness checks

**Action:** Update issue to reference this document and PR #228, then close

---

### Issue #198: Health Signal Policy Overlap
**Status:** Review needed post-PR #228  
**Required Review:**
- Verify no conflict between this decision and #198's policy
- Ensure health signal policy aligns with liveness/readiness distinction
- Confirm Circuit Breaker behavior matches expectations

**Action:** Review overlap, update policy if needed, reference this document

---

### Issue #190: DB-Off Mode - Consistent Disable Reporting
**Status:** Partially addressed, coverage gap  
**Current State:**
- `DATABASE_ENABLED=false` → `/api/ready` returns `200` with `database: not_configured`
- Contract tests cover this scenario

**Gap:**
- Need integration tests for DB-Off mode in live environment
- Need `/api/ready` contract test coverage expansion

**Action:** 
1. Add integration test for DB-Off deployment
2. Expand contract tests for edge cases
3. Reference in runbooks

---

### Issue #187: CDK Synth/Diff Gates - Compatibility with Fail-Fast
**Status:** Monitor for health check contract violations  
**Required Gate:**
- CDK synth should fail if ALB health check path is changed from `/api/health`
- Add validation to prevent accidental revert to `/api/ready`

**Action:**
1. Add CDK validation rule for ALB health check path
2. Add to `scripts/validate-iam-policies.ts` or similar
3. Ensure CI catches violations

## 5. Contract Requirements

### ALB Health Check Contract (MUST)
```typescript
// Required: ALB Target Group health check configuration
{
  path: '/api/health',
  protocol: 'HTTP',
  interval: 30,
  timeout: 5,
  healthyThresholdCount: 2,
  unhealthyThresholdCount: 3,
  matcher: { httpCode: '200' }
}
```

**CI Enforcement:**
- Contract test: `control-center/__tests__/api/health-contract.test.ts`
- Test: `/api/health` ALWAYS returns `200 OK`
- Test: `/api/health` response structure is consistent
- Test: `/api/health` has no dependency checks

### Readiness Contract (SHOULD)
```typescript
// Optional: Readiness endpoint for manual checks
{
  path: '/api/ready',
  expectedCodes: [200, 503],
  checks: ['database', 'environment', 'mcp-servers (optional)']
}
```

**CI Enforcement:**
- Contract test: `control-center/__tests__/api/health-contract.test.ts`
- Test: `/api/ready` returns `200` when `DATABASE_ENABLED=false`
- Test: `/api/ready` returns `503` when `DATABASE_ENABLED=true` but secrets missing
- Test: `/api/ready` returns `200` when all dependencies available

## 6. Runbook Integration

### Smoke Test Script Updates
Location: `scripts/smoke-test.sh`, `scripts/smoke-test-staging.sh`

**Current Behavior:**
- Tests both `/api/health` (liveness) and `/api/ready` (readiness)
- Distinguishes between health (MUST be 200) and ready (200 or 503 acceptable)

**Required Documentation:**
```bash
# Test liveness (MUST return 200)
curl -f http://$ALB_DNS/api/health || {
  echo "ERROR: Liveness check failed - container is NOT healthy"
  exit 1
}

# Test readiness (200 = ready, 503 = not ready but alive)
curl http://$ALB_DNS/api/ready | jq .
# 503 during startup is NORMAL, does NOT indicate failure
```

### Verification Script Updates
Location: `scripts/post-deploy-verification.sh`

**Already Implemented:**
- Check 4: Health Endpoint (`/api/health`) - MUST return 200
- Check 5: Readiness Endpoint (`/api/ready`) - 200 or 503 acceptable

**Documentation Status:** ✅ Already correct

### Diagnostic Runbook Updates
Location: `docs/RUNBOOK_ECS_DEPLOY.md`

**Already Implemented:**
- Section on health check endpoints
- Clear distinction between liveness and readiness
- Troubleshooting for health check failures

**Documentation Status:** ✅ Already correct

## 7. Regression Prevention

### CI Test Gates
1. **Contract Tests** (MANDATORY)
   - Location: `control-center/__tests__/api/health-contract.test.ts`
   - Run: Every commit via CI
   - Blocks: Deploy if tests fail

2. **CDK Validation** (RECOMMENDED)
   - Validate ALB health check path in `lib/afu9-network-stack.ts`
   - Fail synth if path is not `/api/health`
   - Add to existing `scripts/validate-iam-policies.ts` or create new validator

3. **Smoke Tests** (MANDATORY)
   - Run: After every deployment
   - Validates: `/api/health` returns 200, `/api/ready` returns 200 or 503
   - Blocks: Promotion to production if health fails

### Code Review Checklist
- [ ] ALB health check path is `/api/health`
- [ ] Container health checks use `/health` or `/api/health`
- [ ] No dependency checks in liveness endpoints
- [ ] Readiness endpoint handles all dependency states (ok, error, not_configured)
- [ ] Contract tests pass
- [ ] Documentation updated if semantics change

## 8. Historical Context

### Problem History
- **Issue Date:** 2025-12-19
- **Symptom:** ECS Circuit Breaker triggered by failed health checks
- **Root Cause:** ALB checking `/api/ready` which returned 503 during startup
- **Impact:** Deployments rolled back despite healthy service

### Fix Timeline
- **PR #228:** Changed ALB health check from `/api/ready` to `/api/health`
- **Verification:** Runbooks and documentation updated
- **This Document:** Comprehensive decision tree and issue analysis

### Lessons Learned
1. **Liveness ≠ Readiness:** Different concerns, different endpoints
2. **ALB Should Use Liveness:** Avoid false negatives during startup
3. **Documentation Critical:** Prevent regression by documenting decisions
4. **Contract Tests Essential:** Enforce behavior in CI

## 9. Future Considerations

### Kubernetes Migration (Future)
When migrating to Kubernetes, apply these learned patterns:
```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/ready
    port: 3000
  initialDelaySeconds: 60
  periodSeconds: 10
```

### Multi-Region Deployment (Future)
- Ensure health check logic is consistent across regions
- Global health check path configuration in shared CDK constructs

## 10. References

- **PR #228:** Fix ECS health check rollbacks by updating ALB path
- **Control Plane Spec v1:** `docs/CONTROL_PLANE_SPEC.md`
- **Health & Readiness Verification:** `docs/HEALTH_READINESS_VERIFICATION.md`
- **ECS Health Checks Runbook:** `docs/runbooks/ecs-healthchecks.md`
- **ECS Deployment Runbook:** `docs/RUNBOOK_ECS_DEPLOY.md`
- **Contract Tests:** `control-center/__tests__/api/health-contract.test.ts`
- **Network Stack:** `lib/afu9-network-stack.ts` (ALB health check config)
- **ECS Stack:** `lib/afu9-ecs-stack.ts` (Container health check config)

---

**Document Owner:** AFU-9 Team  
**Review Cycle:** Quarterly or when health check logic changes  
**Last Updated:** 2025-12-20
