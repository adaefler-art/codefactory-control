# AFU-9 ECS Circuit Breaker: Standardisierte Diagnose

**ID:** I-01-03-ECS-CIRCUIT-DIAG  
**Ziel:** Root-Cause-Identifikation bei ECS Circuit Breaker Events in **unter 10 Minuten**  
**Prinzip:** Keine Trial-and-Error-Fixes – klare Ablaufschritte mit copy-paste-ready Commands

---

## Übersicht

Dieser Runbook standardisiert die Diagnose bei ECS Circuit Breaker Auslösungen. Der Circuit Breaker schützt vor endlosen Deployment-Loops durch Health-Check-Failures. Wenn er auslöst, müssen wir schnell die Root Cause finden.

### Wann verwenden?

- ✅ ECS Service Deployment schlägt fehl
- ✅ Circuit Breaker-Meldung in Service Events
- ✅ Tasks starten nicht oder werden sofort gestoppt
- ✅ Tasks laufen, aber ALB Health Checks schlagen fehl

### Zeit-Budget pro Schritt

| Schritt | Aktion | Zeit |
|---------|--------|------|
| 0 | Quick Setup | 30 Sek |
| 1 | Service Events | 1 Min |
| 2 | Stopped Tasks | 2 Min |
| 3 | Container Logs | 2 Min |
| 4 | Target Health | 1 Min |
| 5 | Root Cause → Fix | 3-4 Min |
| **TOTAL** | | **< 10 Min** |

---

## 0️⃣ Quick Setup (30 Sekunden)

```bash
# Environment-Variablen setzen
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage  # oder afu9-control-center-prod
export NETWORK_STACK_NAME=Afu9NetworkStack
export ECS_STACK_NAME=Afu9EcsStack
export DB_STACK_NAME=Afu9DatabaseStack

# Optional: AWS Profile
# export AWS_PROFILE=codefactory
```

**Alternative: PowerShell-Diagnose-Script (Empfohlen für schnellere Diagnose)**

```bash
# Alle Schritte 1-4 automatisch ausführen
pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME}
```

Das Script zeigt Service Events, Stopped Tasks, Target Health und Log-Zusammenfassungen. Für tiefere Analyse, fahre mit manuellen Schritten fort.

---

## 1️⃣ Service Events prüfen (1 Minute)

**Warum:** Service Events zeigen die unmittelbare Ursache des Circuit Breaker Triggers.

```bash
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:10]' \
  --output table
```

### Interpretation

| Event-Meldung | Bedeutung | Nächster Schritt |
|--------------|-----------|------------------|
| `has reached a steady state` | ✅ Deployment erfolgreich | Kein Problem |
| `failed circuit breaker: tasks failed to start` | ❌ Tasks starten nicht | → Schritt 2 (Exit Codes) |
| `failed circuit breaker: tasks failed ELB health checks` | ⚠️ Tasks laufen, Health Checks schlagen fehl | → Schritt 3 (Logs) + Schritt 4 (Target Health) |
| `unable to place a task` | 🚫 Ressourcen oder Subnets fehlen | → VPC/Subnets/Security Groups prüfen |
| `failed to launch a task with (error ECS...)` | 🔐 Task Definition oder IAM-Problem | → Schritt 5 (IAM/Secrets) |

**Beispiel: Circuit Breaker ausgelöst**

```
(service afu9-control-center-stage) failed circuit breaker: tasks failed to start.
```

→ **Root Cause Kategorie:** Tasks starten nicht  
→ **Aktion:** Weiter zu Schritt 2 für Exit Codes

---

## 2️⃣ Stopped Tasks analysieren (2 Minuten)

**Warum:** Exit Codes und `stoppedReason` zeigen, warum Tasks fehlgeschlagen sind.

### 2.1 Letzte gestoppte Tasks auflisten

```bash
aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --max-items 5 \
  --query 'taskArns' \
  --output text
```

### 2.2 Task-Details anzeigen

