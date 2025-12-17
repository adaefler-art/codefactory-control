# ECS Circuit Breaker: Secrets Diagnostic Runbook

**ID:** I-ECS-DB-04  
**Ziel:** Diagnose von ECS Circuit Breaker Auslösungen durch Secret-Fehler in unter 5 Minuten.

Dieses Runbook ist speziell für Fälle, in denen der ECS Circuit Breaker aufgrund von Secret-Problemen ausgelöst wurde. Alle Commands sind copy-paste-ready.

---

## Quick Setup

```bash
# Environment-Variablen setzen
export AWS_REGION=eu-central-1
export STACK_NAME=Afu9EcsStack
export NETWORK_STACK_NAME=Afu9NetworkStack
export DATABASE_STACK_NAME=Afu9DatabaseStack
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage  # oder afu9-control-center-prod
```

---

## Diagnostik-Flow

```
Circuit Breaker ausgelöst
    ↓
1. CloudFormation Events prüfen
    ↓
2. ECS Service Events prüfen
    ↓
3. Stopped Tasks analysieren
    ↓
4. Container Logs prüfen
    ↓
5. Secrets validieren
    ↓
6. Fix anwenden (DB-On oder DB-Off)
```

---

## 1. CloudFormation Events

**Warum:** Zeigt Stack-Level Fehler bei Deployment.

```bash
aws cloudformation describe-stack-events \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --max-items 20 \
  --query 'StackEvents[?ResourceStatus==`CREATE_FAILED` || ResourceStatus==`UPDATE_FAILED`].{Time:Timestamp,Resource:LogicalResourceId,Status:ResourceStatus,Reason:ResourceStatusReason}' \
  --output table
```

**Typische Fehler:**

| Fehlermeldung | Ursache | Nächster Schritt |
|--------------|---------|------------------|
| `Resource creation cancelled` | ECS Service failed to stabilize | → Schritt 2 |
| `The target group ... does not have an associated load balancer` | ALB-Konfigurationsfehler | Network Stack prüfen |
| (Leer) | Kein CloudFormation-Fehler | → Schritt 2 |

---

## 2. ECS Service Events

**Warum:** Zeigt warum Circuit Breaker ausgelöst wurde.

```bash
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:10]' \
  --output table
```

**Typische Circuit Breaker Meldungen:**

```
(service afu9-control-center-stage) has reached a steady state.
→ Deployment erfolgreich (kein Problem)

(service afu9-control-center-stage) failed circuit breaker: tasks failed to start.
→ Tasks starten nicht → Schritt 3

(service afu9-control-center-stage) failed circuit breaker: tasks failed ELB health checks.
→ Tasks starten, aber Health-Check schlägt fehl → Schritt 3 & 4
```

---

## 3. Stopped Tasks analysieren

**Warum:** Exit-Codes und Stopp-Gründe zeigen die Root Cause.

### 3.1 Letzte gestoppte Tasks auflisten

```bash
aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[:5]' \
  --output text
```

### 3.2 Task-Details anzeigen

```bash
# Task-ARN automatisch holen (oder manuell aus Schritt 3.1 kopieren)
TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' \
  --output text)

aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].{stoppedReason:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode,reason:reason}}' \
  --output json
```

**Secrets-relevante Fehler:**

| stoppedReason | Ursache | Nächster Schritt |
|--------------|---------|------------------|
| `ResourceInitializationError: unable to pull secrets or registry auth` | Secret existiert nicht oder IAM-Fehler | → Schritt 5 |
| `CannotPullContainerError: pull image manifest has been retried` | ECR-Zugriff fehlgeschlagen (nicht Secrets) | ECR prüfen |
| `Task failed ELB health checks` | App startet, aber `/api/ready` schlägt fehl | → Schritt 4 |
| `Essential container in task exited` | Container-Crash (vermutlich Config-Fehler) | → Schritt 4 |

**Beispiel: ResourceInitializationError**

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

**→ Secret fehlt oder ARN ist falsch → Schritt 5**

---

## 4. Container Logs prüfen

