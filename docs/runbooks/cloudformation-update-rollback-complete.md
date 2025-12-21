# CloudFormation UPDATE_ROLLBACK_COMPLETE Runbook

**ID:** I-05-01-RUNBOOK-ROLLBACK  
**Purpose:** Standardisierter Diagnoseprozess für UPDATE_ROLLBACK_COMPLETE  
**Time to Resolution:** < 15 Minuten

---

## 🎯 Übersicht

`UPDATE_ROLLBACK_COMPLETE` ist der häufigste CloudFormation-Fehlerfall und tritt auf, wenn ein Stack-Update fehlschlägt und automatisch zurückgerollt wurde. Der Stack ist nun in einem terminalen Zustand und kann nicht mehr aktualisiert werden.

**Symptom:**
```
Stack is in UPDATE_ROLLBACK_COMPLETE state and cannot be updated
```

**Root Cause:** Ein Stack-Update schlug fehl (z.B. ungültige Parameter, fehlende Ressourcen, IAM-Probleme), CloudFormation rollte automatisch zurück, aber der Stack ist blockiert.

---

## ⚡ Schnellstart

```bash
export AWS_REGION=eu-central-1
export STACK_NAME=Afu9EcsStack  # Anpassen nach Bedarf
```

**Empfohlener Workflow:**
```
1. CloudFormation Events prüfen (2 Min)
   ↓
2. ECS Service Status (2 Min)
   ↓
3. CloudWatch Logs analysieren (3 Min)
   ↓
4. Fix anwenden (5-8 Min)
```

**Gesamt: < 15 Minuten**

---

## 🔍 Schritt 1: CloudFormation Events prüfen

### Ziel
Identifiziere die exakte Ursache des Update-Fehlers durch Stack-Events.

### Kommandos

```bash
# Stack-Status anzeigen
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].{Name:StackName,Status:StackStatus,Reason:StackStatusReason}' \
  --output table

# Letzte 20 Events anzeigen (mit Fehlern)
aws cloudformation describe-stack-events \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --max-items 20 \
  --query 'StackEvents[*].{Time:Timestamp,Status:ResourceStatus,Type:ResourceType,Reason:ResourceStatusReason}' \
  --output table

# Nur fehlerhafte Events
aws cloudformation describe-stack-events \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'StackEvents[?contains(ResourceStatus,`FAILED`)]|[0:10].{Time:Timestamp,Resource:LogicalResourceId,Type:ResourceType,Reason:ResourceStatusReason}' \
  --output table
```

### Was zu suchen ist

**UPDATE_FAILED Ereignisse** zeigen den initialen Fehler:
- `LogicalResourceId`: Welche Ressource schlug fehl?
- `ResourceStatusReason`: Warum schlug sie fehl?

---

## 📦 Schritt 2: ECS Service Status (falls ECS Stack)

### Ziel
Bei ECS-Stacks: Prüfe ob Service/Tasks laufen, auch wenn Stack-Update fehlschlug.

### Kommandos

```bash
# ECS Cluster & Service identifizieren
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage

# Service Status
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount,TaskDef:taskDefinition}' \
  --output table

# Service Events (letzte 10)
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].events[:10]' \
  --output table

# Laufende Tasks
aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status RUNNING \
  --region ${AWS_REGION} \
  --query 'taskArns' \
  --output table
```

### Was zu suchen ist

- **Running Count = Desired Count**: Service läuft trotz Stack-Fehler → Low Priority
- **Running Count < Desired Count**: Service degradiert → High Priority
- **Running Count = 0**: Service down → Critical

---

## 📋 Schritt 3: CloudWatch Logs analysieren

### Ziel
Bei ECS/Lambda-Fehlern: Logs analysieren für Root Cause.

### Kommandos

#### ECS Container Logs

```bash
# Control Center Logs (letzte 30 Minuten)
aws logs tail /ecs/afu9/control-center \
  --since 30m \
  --region ${AWS_REGION} \
  --filter-pattern "?error ?Error ?ERROR ?failed ?Failed" \
  --format short

# Mit mehr Kontext (letzte 100 Zeilen)
aws logs tail /ecs/afu9/control-center \
  --since 1h \
  --region ${AWS_REGION} \
  --follow

# MCP Server Logs
aws logs tail /ecs/afu9/mcp-github \
  --since 30m \
  --region ${AWS_REGION} \
  --filter-pattern "?error ?Error ?ERROR"
```

