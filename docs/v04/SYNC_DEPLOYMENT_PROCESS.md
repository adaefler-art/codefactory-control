# AFU-9 Synchronization und Deployment-Prozess

## Übersicht

Dieses Dokument beschreibt den standardisierten Prozess für die Synchronisation mit `origin/main` und das sichere Deployment von AFU-9 Services. Der Prozess gewährleistet Datenverlustfreiheit, Auditierbarkeit und minimale Ausfallzeiten.

## Ziele

- **Sicher**: Keine Datenverluste bei Sync/Merge-Operationen
- **Deterministisch**: Reproduzierbare Ergebnisse
- **Auditierbar**: Alle Schritte sind nachvollziehbar und geloggt
- **Automatisiert**: Wo möglich, Automation nutzen

---

## 1. Synchronisierung mit origin/main

### 1.1 Voraussetzungen

- Alle lokalen Änderungen sind committed
- Arbeitskopie ist sauber (`git status` zeigt keine uncommitted changes)
- Alle Tests laufen erfolgreich lokal

### 1.2 Sync-Prozess (Development Branches)

```bash
# 1. Status prüfen
git status
# Sollte "working tree clean" zeigen

# 2. Alle lokalen Branches anzeigen
git branch -vv

# 3. Remote-Updates holen (ohne merge)
git fetch origin

# 4. Vergleich mit origin/main anzeigen
git log --oneline HEAD..origin/main
git diff HEAD..origin/main

# 5. Aktuellen Branch mit origin/main synchronisieren
git pull origin main --rebase

# ODER für Feature-Branches mit Merge:
git pull origin main --no-rebase

# 6. Bei Konflikten:
# - Konflikte manuell lösen
# - git add <resolved-files>
# - git rebase --continue (bei rebase)
# - git commit (bei merge)

# 7. Verifizierung
npm run build        # Build erfolgreich?
npm test            # Tests erfolgreich?
git log --oneline -5 # Commits sehen korrekt aus?

# 8. Push (falls erforderlich)
git push origin <branch-name>
```

### 1.3 Sync-Prozess (Main Branch)

**⚠️ WICHTIG**: Direkte Pushes zu `main` sollten vermieden werden. Nutze Pull Requests.

```bash
# Nur für Maintainer mit entsprechenden Rechten

# 1. Lokalen main aktualisieren
git checkout main
git pull origin main

# 2. Verifizierung
npm install
npm run build
npm test

# 3. Bei Problemen: Rollback
git reset --hard origin/main
```

### 1.4 Automatische Sync-Checks (CI)

GitHub Actions prüft automatisch:
- Branch ist aktuell mit `main`
- Build funktioniert
- Alle Tests bestehen
- Keine Merge-Konflikte

**Siehe**: `.github/workflows/sync-check.yml` (wird erstellt)

---

## 2. Pre-Deployment Checks

Vor jedem Deployment müssen folgende Checks erfolgreich sein:

### 2.1 Code-Qualität

```bash
# Linting
npm run lint        # Control Center
cd mcp-servers/github && npm run build
cd ../deploy && npm run build
cd ../observability && npm run build

# Type Checking
npx tsc --noEmit
```

### 2.2 Tests

```bash
# Unit Tests
npm test

# Integration Tests (wenn vorhanden)
npm run test:integration
```

### 2.3 Health Check Tests

```bash
# Lokale Smoke Tests
./scripts/smoke-test-local.sh

# Erwartet: Alle Services antworten mit 200 OK
```

### 2.4 Security Scan

```bash
# Dependency Vulnerabilities
npm audit

# Secret Detection
git secrets --scan

# SAST (Static Application Security Testing)
# Wird automatisch in CI durchgeführt
```

---

## 3. Deployment-Prozess

### 3.1 Staging Deployment

```bash
# 1. Branch ist synchronized mit main
git pull origin main

# 2. Docker Images bauen
docker build -t afu9/control-center:staging -f control-center/Dockerfile .
docker build -t afu9/mcp-github:staging -f mcp-servers/github/Dockerfile .
docker build -t afu9/mcp-deploy:staging -f mcp-servers/deploy/Dockerfile .
docker build -t afu9/mcp-observability:staging -f mcp-servers/observability/Dockerfile .

# 3. Images zu ECR pushen
./scripts/push-to-ecr.sh staging

# 4. CDK Deployment
npx cdk deploy Afu9EcsStack \
  --context environment=staging \
  --require-approval never

# 5. Deployment verifizieren
./scripts/verify-deployment.sh staging

# 6. Health Checks durchführen
./scripts/health-check.sh staging

# 7. Smoke Tests
./scripts/smoke-test-staging.sh
```