**Warum:** Zeigt App-Level Fehler (z.B. fehlende Secret-Keys, falsche DB-Credentials).

```bash
# Letzte 50 Zeilen mit Fehlerfilter
aws logs tail /ecs/afu9/control-center \
  --since 30m \
  --filter-pattern "?error ?Error ?ERROR ?exception ?Exception ?fail ?Fail ?FAIL" \
  --region ${AWS_REGION} \
  --format short
```

**Secrets-relevante Log-Muster:**

| Log-Meldung | Ursache | Nächster Schritt |
|------------|---------|------------------|
| `Environment variable DATABASE_HOST is not set` | Secret-Key fehlt in Secret | → Schritt 5.3 |
| `FATAL: password authentication failed for user "..."` | Falsches Passwort im Secret | → Schritt 5.4 |
| `Error: getaddrinfo ENOTFOUND null` | DATABASE_HOST ist `null` (Secret-Key fehlt) | → Schritt 5.3 |
| `connect ECONNREFUSED 127.0.0.1:5432` | DB-Host ist falsch oder DB nicht erreichbar | Network/Security Groups prüfen |
| `Database not configured but DATABASE_ENABLED=true` | Config-Mismatch | → Entscheidungspfad (Schritt 6) |

**Beispiel: Fehlender Secret-Key**

```
Error: Environment variable DATABASE_PORT is not set
    at Object.<anonymous> (/app/lib/db.js:15:11)
```

**→ Secret-Struktur validieren → Schritt 5.3**

---

## 5. Secrets validieren

### 5.1 Prüfen ob Secrets existieren

```bash
# GitHub Secret
aws secretsmanager describe-secret \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table

# LLM Secret
aws secretsmanager describe-secret \
  --secret-id afu9/llm \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table

# Database Secret (nur wenn enableDatabase=true)
aws secretsmanager describe-secret \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query '{Name:Name,ARN:ARN,LastAccessedDate:LastAccessedDate}' \
  --output table
```

**Fehler:**
- `ResourceNotFoundException`: Secret existiert nicht → Muss erstellt werden
- `AccessDeniedException`: IAM-Berechtigung fehlt → IAM-Policy prüfen

### 5.2 Secret-Struktur validieren (GitHub)

```bash
aws secretsmanager get-secret-value \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("token", "owner", "repo")'
```

**Erwartet:** `true`  
**Falls `false`:** Fehlende Keys hinzufügen (siehe Schritt 6.1)

### 5.3 Secret-Struktur validieren (Database)

**Nur durchführen wenn `enableDatabase=true`:**

```bash
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'has("host", "port", "database", "username", "password")'
```

**Erwartet:** `true`  
**Falls `false`:** Fehlende Keys hinzufügen (siehe Schritt 6.2)

### 5.4 Secret-Werte anzeigen (zur Verifikation)

```bash
# GitHub Secret (ohne sensitive Werte zu loggen)
aws secretsmanager get-secret-value \
  --secret-id afu9/github \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'keys'

# Database Secret (nur Keys anzeigen)
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq 'keys'
```

**Erwartet:**
```json
// GitHub
["owner", "repo", "token"]

// Database
["database", "host", "password", "port", "username"]
```

### 5.5 IAM-Berechtigungen prüfen

```bash
# Task Execution Role finden
TASK_EXEC_ROLE=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`].OutputValue' \
  --output text)

echo "Task Execution Role: ${TASK_EXEC_ROLE}"

# Role-Name aus ARN extrahieren
TASK_EXEC_ROLE_NAME=$(echo ${TASK_EXEC_ROLE} | awk -F'/' '{print $NF}')

# Attached Policies auflisten
aws iam list-attached-role-policies \
  --role-name ${TASK_EXEC_ROLE_NAME} \
  --region ${AWS_REGION} \
  --output table
```

**Erwartet:** Mindestens `SecretsManagerReadWrite` oder Custom-Policy mit `secretsmanager:GetSecretValue`

---

## 6. Entscheidungspfad & Fixes

### Entscheidung: Database aktiviert oder deaktiviert?

```bash
# Task Definition prüfen
SERVICE_TASK_DEF=$(aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].taskDefinition' \
  --output text)