#### Lambda Logs (falls zutreffend)

```bash
# Lambda Function Logs
aws logs tail /aws/lambda/afu9-orchestrator \
  --since 30m \
  --region ${AWS_REGION} \
  --filter-pattern "?ERROR ?Exception" \
  --format short
```

### Was zu suchen ist

- **ResourceInitializationError**: Secret/IAM-Probleme
- **CannotPullContainerError**: ECR-Image fehlt
- **Target.FailedHealthChecks**: Health Check Konfiguration
- **Environment variable ... is not set**: Task Definition Fehler

---

## 🛠️ Schritt 4: Fix anwenden

### Szenario 1: Secret fehlt oder ist falsch (Häufigstes Problem)

**Symptom:**
```
ResourceStatusReason: "ResourceInitializationError: unable to pull secrets or registry auth"
```

**Fix:**

```bash
# Secret prüfen
aws secretsmanager describe-secret \
  --secret-id afu9/database \
  --region ${AWS_REGION}

# Secret-Wert anzeigen (vorsichtig!)
aws secretsmanager get-secret-value \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --query 'SecretString' --output text | jq

# Secret aktualisieren (falls nötig)
# ⚠️ WICHTIG: Ersetze die Platzhalter mit echten Werten!
aws secretsmanager update-secret \
  --secret-id afu9/database \
  --region ${AWS_REGION} \
  --secret-string '{
    "DATABASE_HOST": "YOUR_DB_ENDPOINT_HERE.rds.amazonaws.com",
    "DATABASE_PORT": "5432",
    "DATABASE_NAME": "afu9",
    "DATABASE_USER": "YOUR_DB_USERNAME_HERE",
    "DATABASE_PASSWORD": "YOUR_DB_PASSWORD_HERE"
  }'

# Nach Secret-Fix: Stack löschen und neu deployen
aws cloudformation delete-stack \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION}

# Warten bis gelöscht
aws cloudformation wait stack-delete-complete \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION}

# Neu deployen
npx cdk deploy ${STACK_NAME} \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-database=true \
  --require-approval never
```

---

### Szenario 2: IAM Permissions fehlen

**Symptom:**
```
ResourceStatusReason: "User: arn:aws:sts::xxx:assumed-role/... is not authorized to perform: ecs:UpdateService"
```

**Fix:**

```bash
# Eigene IAM-Rolle prüfen
aws sts get-caller-identity

# IAM-Rolle des ECS Tasks prüfen
aws iam get-role \
  --role-name afu9-ecs-task-role \
  --query 'Role.{Name:RoleName,Arn:Arn}' \
  --output table

# Policies attached
aws iam list-attached-role-policies \
  --role-name afu9-ecs-task-role \
  --output table

# Fix: Deploy IAM Stack neu
npx cdk deploy Afu9IamStack \
  -c afu9-domain=afu-9.com \
  --require-approval never

# Dann fehlgeschlagenen Stack löschen und neu deployen
aws cloudformation delete-stack --stack-name ${STACK_NAME}
aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME}
npx cdk deploy ${STACK_NAME} -c afu9-domain=afu-9.com
```

---

### Szenario 3: ECS Service Circuit Breaker triggered

**Symptom:**
```
ResourceStatusReason: "Resource handler returned message: ECS deployment circuit breaker was triggered"
```

**Siehe:** [ECS Circuit Breaker Runbook](./ecs-circuit-breaker-diagnosis.md)

**Quick Fix:**

```bash
# Automatische Diagnose
pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME}

# Oder: Manuelle Task-Diagnose
TASK_ARN=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} \
  --desired-status STOPPED \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' --output text)

aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].{StopReason:stoppedReason,Containers:containers[*].{Name:name,Reason:reason,ExitCode:exitCode}}'
```

Häufige Circuit Breaker Ursachen:
1. Health Check fehlgeschlagen → Health Check Konfiguration prüfen
2. Image fehlt → ECR Images prüfen: `aws ecr describe-images --repository-name afu9/control-center`
3. Database nicht erreichbar → RDS Stack Status prüfen

---

### Szenario 4: Resource Limit erreicht