```bash
# Task-ARN automatisch holen
TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' \
  --output text)

# Task-Details abrufen
aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].{stoppedReason:stoppedReason,stoppedAt:stoppedAt,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}' \
  --output json | jq .
```

### Interpretation

| stoppedReason | Root Cause | Nächster Schritt |
|--------------|------------|------------------|
| `ResourceInitializationError: unable to pull secrets` | Secret fehlt oder IAM-Berechtigung fehlt | → Abschnitt 5.1 (Secrets) |
| `ResourceInitializationError: unable to retrieve ecr auth token` | ECR-Zugriff fehlgeschlagen | → IAM Task Execution Role prüfen |
| `CannotPullContainerError` | Image existiert nicht in ECR | → ECR Repository & Image Tags prüfen |
| `Essential container in task exited` (exitCode ≠ 0) | App-Fehler beim Start | → Schritt 3 (Container Logs) |
| `Task failed ELB health checks` | App läuft, aber `/api/ready` schlägt fehl | → Schritt 3 + 4 |
| (exitCode = 0, aber Task gestoppt) | Health Check Timeout | → Schritt 4 (Target Health) |

**Beispiel: Secret-Fehler**

```json
{
  "stoppedReason": "ResourceInitializationError: unable to pull secrets or registry auth: execution resource retrieval failed: unable to retrieve secret from asm: service call has been retried 5 time(s): ResourceNotFoundException: Secrets Manager can't find the specified secret.",
  "containers": [
    {
      "name": "control-center",
      "exitCode": null,
      "reason": null
    }
  ]
}
```

→ **Root Cause:** Secret `afu9/database` oder `afu9/github` oder `afu9/llm` fehlt  
→ **Aktion:** Weiter zu Abschnitt 5.1

**Beispiel: App-Crash**

```json
{
  "stoppedReason": "Essential container in task exited",
  "containers": [
    {
      "name": "control-center",
      "exitCode": 1,
      "reason": "Error: Environment variable DATABASE_HOST is not set"
    }
  ]
}
```

→ **Root Cause:** Secret-Key fehlt oder Config-Fehler  
→ **Aktion:** Weiter zu Schritt 3 für Log-Details

---

## 3️⃣ Container Logs prüfen (2 Minuten)

**Warum:** Logs zeigen App-Level Fehler (fehlende Env-Vars, DB-Connection-Errors, etc.).

### 3.1 Logs mit Fehlerfilter abrufen

```bash
# Control Center Logs (letzte 30 Minuten, nur Errors)
aws logs tail /ecs/afu9/control-center \
  --since 30m \
  --filter-pattern "?error ?Error ?ERROR ?exception ?Exception ?fail ?Fail ?FAIL ?fatal ?Fatal ?FATAL" \
  --region ${AWS_REGION} \
  --format short
```

### 3.2 Alternative: Alle Container-Logs

```bash
# Alle Log-Gruppen anzeigen
for LOG_GROUP in /ecs/afu9/control-center /ecs/afu9/mcp-github /ecs/afu9/mcp-deploy /ecs/afu9/mcp-observability; do
  echo "=== $LOG_GROUP ==="
  aws logs tail $LOG_GROUP \
    --since 30m \
    --filter-pattern "?error ?Error ?ERROR" \
    --region ${AWS_REGION} \
    --format short | head -20
done
```

### Interpretation

| Log-Meldung | Root Cause | Fix |
|------------|------------|-----|
| `Environment variable DATABASE_HOST is not set` | Secret-Key fehlt in Secret | → Abschnitt 5.2 (Secret-Struktur) |
| `FATAL: password authentication failed for user "..."` | Falsches Passwort im Secret | → Abschnitt 5.3 (DB Secret) |
| `Error: getaddrinfo ENOTFOUND null` | DATABASE_HOST ist `null` | → Abschnitt 5.2 |
| `connect ECONNREFUSED` oder `ETIMEDOUT` | DB nicht erreichbar | → Security Groups / Network ACLs prüfen |
| `Database not configured but DATABASE_ENABLED=true` | Config-Mismatch | → Abschnitt 5.4 (enableDatabase) |
| `listen EADDRINUSE :::3000` | Port bereits belegt (sollte nicht in ECS passieren) | → Task Definition prüfen |
| `Cannot find module '...'` | Build-Fehler, fehlende Dependencies | → Docker Image neu bauen |