aws ecs describe-task-definition \
  --task-definition ${SERVICE_TASK_DEF} \
  --region ${AWS_REGION} \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`DATABASE_ENABLED`].value' \
  --output text
```

**Output:**
- `true` → Database ist aktiviert → **Fix 6.2**
- `false` → Database ist deaktiviert → **Fix 6.1**
- (leer) → Env-Var fehlt → CDK-Code prüfen

---

### Fix 6.1: Database deaktiviert (enableDatabase=false)

**Problem:** `afu9/database` Secret wird erwartet, aber nicht benötigt.

**Lösung:** ECS Stack mit `enableDatabase=false` deployen.

```bash
# Option A: Context in cdk.context.json setzen
jq '.context."afu9-enable-database" = false' cdk.context.json > cdk.context.json.tmp
mv cdk.context.json.tmp cdk.context.json

# Option B: Inline Context verwenden
npx cdk deploy Afu9EcsStack \
  -c afu9-enable-database=false \
  --region ${AWS_REGION}
```

**Was passiert:**
- Task Definition enthält KEINE Database-Secrets mehr
- Environment-Variable `DATABASE_ENABLED=false` wird gesetzt
- `/api/ready` gibt `database: {status: "not_configured"}` zurück

**Verification:**

```bash
# Warten bis Service stabil ist (ca. 3-5 Minuten)
aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}

# Health-Check prüfen
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name ${NETWORK_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl http://${ALB_DNS}/api/ready | jq .
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

### Fix 6.2: Database aktiviert (enableDatabase=true)

**Problem:** `afu9/database` Secret fehlt oder hat falsche Struktur.

#### Schritt 1: Database Secret erstellen/updaten

```bash
# RDS Endpoint dynamisch holen
RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${DATABASE_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbEndpoint`].OutputValue' \
  --output text)

# Secrets Manager Secret mit korrekter Struktur erstellen
aws secretsmanager create-secret \
  --name afu9/database \
  --secret-string "{
    \"host\": \"${RDS_ENDPOINT}\",
    \"port\": \"5432\",
    \"database\": \"afu9\",
    \"username\": \"afu9_admin\",
    \"password\": \"DEIN_SICHERES_PASSWORT\"
  }" \
  --region ${AWS_REGION}
```

**Falls Secret bereits existiert:**

```bash
# Bestehenden Secret updaten
aws secretsmanager update-secret \
  --secret-id afu9/database \
  --secret-string "{
    \"host\": \"${RDS_ENDPOINT}\",
    \"port\": \"5432\",
    \"database\": \"afu9\",
    \"username\": \"afu9_admin\",
    \"password\": \"DEIN_SICHERES_PASSWORT\"
  }" \
  --region ${AWS_REGION}
```

**Werte ermitteln (falls unbekannt):**

```bash
# RDS Endpoint aus Database Stack
aws cloudformation describe-stacks \
  --stack-name ${DATABASE_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbEndpoint`].OutputValue' \
  --output text

# Credentials aus existierendem Secret (falls schon erstellt von CDK)
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq .
```

#### Schritt 2: ECS Service neu deployen

```bash
# Force new deployment (holt aktualisierte Secrets)
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION}

# Deployment-Status überwachen
aws ecs wait services-stable \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION}
```

#### Schritt 3: Verification

```bash
# Task läuft?
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{runningCount:runningCount,desiredCount:desiredCount}'

# Health-Check OK?
ALB_DNS=$(aws cloudformation describe-stacks \
  --stack-name ${NETWORK_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`LoadBalancerDNS`].OutputValue' \
  --output text)

curl http://${ALB_DNS}/api/ready | jq .
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

### Fix 6.3: GitHub Secret fehlt

```bash
aws secretsmanager create-secret \
  --name afu9/github \
  --secret-string '{
    "token": "ghp_DEIN_GITHUB_TOKEN",
    "owner": "adaefler-art",
    "repo": "codefactory-control"
  }' \
  --region ${AWS_REGION}