**Symptom:**
```
ResourceStatusReason: "The maximum number of VPCs has been reached"
ResourceStatusReason: "The maximum number of security groups for network interface has been reached"
```

**Fix:**

```bash
# VPC Limits prüfen
aws ec2 describe-vpcs --region ${AWS_REGION} --query 'Vpcs[*].VpcId' --output table

# Security Groups Limits
aws ec2 describe-security-groups --region ${AWS_REGION} --query 'length(SecurityGroups[*].GroupId)' --output text

# Elastic IPs Limits
aws ec2 describe-addresses --region ${AWS_REGION} --query 'Addresses[*].AllocationId' --output table

# Ungenutzte Ressourcen aufräumen oder AWS Support kontaktieren für Limit-Erhöhung
```

---

### Szenario 5: Stack Dependency fehlt

**Symptom:**
```
ResourceStatusReason: "Export Afu9NetworkStack:ExportsOutputRefAfu9Vpc... does not exist"
```

**Fix:**

```bash
# Abhängige Stacks identifizieren
aws cloudformation list-exports \
  --region ${AWS_REGION} \
  --query 'Exports[?starts_with(Name, `Afu9`)].{Name:Name,Value:Value}' \
  --output table

# Fehlenden Stack deployen (in korrekter Reihenfolge)
# Typische Reihenfolge:
npx cdk deploy Afu9IamStack -c afu9-domain=afu-9.com
npx cdk deploy Afu9NetworkStack -c afu9-domain=afu-9.com
npx cdk deploy Afu9DatabaseStack -c afu9-domain=afu-9.com -c afu9-enable-database=true
npx cdk deploy Afu9EcsStack -c afu9-domain=afu-9.com -c afu9-enable-database=true

# Dann fehlgeschlagenen Stack löschen und neu deployen
aws cloudformation delete-stack --stack-name ${STACK_NAME}
aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME}
npx cdk deploy ${STACK_NAME} -c afu9-domain=afu-9.com
```

---

### Szenario 6: CDK Context/Parameter-Fehler

**Symptom:**
```
ResourceStatusReason: "Parameters: [domainName] must have values"
```

**Fix:**

```bash
# Alle erforderlichen Context-Werte mitgeben
npx cdk deploy ${STACK_NAME} \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-database=true \
  -c afu9-enable-https=false \
  --require-approval never

# Oder: Fehlgeschlagenen Stack löschen
aws cloudformation delete-stack --stack-name ${STACK_NAME}
aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME}

# Mit vollständigen Parametern neu deployen
npx cdk deploy ${STACK_NAME} \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-database=true
```

---

## 🔄 Standardlösung: Delete & Redeploy

Falls spezifischer Fix nicht greift oder unklar ist:

```bash
# 1. Stack-Status prüfen
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].StackStatus' \
  --output text

# Sollte UPDATE_ROLLBACK_COMPLETE sein

# 2. Stack löschen
aws cloudformation delete-stack \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION}

echo "Warte auf Löschung (kann 2-5 Min dauern)..."

# 3. Warten bis vollständig gelöscht
aws cloudformation wait stack-delete-complete \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION}

echo "Stack gelöscht!"

# 4. CDK Diff prüfen (empfohlen)
npx cdk diff ${STACK_NAME} \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-database=true

# 5. Stack neu deployen
npx cdk deploy ${STACK_NAME} \
  -c afu9-domain=afu-9.com \
  -c afu9-enable-database=true \
  --require-approval never

echo "Deployment gestartet. Warte auf Abschluss..."

# 6. Deployment-Status überwachen
aws cloudformation describe-stack-events \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --max-items 5 \
  --query 'StackEvents[*].{Time:Timestamp,Status:ResourceStatus,Resource:LogicalResourceId}' \
  --output table
```

---

## 📊 Verifikation nach Fix

Nach erfolgreichem Deployment oder Fix:

```bash
# 1. Stack-Status prüfen
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'Stacks[0].{Name:StackName,Status:StackStatus}' \
  --output table

# Expected: CREATE_COMPLETE oder UPDATE_COMPLETE

# 2. Alle Stack-Ressourcen prüfen
aws cloudformation list-stack-resources \
  --stack-name ${STACK_NAME} \
  --region ${AWS_REGION} \
  --query 'StackResourceSummaries[*].{Type:ResourceType,LogicalId:LogicalResourceId,Status:ResourceStatus}' \
  --output table

# Expected: Alle ResourceStatus = CREATE_COMPLETE oder UPDATE_COMPLETE

# 3. Bei ECS Stack: Service-Health prüfen
aws ecs describe-services \
  --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --region ${AWS_REGION} \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --output table

# Expected: Running = Desired

# 4. Application Health (falls Control Center)
ALB_DNS=$(aws elbv2 describe-load-balancers \
  --names afu9-load-balancer \
  --query 'LoadBalancers[0].DNSName' \
  --output text \
  --region ${AWS_REGION})

curl -s http://${ALB_DNS}/api/health | jq

# Expected: {"status":"ok","service":"afu9-control-center"}
```

---

## 🎯 Häufige Fehlermuster: Cheatsheet

| Symptom | Ursache | Fix |
|---------|---------|-----|
| `unable to pull secrets` | Secret fehlt/falsch | Secret in Secrets Manager korrigieren → Delete & Redeploy |
| `not authorized to perform` | IAM-Policy fehlt | Afu9IamStack deployen → Delete & Redeploy |
| `circuit breaker triggered` | ECS Tasks starten nicht | [ECS Circuit Breaker Runbook](./ecs-circuit-breaker-diagnosis.md) |
| `Export ... does not exist` | Abhängiger Stack fehlt | Dependencies in korrekter Reihenfolge deployen |
| `maximum number ... reached` | AWS Resource Limit | Ungenutzte Ressourcen löschen oder Limit erhöhen |
| `Parameters: [...] must have values` | CDK Context fehlt | Alle `-c` Parameter angeben |
| `CannotPullContainerError` | ECR Image fehlt | Images bauen: `npm run build:images` |
| `Resource ... already exists` | Ressource existiert schon | Stack-Drift prüfen oder manuell löschen |

---

## 🆘 Eskalation

Falls Root Cause nach 15 Min nicht gefunden oder Fix nicht funktioniert:

1. **Logs exportieren:**
   ```bash
   # Stack Events
   aws cloudformation describe-stack-events \
     --stack-name ${STACK_NAME} \
     --region ${AWS_REGION} > /tmp/stack-events.json

   # CloudWatch Logs
   aws logs tail /ecs/afu9/control-center \
     --since 1h \
     --region ${AWS_REGION} > /tmp/ecs-logs.txt
   ```

2. **GitHub Issue erstellen** mit:
   - Stack Name & Region
   - Output von Schritt 1 (CloudFormation Events)
   - Output von Schritt 3 (CloudWatch Logs)
   - Bereits versuchte Fixes

3. **Workaround erwägen:**
   - Rollback auf letzte funktionierende Version (siehe [ROLLBACK.md](../v04/ROLLBACK.md))
   - Manuelle Ressourcen-Bereinigung
   - Alternative Stack-Namen verwenden

---

## 🔗 Weiterführende Links

- **[ECS Circuit Breaker Diagnosis](./ecs-circuit-breaker-diagnosis.md)** - Detaillierte ECS Diagnostik
- **[ECS Circuit Breaker Quick Reference](./ecs-circuit-breaker-quick-reference.md)** - Schnellzugriff ECS
- **[AWS Deployment Runbook](../v04/AWS_DEPLOY_RUNBOOK.md)** - Source of Truth für Deployments
- **[Rollback Guide](../v04/ROLLBACK.md)** - ECS Rollback Procedures
- **[Deployment Consolidated](../v04/DEPLOYMENT_CONSOLIDATED.md)** - Komplette Deployment-Prozesse

---

## 📝 Notizen

- **UPDATE_ROLLBACK_COMPLETE ist terminal**: Stack muss gelöscht werden, bevor neues Update möglich
- **Rollback ist automatisch**: CloudFormation rollt automatisch zurück bei Fehler
- **Rollback löscht NEUE Ressourcen**: Nur während des gescheiterten Updates erstellte Ressourcen werden gelöscht
- **Alte Ressourcen bleiben**: Ressourcen die vor dem Update existierten, bleiben unverändert
- **Service Continuity**: Bei ECS Stacks läuft der Service oft weiter, auch wenn Stack-Update fehlschlägt

---

**Version:** 1.0  
**Datum:** 2025-12-20  
**ID:** I-05-01-RUNBOOK-ROLLBACK