**Beispiel: Fehlende Env-Var**

```
2025-12-19T12:00:00.000Z ERROR Environment variable DATABASE_PORT is not set
    at Object.<anonymous> (/app/lib/db.js:15:11)
    at Module._compile (node:internal/modules/cjs/loader:1369:14)
```

→ **Root Cause:** `afu9/database` Secret hat nicht alle erforderlichen Keys  
→ **Fix:** Abschnitt 5.2 – Secret-Struktur validieren und updaten

---

## 4️⃣ Target Health prüfen (1 Minute)

**Warum:** ALB Target Group Health zeigt, ob Tasks erreichbar sind und `/api/ready` responds.

```bash
# Service-Info holen um Target Group ARN zu finden
TARGET_GROUP_ARN=$(aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].loadBalancers[0].targetGroupArn' \
  --output text)

# Target Health anzeigen
aws elbv2 describe-target-health \
  --target-group-arn ${TARGET_GROUP_ARN} \
  --region ${AWS_REGION} \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}' \
  --output table
```

### Interpretation

| State | Reason | Bedeutung | Nächster Schritt |
|-------|--------|-----------|------------------|
| `healthy` | - | ✅ Alles OK | Kein Problem |
| `initial` | `Elb.RegistrationInProgress` | ⏳ Health Check läuft | Warten (30-60 Sek), dann erneut prüfen |
| `unhealthy` | `Target.FailedHealthChecks` | ❌ `/api/ready` gibt nicht HTTP 200 | → Schritt 3 (Logs) + Abschnitt 5.5 |
| `unhealthy` | `Target.Timeout` | ⏱️ App antwortet nicht innerhalb Timeout | → Health Check Timeout in Target Group prüfen |
| `draining` | - | 🔄 Task wird entfernt | Normal bei Deployment |
| (kein Target) | - | 🚫 Task nicht registriert | → Security Groups zwischen ALB und ECS prüfen |

**Beispiel: Health Check Failure**

```
Target                                  Port    State       Reason                      Description
arn:aws:ecs:eu-central-1:123:task/...  3000    unhealthy   Target.FailedHealthChecks   Health checks failed with these codes: [502]
```

→ **Root Cause:** App gibt nicht HTTP 200 auf `/api/ready` zurück  
→ **Aktion:** Container Logs prüfen, warum `/api/ready` fehlschlägt (Database Connection? Missing Config?)

---

## 5️⃣ Root Cause → Fix (3-4 Minuten)

Basierend auf den vorherigen Schritten, hier die häufigsten Root Causes und ihre Fixes.

---

### 5.1 Secret fehlt komplett

**Symptome:**
- `stoppedReason`: `ResourceInitializationError: unable to pull secrets`
- Logs: Keine (Container startet nicht)

**Diagnose:**

```bash
# Prüfen ob Secrets existieren
for SECRET_NAME in afu9/github afu9/llm afu9/database; do
  echo "=== Checking $SECRET_NAME ==="
  aws secretsmanager describe-secret \
    --secret-id $SECRET_NAME \
    --region ${AWS_REGION} \
    --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
    --output table 2>&1 || echo "❌ Secret nicht gefunden"
  echo ""
done
```

**Fix:**

Siehe spezifische Fixes unten:
- **GitHub Secret:** Abschnitt 5.6
- **LLM Secret:** Abschnitt 5.7
- **Database Secret:** Abschnitt 5.3 (nur wenn `enableDatabase=true`)

---

### 5.2 Secret-Struktur ist inkorrekt

**Symptome:**
- `exitCode`: 1
- Logs: `Environment variable DATABASE_HOST is not set`

**Diagnose:**