# Falls Secret existiert
aws secretsmanager update-secret \
  --secret-id afu9/github \
  --secret-string '{
    "token": "ghp_DEIN_GITHUB_TOKEN",
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

### Fix 6.4: LLM Secret fehlt

```bash
aws secretsmanager create-secret \
  --name afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-DEIN_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-DEIN_ANTHROPIC_KEY",
    "deepseek_api_key": "DEIN_DEEPSEEK_KEY"
  }' \
  --region ${AWS_REGION}

# Falls Secret existiert
aws secretsmanager update-secret \
  --secret-id afu9/llm \
  --secret-string '{
    "openai_api_key": "sk-DEIN_OPENAI_KEY",
    "anthropic_api_key": "sk-ant-DEIN_ANTHROPIC_KEY",
    "deepseek_api_key": "DEIN_DEEPSEEK_KEY"
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

## Zusammenfassung: Häufigste Fehlerszenarien

### Szenario 1: Database Secret fehlt (enableDatabase=true)

**Symptome:**
- Service Events: `failed circuit breaker`
- Stopped Tasks: `ResourceInitializationError: unable to pull secrets`
- Logs: (keine, Container startet nicht)

**Fix:** Schritt 6.2 - Database Secret erstellen

---

### Szenario 2: Database Secret hat falsche Struktur

**Symptome:**
- Service Events: `failed circuit breaker: tasks failed to start`
- Stopped Tasks: `Essential container in task exited`
- Logs: `Environment variable DATABASE_PORT is not set`

**Fix:** Schritt 6.2 - Secret mit allen Keys updaten (`host`, `port`, `database`, `username`, `password`)

---

### Szenario 3: Database aktiviert, aber nicht benötigt

**Symptome:**
- Service Events: `failed circuit breaker: tasks failed ELB health checks`
- Stopped Tasks: `Task failed ELB health checks`
- Logs: `Error: connect ECONNREFUSED` (DB nicht erreichbar, aber auch nicht benötigt)

**Fix:** Schritt 6.1 - Stack mit `enableDatabase=false` deployen

---

### Szenario 4: Falsche Database-Credentials

**Symptome:**
- Service Events: `failed circuit breaker: tasks failed ELB health checks`
- Stopped Tasks: `Task failed ELB health checks`
- Logs: `FATAL: password authentication failed for user "afu9_admin"`

**Fix:** 
```bash
# RDS Master Secret ARN aus Database Stack holen
RDS_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name ${DATABASE_STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`Afu9DbSecretArn`].OutputValue' \
  --output text)

# Korrekte Credentials aus RDS Secret holen
aws secretsmanager get-secret-value \
  --secret-id ${RDS_SECRET_ARN} \
  --region ${AWS_REGION} \
  --query 'SecretString' \
  --output text | jq .

# In afu9/database Secret übertragen (Schritt 6.2)
```

---

## Weiterführende Dokumentation

- [Vollständiger ECS Deployment Runbook](./RUNBOOK_ECS_DEPLOY.md) - Komplette Diagnostik-Prozedur
- [ECS Configuration Reference](./ECS_CONFIG_REFERENCE.md) - Alle Config-Optionen
- [Secret Validation](./SECRET_VALIDATION.md) - Secret-Struktur und Validierung
- [ECS Stabilization Summary](../ECS_STABILIZATION_SUMMARY.md) - Hintergrund zu DB-On/Off

---

## Support

Bei persistierenden Problemen:

1. **Vollständige Diagnostik ausführen:**
   ```bash
   pwsh scripts/ecs_diagnose.ps1 \
     -ClusterName ${CLUSTER_NAME} \
     -ServiceName ${SERVICE_NAME}
   ```

2. **CloudWatch Logs exportieren:**
   ```bash
   aws logs tail /ecs/afu9/control-center \
     --since 1h \
     --region ${AWS_REGION} > ecs-logs.txt
   ```

3. **Issue erstellen** mit:
   - Output von Schritt 1 (CloudFormation Events)
   - Output von Schritt 2 (ECS Service Events)
   - Output von Schritt 3 (Stopped Tasks)
   - ecs-logs.txt