### 3.2 Production Deployment

**⚠️ Nur nach erfolgreichem Staging-Test!**

```bash
# 1. Tag erstellen für Versionierung (MANUAL STEP)
# NOTE: Do not assume the v0.4.0 tag already exists.
# Create and push annotated tag v0.4.0 on commit 22cdb6a41c42366ad165a0fb4c96282304f6f7ae as a manual step (git tag -a ...; git push origin v0.4.0).
git tag -a v0.4.0 22cdb6a41c42366ad165a0fb4c96282304f6f7ae -m "Release v0.4.0"
git push origin v0.4.0

# 2. Docker Images mit Versions-Tag bauen
docker build -t afu9/control-center:v0.4.0 -f control-center/Dockerfile .
docker build -t afu9/mcp-github:v0.4.0 -f mcp-servers/github/Dockerfile .
docker build -t afu9/mcp-deploy:v0.4.0 -f mcp-servers/deploy/Dockerfile .
docker build -t afu9/mcp-observability:v0.4.0 -f mcp-servers/observability/Dockerfile .

# 3. Images zu ECR pushen
./scripts/push-to-ecr.sh production v0.4.0

# 4. Pre-Production Backup
./scripts/backup-rds.sh production

# 5. CDK Deployment mit Confirmation
npx cdk deploy Afu9EcsStack \
  --context environment=production \
  --require-approval always

# 6. Post-Deployment Verification
./scripts/verify-deployment.sh production

# 7. Health Checks (mit Retry-Logic)
./scripts/health-check.sh production --wait 300

# 8. Smoke Tests
./scripts/smoke-test-production.sh

# 9. Monitoring prüfen
# - CloudWatch Alarms checken
# - Dashboard verifizieren
# - Logs durchsehen

# 10. Rollback bei Problemen
# ./scripts/rollback.sh production <previous-version>
```

### 3.3 Rollback-Prozess

```bash
#!/bin/bash
# scripts/rollback.sh

ENVIRONMENT=$1  # staging oder production
PREVIOUS_VERSION=$2  # z.B. v0.2.4

echo "Rolling back $ENVIRONMENT to $PREVIOUS_VERSION..."

# 1. ECS Service auf vorherige Task Definition zurücksetzen
aws ecs update-service \
  --cluster afu9-${ENVIRONMENT} \
  --service control-center \
  --task-definition afu9-control-center:${PREVIOUS_VERSION} \
  --force-new-deployment

# 2. Deployment überwachen
aws ecs wait services-stable \
  --cluster afu9-${ENVIRONMENT} \
  --services control-center

# 3. Health Check
./scripts/health-check.sh $ENVIRONMENT

# 4. Bei Erfolg: Commit und dokumentieren
echo "Rollback erfolgreich. Dokumentiere in ../releases/CHANGELOG.md"
```

---

## 4. Deployment Validation Scripts

### 4.1 Health Check Script

```bash
#!/bin/bash
# scripts/health-check.sh

ENVIRONMENT=$1
WAIT_TIME=${2:-60}  # Default 60 Sekunden

if [ "$ENVIRONMENT" == "staging" ]; then
  ALB_DNS="afu9-staging-alb-123456.eu-central-1.elb.amazonaws.com"
elif [ "$ENVIRONMENT" == "production" ]; then
  ALB_DNS="afu9.example.com"
else
  echo "Usage: $0 {staging|production} [wait-time]"
  exit 1
fi

echo "Waiting ${WAIT_TIME}s for services to stabilize..."
sleep $WAIT_TIME

# Health Check: Control Center
echo "Checking Control Center health..."
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "https://${ALB_DNS}/api/health")
if [ "$RESPONSE" != "200" ]; then
  echo "❌ Control Center health check failed: HTTP $RESPONSE"
  exit 1
fi
echo "✅ Control Center is healthy"

# Readiness Check: Control Center
echo "Checking Control Center readiness..."
RESPONSE=$(curl -s "https://${ALB_DNS}/api/ready")
READY=$(echo "$RESPONSE" | jq -r '.ready')
if [ "$READY" != "true" ]; then
  echo "❌ Control Center not ready"
  echo "$RESPONSE" | jq .
  exit 1
fi
echo "✅ Control Center is ready"

# Check MCP Servers (via Control Center)
echo "Checking MCP servers..."
MCP_STATUS=$(curl -s "https://${ALB_DNS}/api/mcp/health")
ALL_HEALTHY=$(echo "$MCP_STATUS" | jq -r '.status')
if [ "$ALL_HEALTHY" != "healthy" ]; then
  echo "❌ MCP servers not healthy"
  echo "$MCP_STATUS" | jq .
  exit 1
fi
echo "✅ All MCP servers are healthy"

echo "✅ All health checks passed!"
```

