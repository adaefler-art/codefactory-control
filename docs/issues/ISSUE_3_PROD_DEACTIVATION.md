# Issue 3: Kostenreduktion — Prod deaktivieren, Stage-only Betrieb (Fail-Closed)

**Status:** In Progress  
**Priority:** P0  
**Type:** Ops / Cost / Safety  
**Scope:** AFU-9 AWS Infra + Deploy Pipeline + Control Center Guardrails

## Ziel

Laufende AWS-Kosten senken, indem Prod-Services deaktiviert werden und alle Arbeit ausschließlich auf Staging erfolgt, bis explizit wieder freigegeben.

## Problem / Kontext

Aktuell verursachen Prod-Ressourcen laufende Kosten (ECS Services/Tasks, ALB, ggf. RDS/Secrets/Logs). Gleichzeitig findet aktive Entwicklung/Debugging primär auf Stage statt. Es besteht zusätzlich das Risiko, dass versehentlich Prod-Deployments oder Prod-Smoke-Bypass genutzt werden.

## Zielzustand (Outcome)

### Prod "Application Runtime" ist deaktiviert:
- ✅ Keine laufenden ECS Tasks/Services in Prod (DesiredCount=0)
- ✅ Prod ALB liefert eine klare "503 Service Unavailable" Response (fail-closed), ohne Targets
- ✅ Stage bleibt aktiv und ist der einzige operative Pfad für Trial/Debug

### Guardrails verhindern Prod-Aktionen:
- ✅ Deploy/Sync/Runner/Smoke-Bypass sind in Prod blockiert (fail-closed)
- ✅ CI/CD und lokale Deploy-Kommandos enthalten eine Prod-Sperre
- ✅ Control Center API endpoints blockieren Prod-Write-Operationen

### Kosten-Evidence:
- 📊 Vorher/Nachher Messung erforderlich (AWS Cost Explorer)
- 📋 Liste der deaktivierten Ressourcen dokumentiert

## Nicht-Ziele

- Keine Optimierung einzelner AWS-Services im Detail (Reserved Instances, Savings Plans etc.)
- Keine Umstrukturierung der Architektur (nur Abschalten/Guardrails + minimal notwendige Anpassungen)

## Implementation

### A) Prod Runtime abschalten (Minimal, reversibel)

**Existing Infrastructure:**
- ✅ CDK context flag `afu9-prod-paused=true` bereits implementiert
- ✅ ECS Stack setzt `desiredCount=0` wenn `prodPausedFlag=true` (siehe `bin/codefactory-control.ts:178`)
- ✅ Scripts `pause-prod.ps1` und `resume-prod.ps1` vorhanden

**Activation:**
```powershell
# Pause PROD (sets desiredCount=0)
.\scripts\pause-prod.ps1

# Or manual CDK deploy
cdk deploy Afu9EcsProdStack Afu9RoutingStack -c afu9-prod-paused=true -c afu9-multi-env=true
```

**Verification:**
```powershell
# Check ECS service desired count
aws ecs describe-services `
  --cluster afu9-cluster `
  --services afu9-control-center-prod `
  --query 'services[0].[desiredCount,runningCount]' `
  --output json

# Expected: [0, 0]
```

### B) Prod Traffic fail-closed

**Existing Infrastructure:**
- ✅ Routing Stack bereits konfiguriert für `prodPaused` mode
- ✅ ALB Listener Rules return 503 Fixed Response wenn prod pausiert (siehe `lib/afu9-routing-stack.ts:122-133`)

**Message returned:**
```
503 Service Unavailable
Production environment is currently paused (Low-Cost Mode). Please contact support.
```

**Verification:**
```bash
# Test PROD endpoint
curl -I https://prod.afu-9.com
# Expected: HTTP/1.1 503 Service Unavailable

# Verify STAGE still works
curl -I https://stage.afu-9.com
# Expected: HTTP/1.1 200 OK
```

### C) Deploy Guardrail: Stage-only