```bash
# GitHub Secret prüfen
aws secretsmanager get-secret-value \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'keys'

# Erwartet: ["owner", "repo", "token"]

# Database Secret prüfen (nur wenn enableDatabase=true)
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'keys'

# Erwartet: ["database", "host", "password", "port", "username"]
```

**Fix:** Siehe Abschnitt 5.3 (Database) oder Abschnitt 5.6 (GitHub)

---

### 5.3 Database Secret erstellen/updaten

**Voraussetzung:** `enableDatabase=true` in ECS Stack Config

```bash
# RDS Endpoint dynamisch holen
RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${DB_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbEndpoint`].OutputValue' \
  --output text)

# RDS Master Secret ARN holen (für Credentials)
RDS_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${DB_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbSecretArn`].OutputValue' \
  --output text)

# Credentials aus RDS Secret extrahieren
RDS_CREDENTIALS=$(aws secretsmanager get-secret-value \
  --secret-id ${RDS_SECRET_ARN} \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text)

DB_USERNAME=$(echo $RDS_CREDENTIALS | jq -r '.username')
DB_PASSWORD=$(echo $RDS_CREDENTIALS | jq -r '.password')
DB_NAME=$(echo $RDS_CREDENTIALS | jq -r '.dbname // "afu9"')

# Secret erstellen oder updaten
aws secretsmanager update-secret \
  --secret-id afu9/database \
  --secret-string "{
    \"host\": \"${RDS_ENDPOINT}\",
    \"port\": \"5432\",
    \"database\": \"${DB_NAME}\",
    \"username\": \"${DB_USERNAME}\",
    \"password\": \"${DB_PASSWORD}\"
  }" \
  --region ${AWS_REGION} 2>&1 || \
aws secretsmanager create-secret \
  --name afu9/database \
  --secret-string "{
    \"host\": \"${RDS_ENDPOINT}\",
    \"port\": \"5432\",
    \"database\": \"${DB_NAME}\",
    \"username\": \"${DB_USERNAME}\",
    \"password\": \"${DB_PASSWORD}\"
  }" \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}

# Warten auf Stabilisierung (3-5 Minuten)
echo "⏳ Waiting for service to stabilize..."
aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}

echo "✅ Service stabilized"
```

**Verification:**

```bash
# Task läuft?
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{runningCount:runningCount,desiredCount:desiredCount}'

# Health Check OK?
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name ${NETWORK_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl -s http://${ALB_DNS}/api/ready | jq .
```

**Erwartete Response:**

```json
{
  "ready": true,
  "checks": {
    "service": {"status": "ok"},
    "database": {"status": "ok", "message": "connection_configured"}
  }
}
```

---

### 5.4 Database aktiviert, aber nicht benötigt?

**Symptome:**
- Tasks starten, aber Health Checks schlagen fehl
- Logs: `connect ECONNREFUSED` oder `Database not configured but DATABASE_ENABLED=true`

**Entscheidung:** Wird die Database überhaupt benötigt?

- **Nein, nur Testing/Development** → Database deaktivieren (schnellste Lösung)
- **Ja, Production mit DB** → Abschnitt 5.3 verwenden

**Fix: Database deaktivieren**

```bash
# Option A: Context in cdk.context.json setzen (mit Backup)
cp cdk.context.json cdk.context.json.backup
jq '.context."afu9-enable-database" = false' cdk.context.json.backup > cdk.context.json
git diff cdk.context.json  # Änderung anzeigen

# Option B: Inline Context beim Deploy (empfohlen - keine Dateiänderung nötig)
npx cdk deploy Afu9EcsStack \
  -c afu9-enable-database=false \
  --region ${AWS_REGION}

# Warten auf Deployment
aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}
```

**Verification:**

```bash
# Health Check sollte zeigen: database.status = "not_configured"
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name ${NETWORK_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl -s http://${ALB_DNS}/api/ready | jq .
```

**Erwartete Response:**

```json
{
  "ready": true,
  "checks": {
    "service": {"status": "ok"},
    "database": {"status": "not_configured", "message": "Database disabled in configuration"}
  }
}
```

---

### 5.5 Health Check Endpoint fehlerhaft

**Symptome:**
- Target Health: `unhealthy` mit `Target.FailedHealthChecks`
- Logs zeigen Fehler bei `/api/ready` Request

**Diagnose:**

```bash
# Task IP/Port finden
TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status RUNNING \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' \
  --output text)

TASK_DETAILS=$(aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].attachments[0].details' \
  --output json)

TASK_ENI=$(echo $TASK_DETAILS | jq -r '.[] | select(.name=="networkInterfaceId") | .value')
TASK_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids ${TASK_ENI} \
  --region ${AWS_REGION} \
  --query 'NetworkInterfaces[0].PrivateIpAddress' \
  --output text)

echo "Task IP: ${TASK_IP}"

# Direct Health Check Test (benötigt VPN/Bastion oder Session Manager)
# curl http://${TASK_IP}:3000/api/ready
```

**Häufige Probleme:**
- Database Connection schlägt fehl → Abschnitt 5.3
- Missing Environment Variables → Abschnitt 5.2
- Container healthcheck zu strikt → Siehe `docs/runbooks/ecs-healthchecks.md`

---

### 5.6 GitHub Secret erstellen/updaten

```bash
# GitHub Token: https://github.com/settings/tokens
# Erforderliche Scopes: repo, workflow

aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
    "token": "ghp_YOUR_GITHUB_TOKEN_HERE",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }' \
  --region ${AWS_REGION} 2>&1 || \
aws secretsmanager create-secret \
  --name afu9/github \
  --secret-string '{
    "token": "ghp_YOUR_GITHUB_TOKEN_HERE",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }' \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

---

### 5.7 LLM Secret erstellen/updaten

```bash
aws secretsmanager update-secret \
  --secret-id afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-YOUR_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-YOUR_ANTHROPIC_KEY",
    "deepseek_api_key": "YOUR_DEEPSEEK_KEY"
  }' \
  --region ${AWS_REGION} 2>&1 || \
aws secretsmanager create-secret \
  --name afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-YOUR_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-YOUR_ANTHROPIC_KEY",
    "deepseek_api_key": "YOUR_DEEPSEEK_KEY"
  }' \
  --region ${AWS_REGION}