### 4.2 Smoke Test Script

```bash
#!/bin/bash
# scripts/smoke-test-production.sh

ALB_DNS="afu9.example.com"
FAILED=0

echo "=== AFU-9 Production Smoke Tests ==="

# Test 1: Homepage erreichbar
echo "Test 1: Homepage..."
if curl -sf "https://${ALB_DNS}" > /dev/null; then
  echo "✅ Homepage accessible"
else
  echo "❌ Homepage not accessible"
  FAILED=$((FAILED + 1))
fi

# Test 2: API Health
echo "Test 2: API Health..."
HEALTH=$(curl -s "https://${ALB_DNS}/api/health" | jq -r '.status')
if [ "$HEALTH" == "ok" ]; then
  echo "✅ API Health OK"
else
  echo "❌ API Health failed"
  FAILED=$((FAILED + 1))
fi

# Test 3: API Readiness
echo "Test 3: API Readiness..."
READY=$(curl -s "https://${ALB_DNS}/api/ready" | jq -r '.ready')
if [ "$READY" == "true" ]; then
  echo "✅ API Ready"
else
  echo "❌ API not ready"
  FAILED=$((FAILED + 1))
fi

# Test 4: MCP Servers
echo "Test 4: MCP Servers Health..."
MCP_HEALTH=$(curl -s "https://${ALB_DNS}/api/mcp/health" | jq -r '.status')
if [ "$MCP_HEALTH" == "healthy" ]; then
  echo "✅ MCP Servers healthy"
else
  echo "❌ MCP Servers not healthy"
  FAILED=$((FAILED + 1))
fi

# Test 5: Workflow List API
echo "Test 5: Workflow API..."
WORKFLOWS=$(curl -s "https://${ALB_DNS}/api/workflows" -H "Authorization: Bearer $API_TOKEN")
if echo "$WORKFLOWS" | jq -e '.workflows' > /dev/null 2>&1; then
  echo "✅ Workflow API working"
else
  echo "❌ Workflow API failed"
  FAILED=$((FAILED + 1))
fi

# Summary
echo ""
echo "=== Smoke Test Summary ==="
if [ $FAILED -eq 0 ]; then
  echo "✅ All smoke tests passed!"
  exit 0
else
  echo "❌ $FAILED test(s) failed"
  exit 1
fi
```

---

## 5. Monitoring während Deployment

### 5.1 CloudWatch Metrics überwachen

```bash
# ECS Service Deployment überwachen
aws ecs describe-services \
  --cluster afu9-production \
  --services control-center \
  --query 'services[0].events[0:5]'

# ALB 5xx Errors
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name HTTPCode_Target_5XX_Count \
  --dimensions Name=LoadBalancer,Value=app/afu9-production-alb/123456 \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

### 5.2 CloudWatch Logs Live-Tracking

```bash
# Control Center Logs
aws logs tail /aws/ecs/afu9-production/control-center --follow

# MCP Server Logs
aws logs tail /aws/ecs/afu9-production/mcp-github --follow
```

### 5.3 Alarm-Status prüfen

```bash
# Alle aktiven Alarms
aws cloudwatch describe-alarms \
  --state-value ALARM \
  --query 'MetricAlarms[*].[AlarmName,StateValue,StateReason]'