**New Implementation Required:**

1. **Environment Variable: ENABLE_PROD**
   - Add `ENABLE_PROD` flag to control prod access at application level
   - Default: `false` (fail-closed)
   - When `false`: all prod deployments and write operations blocked

2. **Deploy Context Guardrail Enhancement**
   - Update `scripts/deploy-context-guardrail.ts`
   - Check `ENABLE_PROD` environment variable
   - Block prod deployments when disabled
   - Exit code 1 with clear error message

3. **GitHub Actions Workflow Guards**
   - Update workflows to check `ENABLE_PROD` variable
   - Add explicit prod-disabled checks before deploys
   - Fail early with clear messaging

4. **Control Center API Guardrails**
   - Add prod-disabled check to write endpoints:
     - `/api/ops/sync/*`
     - `/api/playbooks/*/run`
     - `/api/integrations/github/smoke`
     - Any other state-modifying endpoints in prod
   - Return 403 Forbidden with message: "Production environment is disabled"

5. **Readiness Endpoint Enhancement**
   - Update `/api/ready` to report `ready=false` when in prod and ENABLE_PROD=false
   - Include reason: "prod-disabled"

### D) Dokumentation + Runbook

**Existing Documentation:**
- ✅ `docs/runbooks/LOW_COST_MODE.md` - Comprehensive runbook for pause/resume operations

**Additional Documentation:**
- 📝 This document (ISSUE_3_PROD_DEACTIVATION.md)
- 📝 Update `.env.example` with ENABLE_PROD flag
- 📝 Verification commands below

## Verification Commands

### Prerequisites
```powershell
$Region = "eu-central-1"
$Profile = "codefactory"  # Adjust to your AWS profile
```

### 1) ECS Services in Prod: Desired/Running prüfen
```powershell
# List clusters
aws ecs list-clusters --region $Region --profile $Profile

# Get cluster ARN
$ProdClusterArn = "arn:aws:ecs:${Region}:ACCOUNT_ID:cluster/afu9-cluster"

# List services in cluster
aws ecs list-services --cluster $ProdClusterArn --region $Region --profile $Profile

# Check service details
aws ecs describe-services `
  --cluster $ProdClusterArn `
  --services afu9-control-center-prod `
  --region $Region `
  --profile $Profile `
  --query 'services[0].[serviceName,desiredCount,runningCount,status]' `
  --output table

# Expected output when paused:
# --------------------------------
# |     DescribeServices         |
# +------------------------------+
# |  afu9-control-center-prod   |
# |  0                          |  # desiredCount
# |  0                          |  # runningCount  
# |  ACTIVE                     |  # status
# +------------------------------+
```

### 2) ALB Target Group Health
```powershell
# Get target group ARN
$ProdTgArn = aws elbv2 describe-target-groups `
  --names afu9-tg-prod `
  --region $Region `
  --profile $Profile `
  --query 'TargetGroups[0].TargetGroupArn' `
  --output text

# Check target health (should be empty when paused)
aws elbv2 describe-target-health `
  --target-group-arn $ProdTgArn `
  --region $Region `
  --profile $Profile

# Expected: Empty list (no registered targets)
```

### 3) ALB Listener Rules
```powershell
# Get ALB ARN
$AlbArn = aws elbv2 describe-load-balancers `
  --names afu9-alb `
  --region $Region `
  --profile $Profile `
  --query 'LoadBalancers[0].LoadBalancerArn' `
  --output text

# Get HTTPS listener
$HttpsListenerArn = aws elbv2 describe-listeners `
  --load-balancer-arn $AlbArn `
  --region $Region `
  --profile $Profile `
  --query 'Listeners[?Port==`443`].ListenerArn' `
  --output text

# Check listener rules for prod
aws elbv2 describe-rules `
  --listener-arn $HttpsListenerArn `
  --region $Region `
  --profile $Profile `
  --query 'Rules[?Conditions[?Values[?contains(@,`prod`)]]].Actions' `
  --output json