# Force new deployment
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}
```

---

### 5.8 IAM-Berechtigungen prüfen

**Symptome:**
- `stoppedReason`: `ResourceInitializationError: unable to pull secrets`
- Oder: `AccessDeniedException` in Logs

**Diagnose:**

```bash
# Task Execution Role finden
TASK_EXEC_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${ECS_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
  --output text)

TASK_EXEC_ROLE_NAME=$(echo ${TASK_EXEC_ROLE_ARN} | awk -F'/' '{print $NF}')

echo "Task Execution Role: ${TASK_EXEC_ROLE_NAME}"

# Attached Policies anzeigen
aws iam list-attached-role-policies \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --region ${AWS_REGION} \
  --output table

# Inline Policies anzeigen
aws iam list-role-policies \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --region ${AWS_REGION} \
  --output table
```

**Erwartete Policies:**
- `AmazonECSTaskExecutionRolePolicy` (managed)
- Oder Custom Policy mit:
  - `secretsmanager:GetSecretValue` auf `afu9/*` Secrets
  - `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, etc.

**Fix:** Falls IAM-Policy fehlt, Stack neu deployen:

```bash
npx cdk deploy Afu9EcsStack --region ${AWS_REGION}
```

---

## 🎯 Zusammenfassung: Häufigste Szenarien

### Szenario 1: Database Secret fehlt (enableDatabase=true)

```
Symptome:
- Service Events: failed circuit breaker
- Stopped Tasks: ResourceInitializationError: unable to pull secrets
- Logs: (keine, Container startet nicht)

Fix: Abschnitt 5.3
Zeit: 3-4 Min
```

---

### Szenario 2: Database Secret hat falsche Struktur

```
Symptome:
- Stopped Tasks: Essential container in task exited (exitCode 1)
- Logs: Environment variable DATABASE_PORT is not set

Fix: Abschnitt 5.2 → 5.3
Zeit: 3-4 Min
```

---

### Szenario 3: Database aktiviert, aber nicht benötigt

```
Symptome:
- Stopped Tasks: Task failed ELB health checks
- Logs: Error: connect ECONNREFUSED (DB nicht erreichbar)

Fix: Abschnitt 5.4 (Database deaktivieren)
Zeit: 2-3 Min
```

---

### Szenario 4: Container Image fehlt in ECR

```
Symptome:
- Stopped Tasks: CannotPullContainerError
- Logs: (keine)

Fix:
1. ECR Repositories prüfen: aws ecr describe-repositories --region ${AWS_REGION}
2. Images bauen und pushen: siehe docs/ECS-DEPLOYMENT.md Schritt 7
Zeit: 10-15 Min (Build + Push)
```

---

### Szenario 5: Health Check Timeout

```
Symptome:
- Target Health: unhealthy, Target.Timeout
- Logs: App läuft, aber antwortet langsam

Fix:
1. Health Check Timeout in Target Group erhöhen
2. App-Performance optimieren (DB-Queries, etc.)
Zeit: 5-10 Min
```

---

## 📚 Weiterführende Dokumentation

- **[RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md](../RUNBOOK_ECS_CIRCUIT_BREAKER_SECRETS.md)** - Detaillierte Secret-Diagnose
- **[RUNBOOK_ECS_DEPLOY.md](../RUNBOOK_ECS_DEPLOY.md)** - Vollständige ECS Deployment Diagnostik
- **[ecs-healthchecks.md](./ecs-healthchecks.md)** - Health Check Tuning und False-Negative-Fixes
- **[ECS_CONFIG_REFERENCE.md](../ECS_CONFIG_REFERENCE.md)** - Alle Config-Optionen für ECS Stack
- **[SECRET_VALIDATION.md](../SECRET_VALIDATION.md)** - Secret-Struktur und Validierung
- **[ECS-DEPLOYMENT.md](../ECS-DEPLOYMENT.md)** - Vollständiger Deployment-Guide

---

## 🆘 Eskalation

Falls Root Cause nach 10 Minuten nicht identifiziert:

1. **Vollständige Diagnostik ausführen:**
   ```bash
   pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME} -LogLines 200
   ```

2. **CloudWatch Logs exportieren:**
   ```bash
   aws logs tail /ecs/afu9/control-center \
     --since 1h \
     --region ${AWS_REGION} > ecs-control-center-logs.txt
   ```

3. **GitHub Issue erstellen** mit:
   - Output von Schritt 1 (Service Events)
   - Output von Schritt 2 (Stopped Tasks)
   - Output von Schritt 4 (Target Health)
   - `ecs-control-center-logs.txt`
   - Output von `pwsh scripts/ecs_debug.ps1`

4. **Rollback erwägen:**
   ```bash
   # Vorherige Task Definition Revision deployen
   aws ecs update-service \
     --cluster ${CLUSTER_NAME} \
     --service ${SERVICE_NAME} \
     --task-definition afu9-control-center:<previous-revision> \
     --force-new-deployment \
     --region ${AWS_REGION}
   ```

---

## ✅ Checkliste: Diagnose abgeschlossen

- [ ] Schritt 1: Service Events geprüft
- [ ] Schritt 2: Stopped Tasks analysiert (Exit Codes + stoppedReason)
- [ ] Schritt 3: Container Logs durchsucht (Error-Filter)
- [ ] Schritt 4: Target Health Status geprüft
- [ ] Schritt 5: Root Cause identifiziert und Fix angewendet
- [ ] Verification: Service stabilisiert und `/api/ready` gibt HTTP 200
- [ ] Zeit: < 10 Minuten
- [ ] Dokumentation: Gelerntes in Issue/Wiki festgehalten

---

**Version:** 1.0  
**Letzte Aktualisierung:** 2025-12-19  
**Maintainer:** AFU-9 Team
