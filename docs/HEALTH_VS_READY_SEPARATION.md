# Health vs Ready: Liveness vs Readiness Separation

**Issue-ID:** I-04-01-HEALTH-READY  
**Status:** ✅ IMPLEMENTED  
**Date:** 2025-12-20

## Executive Summary

AFU-9 Control Center implements a clear separation between **liveness** (`/api/health`) and **readiness** (`/api/ready`) probes to ensure:

1. **Deployments are never blocked** by transient dependency issues
2. **Real dependencies are properly validated** before accepting traffic
3. **Clear semantics** for different types of health monitoring

## The Problem

Without proper separation between liveness and readiness:
- **Deployment failures**: Health checks that validate dependencies can block deployments when dependencies are temporarily unavailable
- **Circuit breaker triggers**: ECS circuit breaker activates when health checks fail, causing rollbacks
- **False positives**: A running service can be killed because a downstream dependency is temporarily down

## The Solution

### `/api/health` - Liveness Probe

**Purpose:** Verify that the service process is running and responsive.

**Characteristics:**
- ✅ **ALWAYS returns 200 OK** - Never blocks deployments
- ✅ **No dependency checks** - Only validates the process is alive
- ✅ **Fast response** - Target < 100ms
- ✅ **Simple implementation** - Minimal code paths to reduce failure risk
- ✅ **Used by ECS health checks** - Prevents unnecessary container restarts
- ✅ **Used by ALB target groups** - Keeps healthy instances in rotation

**Implementation Guarantee:**
```typescript
export async function GET() {
  try {
    return NextResponse.json({ status: 'ok', ... }, { status: 200 });
  } catch (error) {
    // Even errors return 200 to prevent deployment blocking
    return NextResponse.json({ status: 'ok', ... }, { status: 200 });
  }
}
```

**When to use:**
- ECS container health checks
- ALB target group health checks
- Basic uptime monitoring
- Liveness probes in orchestration systems

### `/api/ready` - Readiness Probe

**Purpose:** Verify that the service is ready to handle traffic with all required dependencies available.

**Characteristics:**
- ✅ **Returns 200 or 503** based on dependency status
- ✅ **Validates required dependencies** - Database, environment configuration
- ✅ **Monitors optional dependencies** - MCP servers (non-blocking)
- ✅ **Detailed status reporting** - Shows which dependencies failed
- ✅ **Slower response** - Target < 5 seconds (allows dependency checks)
- ✅ **Safe to fail** - Does not trigger deployment rollbacks

**Dependency Classification:**

**Required Dependencies** (block readiness):
- Database connectivity (when `DATABASE_ENABLED=true`)
- Essential environment variables (`NODE_ENV`)

**Optional Dependencies** (monitored but non-blocking):
- MCP GitHub Server
- MCP Deploy Server
- MCP Observability Server

**Implementation:**
```typescript
// Required dependency check - blocks readiness
if (databaseEnabled && !databaseAvailable) {
  return NextResponse.json({ ready: false, ... }, { status: 503 });
}

// Optional dependency check - non-blocking
if (!mcpServerAvailable) {
  // Log and report, but don't fail readiness
  checks['mcp-server'] = { status: 'error', ... };
}
```

**When to use:**
- Pre-deployment validation
- Load balancer readiness checks (if supported separately from health)
- Manual service status verification
- Debugging dependency issues
- Readiness probes in orchestration systems

## Deployment Configuration

### ECS Task Definition Health Check

ECS containers use `/api/health` for liveness checks:

```json
{
  "healthCheck": {
    "command": [
      "CMD-SHELL",
      "node -e \"require('http').get('http://127.0.0.1:3000/api/health', r => { if (r.statusCode === 200) process.exit(0); process.exit(1); }).on('error', () => process.exit(1));\""
    ],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

**Why `/api/health`?**
- If dependencies fail, container stays running (no unnecessary restarts)
- Deployment can proceed even if database is temporarily unavailable
- ECS circuit breaker won't trigger on dependency issues

### ALB Target Group Health Check

Application Load Balancer uses `/api/health` for target health:

```typescript
{
  healthCheck: {
    enabled: true,
    path: '/api/health',  // Liveness - not /api/ready!
    protocol: 'HTTP',
    port: 'traffic-port',
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
    matcher: { httpCode: '200' }
  }
}
```

**Why `/api/health`?**
- Healthy container stays in load balancer rotation
- Transient dependency issues don't remove healthy instances
- Traffic can still be served while dependencies recover

## Acceptance Criteria Verification

### ✅ Health blockiert keine Deploys

**Evidence:**
1. `/api/health` ALWAYS returns 200 OK
2. Try-catch ensures no exceptions cause non-200 responses
3. No dependency checks that could fail
4. ECS health checks use `/api/health` - never blocks deployment
5. Test suite validates this behavior:

```typescript
test('/api/health ALWAYS returns 200', async () => {
  const response = await healthHandler();
  expect(response.status).toBe(200);
});
```

### ✅ Ready spiegelt echte Abhängigkeiten

**Evidence:**
1. Database connectivity validated (when enabled)
2. Environment variables checked
3. MCP servers monitored (as optional dependencies)
4. Detailed status per dependency in response
5. Test suite validates dependency reflection:

```typescript
test('/api/ready returns 503 when DATABASE_ENABLED=true but secrets missing', async () => {
  process.env.DATABASE_ENABLED = 'true';
  const response = await readyHandler();
  expect(response.status).toBe(503);
  expect(body.checks.database.status).toBe('error');
});
```

### ✅ Dokumentierte Bedeutung

**Evidence:**
1. This document clearly explains both endpoints
2. Inline code documentation in both route handlers
3. CONTROL_PLANE_SPEC.md defines standard
4. Test suite documents behavior through examples
5. ECS/ALB configuration documented with rationale

## Testing

### Automated Tests

Location: `control-center/__tests__/api/health-contract.test.ts`

**Health Endpoint Tests:**
- ✅ Always returns 200 OK
- ✅ Has consistent response structure
- ✅ Never includes error fields

**Ready Endpoint Tests:**
- ✅ Returns 200 when all required dependencies available
- ✅ Returns 503 when required dependencies missing
- ✅ Identifies missing credentials correctly
- ✅ Validates database configuration
- ✅ Does NOT fail on MCP server unavailability (optional dependencies)

**Semantic Separation Tests:**
- ✅ Health is always healthy, ready can be not ready
- ✅ Health has no dependency checks, ready has dependency checks

### Manual Testing

```bash
# Test health endpoint (should ALWAYS return 200)
curl http://localhost:3000/api/health