```

---

## 6. Deployment Checklist

### Pre-Deployment

- [ ] Code synchronized mit `origin/main`
- [ ] Alle Tests bestanden
- [ ] Linting erfolgreich
- [ ] Security Scan durchgeführt
- [ ] Docker Images gebaut und getestet
- [ ] Staging Deployment erfolgreich
- [ ] Smoke Tests auf Staging bestanden
- [ ] Backup erstellt (Production only)
- [ ] Deployment-Zeitfenster geplant (Production only)
- [ ] Stakeholder informiert (Production only)

### During Deployment

- [ ] CDK Deploy gestartet
- [ ] CloudFormation Stack Update läuft
- [ ] ECS Tasks werden neu gestartet
- [ ] Health Checks passieren
- [ ] Alte Tasks werden terminiert
- [ ] Keine 5xx Errors im ALB
- [ ] CloudWatch Alarms sind OK

### Post-Deployment

- [ ] Health Checks bestanden
- [ ] Smoke Tests bestanden
- [ ] Monitoring Dashboard überprüft
- [ ] CloudWatch Logs durchgesehen
- [ ] Keine Alarms aktiv
- [ ] Dokumentation aktualisiert
- [ ] Git Tag v0.4.0 erstellt & gepusht (Production only)
- [ ] ../releases/CHANGELOG.md aktualisiert
- [ ] Stakeholder informiert (Production only)

### Rollback (bei Problemen)

- [ ] Rollback-Script ausgeführt
- [ ] Previous Version deployed
- [ ] Health Checks nach Rollback bestanden
- [ ] Incident dokumentiert
- [ ] Post-Mortem geplant

---

## 7. KPIs und Metriken

### Factory Uptime

**Messung**: CloudWatch Metric `FactoryAvailability`

```typescript
// In Control Center: Emit metric nach jedem Health Check
const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
await cloudwatch.send(new PutMetricDataCommand({
  Namespace: 'AFU9/Factory',
  MetricData: [{
    MetricName: 'Availability',
    Value: allServicesHealthy ? 1 : 0,
    Unit: 'None',
    Timestamp: new Date(),
  }]
}));
```

**Dashboard**: Query für Uptime-Berechnung

```sql
SELECT 
  AVG(Availability) * 100 as UptimePercent,
  COUNT(*) as TotalChecks,
  SUM(Availability) as HealthyChecks
FROM AFU9/Factory/Availability
WHERE time > now() - 30d
```

### MTTR (Mean Time To Recovery)

**Messung**: Via Incident-Logs

```json
{
  "incident_id": "inc-123",
  "start_time": "2025-12-16T10:00:00Z",
  "detection_time": "2025-12-16T10:01:30Z",
  "recovery_time": "2025-12-16T10:12:00Z",
  "mttr_seconds": 630
}
```

**CloudWatch Insights Query**:

```sql
fields @timestamp, incident_id, mttr_seconds
| filter @logStream like /incidents/
| stats avg(mttr_seconds) as AvgMTTR, max(mttr_seconds) as MaxMTTR
```

---

## 8. Troubleshooting

### Problem: Deployment hängt

**Symptome**: ECS Tasks starten nicht, bleiben in PENDING

**Lösungen**:
1. Check ECS Cluster Capacity: `aws ecs describe-clusters`
2. Check Security Groups: Ports 3000-3003 offen?
3. Check ECR Image Pull: IAM-Rolle korrekt?
4. Check Logs: `aws logs tail /aws/ecs/...`

### Problem: Health Checks schlagen fehl

**Symptome**: ALB markiert Targets als unhealthy

**Lösungen**:
1. Check Health Endpoint: `curl http://container-ip:3000/api/health`
2. Check Dependencies: Ist RDS erreichbar? GitHub API erreichbar?
3. Check Security Groups: Inbound Rules korrekt?
4. Check Logs: Fehler im Service-Log?

### Problem: Deployment erfolgreich, aber Service instabil

**Symptome**: Intermittierende 5xx Errors

**Lösungen**:
1. Check Resource Limits: CPU/Memory Limits zu niedrig?
2. Check Connection Pools: DB Connections erschöpft?
3. Check Rate Limits: GitHub API Rate Limit erreicht?
4. Rollback und Post-Mortem

---

## Siehe auch

- [Control Plane Specification](./CONTROL_PLANE_SPEC.md)
- [AWS Deployment Runbook](./AWS_DEPLOY_RUNBOOK.md)
- [Observability Guide](./OBSERVABILITY.md)
- [Alerting Setup](./ALERTING.md)