# Expected: Action type should be "fixed-response" with StatusCode 503
```

### 4) Test Prod Endpoint (from outside AWS)
```powershell
# Test PROD returns 503
curl -I https://prod.afu-9.com
# Expected: HTTP/1.1 503 Service Unavailable

# Verify response body
curl https://prod.afu-9.com
# Expected: "Production environment is currently paused (Low-Cost Mode). Please contact support."
```

### 5) Test Stage Still Works
```powershell
# Test STAGE returns 200
curl -I https://stage.afu-9.com
# Expected: HTTP/1.1 200 OK

# Test health endpoint
curl https://stage.afu-9.com/api/health
# Expected: {"status":"healthy",...}
```

### 6) Deploy Guardrail Test
```powershell
# Set ENABLE_PROD=false
$env:ENABLE_PROD = "false"

# Try to deploy to prod (should fail)
npm run validate:diff -- Afu9EcsProdStack -c environment=production -c afu9-multi-env=true

# Expected: Exit code 1 with error message about prod being disabled
```

### 7) Cost Verification
```powershell
# Check AWS Cost Explorer for cost reduction
# Navigate to: https://console.aws.amazon.com/cost-management/home#/cost-explorer

# Check ECS running tasks cost
aws ce get-cost-and-usage `
  --time-period Start=2025-01-01,End=2025-01-31 `
  --granularity MONTHLY `
  --metrics UnblendedCost `
  --filter file://cost-filter.json `
  --region us-east-1 `
  --profile $Profile

# cost-filter.json:
# {
#   "Dimensions": {
#     "Key": "SERVICE",
#     "Values": ["Amazon Elastic Container Service"]
#   }
# }
```

## Re-enable Procedure (Future)

When ready to re-enable production:

1. **Set ENABLE_PROD=true** in environment/secrets
2. **Resume PROD ECS service:**
   ```powershell
   .\scripts\resume-prod.ps1
   ```
3. **Verify prod deployment:**
   ```powershell
   curl https://prod.afu-9.com/api/health
   # Expected: {"status":"healthy"}
   ```
4. **Update documentation** to reflect prod is active

## Implementation Checklist

- [x] A) Verify existing CDK implementation for prod pause
  - [x] Confirmed `afu9-prod-paused` flag in CDK
  - [x] Confirmed ECS desiredCount=0 logic
  - [x] Confirmed ALB 503 response logic
- [ ] B) Test pause mode deployment
  - [ ] Run `pause-prod.ps1` script
  - [ ] Verify ECS tasks stopped
  - [ ] Verify ALB returns 503
- [ ] C) Implement Deploy Guardrails
  - [ ] Add ENABLE_PROD environment variable
  - [ ] Update deploy-context-guardrail.ts
  - [ ] Add workflow guards
  - [ ] Add Control Center API guards
- [ ] D) Update Documentation
  - [ ] Update .env.example
  - [ ] Create runbook sections
  - [ ] Add verification commands
- [ ] E) Testing & Verification
  - [ ] Test all verification commands
  - [ ] Verify stage remains operational
  - [ ] Run repo:verify
  - [ ] Run control-center tests
- [ ] F) Final Review
  - [ ] Code review
  - [ ] Security scan
  - [ ] Cost analysis

## Notes

- Infrastructure already supports pause mode via existing CDK implementation
- Focus on adding guardrails to prevent accidental prod access
- All changes must be reversible
- No changes to database or network infrastructure
- Stage environment must remain fully operational throughout

## References

- [LOW_COST_MODE.md](../runbooks/LOW_COST_MODE.md) - Existing runbook for pause/resume
- [deploy-context-guardrail.ts](../../scripts/deploy-context-guardrail.ts) - Deploy validation
- [afu9-routing-stack.ts](../../lib/afu9-routing-stack.ts) - ALB routing logic
- [afu9-ecs-stack.ts](../../lib/afu9-ecs-stack.ts) - ECS service configuration