# Expected response:
{
  "status": "ok",
  "service": "afu9-control-center",
  "version": "0.2.5",
  "timestamp": "2025-12-20T..."
}

# Test ready endpoint with dependencies disabled
DATABASE_ENABLED=false curl http://localhost:3000/api/ready

# Expected: 200 OK with database status "not_configured"

# Test ready endpoint with dependencies enabled but missing
DATABASE_ENABLED=true curl http://localhost:3000/api/ready

# Expected: 503 Service Unavailable with database error details
```

## Operational Guidelines

### When to Use Each Endpoint

| Scenario | Endpoint | Rationale |
|----------|----------|-----------|
| ECS container health checks | `/api/health` | Prevent unnecessary restarts |
| ALB target group health | `/api/health` | Keep healthy instances in rotation |
| Pre-deployment validation | `/api/ready` | Verify all dependencies available |
| Debugging issues | `/api/ready` | See detailed dependency status |
| Uptime monitoring | `/api/health` | Basic availability |
| Capacity planning | `/api/ready` | Understand dependency load |

### Interpreting Responses

**`/api/health` returns 200:**
- ✅ Service process is running
- ✅ Container is healthy
- ✅ Basic functionality available
- ⚠️ Dependencies may or may not be available

**`/api/ready` returns 200:**
- ✅ Service process is running
- ✅ All required dependencies available
- ✅ Service is fully operational
- ✅ Safe to send production traffic

**`/api/ready` returns 503:**
- ⚠️ Service process is running (health still 200)
- ❌ One or more required dependencies unavailable
- ⚠️ Service may have degraded functionality
- 🔍 Check response body for dependency details

## Best Practices

### DO:
- ✅ Use `/api/health` for ECS and ALB health checks
- ✅ Use `/api/ready` for pre-deployment validation
- ✅ Monitor both endpoints in production
- ✅ Classify dependencies as required vs optional
- ✅ Keep health checks simple and fast
- ✅ Make readiness checks comprehensive

### DON'T:
- ❌ Use `/api/ready` for ECS/ALB health checks
- ❌ Add dependency checks to `/api/health`
- ❌ Mark all dependencies as required in `/api/ready`
- ❌ Return non-200 from `/api/health` under any circumstances
- ❌ Cache readiness check results (dependencies change)
- ❌ Ignore 503 responses from `/api/ready`

## Migration Guide

If you have existing health checks using `/api/ready`:

1. **Identify usage context:**
   - If it's an ECS health check → Change to `/api/health`
   - If it's an ALB target group → Change to `/api/health`
   - If it's for deployment validation → Keep `/api/ready`

2. **Update configuration:**
   ```typescript
   // Before
   healthCheck: { path: '/api/ready' }
   
   // After
   healthCheck: { path: '/api/health' }
   ```

3. **Verify behavior:**
   - Check that deployments succeed even with transient dependency issues
   - Verify containers don't restart unnecessarily
   - Monitor both endpoints in production

## Related Documentation

- [Control Plane Specification v1](./CONTROL_PLANE_SPEC.md) - Full spec for all AFU-9 services
- [Health & Readiness Verification](./HEALTH_READINESS_VERIFICATION.md) - Implementation verification
- [ECS Deployment Guide](./ECS-DEPLOYMENT.md) - Deployment procedures
- [ECS Health Check Runbook](./runbooks/ecs-healthchecks.md) - Troubleshooting guide

## Conclusion

The clear separation between `/api/health` (liveness) and `/api/ready` (readiness) ensures:

1. **Deployments never block** due to transient dependency issues
2. **Real dependencies are validated** before accepting traffic
3. **Clear semantics** enable proper monitoring and debugging
4. **Production stability** through appropriate health check usage

This separation is a fundamental operational principle for AFU-9 Control Center and follows Kubernetes-style probe best practices.
