# AFU-9 Runtime Policy & Service Auth (Single Source of Truth)

**Status:** NON-NEGOTIABLE POLICY

This document is the single source of truth for:
1) AFU-9 runtime infrastructure policy (cluster, prod/staging, guardrails)
2) AFU-9 UI ↔ Engine ↔ Control-Center service auth (headers, secrets)

Any other document that conflicts with this policy is **obsolete** and must be updated or marked as such.

---

## Part A — Runtime Infrastructure Policy (Binding)

### Non-Negotiable Policy

- **Single ECS Cluster:** `afu9-cluster` (eu-central-1)
  - **No** `afu9-cluster-staging` exists or may be created without an explicit architecture decision.
- **Services:**
  - **Prod:** `afu9-control-center` → **desiredCount = 0** (permanently offline)
  - **Staging:** `afu9-control-center-staging` → **desiredCount = 1**

### Guardrails (Fail-Closed)

#### CI/CD
- Default deploy target = **staging**
- Production deploys require **both**:
  - `allow_prod=true` (workflow input)
  - `ALLOW_PROD=true` (guardrail environment)

#### IAM (Recommended / Partial)
- **Explicit Deny** on Prod service ARN for:
  - `ecs:UpdateService`, `ecs:CreateService`, `ecs:DeleteService`
- Exception only via **Break-Glass** role

### Anti-Patterns (Explicitly Forbidden)

- Starting Prod service (setting desiredCount > 0)
- Creating a second cluster (e.g., `afu9-cluster-staging`)
- Deploying to Prod without explicit allow flags

### Operational Checks

```bash
# Prod must remain offline
aws ecs describe-services --region eu-central-1 --cluster afu9-cluster \
  --services afu9-control-center \
  --query 'services[0].[desiredCount,runningCount]'

# Staging must be running
aws ecs describe-services --region eu-central-1 --cluster afu9-cluster \
  --services afu9-control-center-staging \
  --query 'services[0].[desiredCount,runningCount]'
```

---

## Part B — Engine ↔ Control-Center Service Auth (Critical)

### Data Flow

UI (Next.js) → **codefactory-engine** (Vercel) → **Control-Center** (`stage.afu-9.com`)

### Auth Contract (Binding)

- **Header name:** `x-afu9-service-token`
- **Sender (Engine):**
  - Env var: `CONTROL_CENTER_SERVICE_TOKEN`
  - **Environment:** Vercel **Production** (codefactory-engine.vercel.app)
- **Receiver (Control-Center):**
  - Env var: `SERVICE_READ_TOKEN`
  - Source: AWS Secrets Manager secret injected into ECS task
  - **Staging Secret ARN (source of truth):**
    `arn:aws:secretsmanager:eu-central-1:313095875771:secret:afu9/stage/service-read-token-goVMWD`

### 🔴 Known Trap (Most Frequent Failure)

`SERVICE_READ_TOKEN` **must be a plain SecretString**.

If the SecretString is JSON (e.g. `{"SERVICE_READ_TOKEN":"..."}`):
- ECS injects the **entire JSON string**
- Control-Center compares against JSON
- Engine sends plain token → **403 service token rejected**

### Fix Procedure (Binding)

1) Set Secrets Manager value to **plain string** (no JSON)
2) Force ECS deployment:
   ```bash
   aws ecs update-service --region eu-central-1 --cluster afu9-cluster \
     --service afu9-control-center-staging --force-new-deployment
   ```
3) Set Vercel `CONTROL_CENTER_SERVICE_TOKEN` (Production) to the **same plain value**
4) Redeploy codefactory-engine

### Verification (Direct Proof)

```bash
curl -i https://stage.afu-9.com/api/afu9/issues \
  -H "x-afu9-service-token: <TOKEN>"
# Expect 200 OK
```

---

## Part C — Drift & Recovery Checklist

**If issues list fails (403 / upstream_auth_rejected):**
1) Confirm header name: `x-afu9-service-token`
2) Confirm Vercel **Production** env var `CONTROL_CENTER_SERVICE_TOKEN`
3) Confirm Secrets Manager SecretString is **plain** (not JSON)
4) Force ECS redeploy
5) Redeploy codefactory-engine

**If prod starts unexpectedly:**
1) Set desiredCount=0 immediately
2) Verify IAM explicit deny on prod service ARN
3) Confirm allow_prod/ALLOW_PROD are false

---

## Document Governance

This document is the **canonical runtime policy**. Any other document that conflicts must be marked **OBSOLETE** with a link here.