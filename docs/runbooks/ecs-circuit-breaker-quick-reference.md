# ECS Circuit Breaker: Quick Reference Card

**Schnellzugriff für Incident Response**

---

## 🚨 Circuit Breaker ausgelöst? → Folge diesem Pfad

```
1. Service Events prüfen (1 Min)
   ↓
2. Stopped Tasks (2 Min)
   ↓
3. Container Logs (2 Min)
   ↓
4. Target Health (1 Min)
   ↓
5. Fix anwenden (3-4 Min)
```

**Gesamt: < 10 Minuten**

---

## ⚡ Schnellstart

```bash
export AWS_REGION=eu-central-1
export CLUSTER_NAME=afu9-cluster
export SERVICE_NAME=afu9-control-center-stage
```

**Option 1: Automatische Diagnose**
```bash
pwsh scripts/ecs_debug.ps1 -Service ${SERVICE_NAME}
```

**Option 2: Manuelle Schritte** → Siehe [Vollständiger Runbook](./ecs-circuit-breaker-diagnosis.md)

---

## 🎯 Häufigste Szenarien

### 1. Secret fehlt
**Symptom:** `ResourceInitializationError: unable to pull secrets`
```bash
# Prüfen
aws secretsmanager describe-secret --secret-id afu9-database
# Fix: Siehe Abschnitt 5.1-5.7
```

### 2. Database Secret falsch
**Symptom:** `Environment variable DATABASE_HOST is not set`
```bash
# Prüfen
aws secretsmanager get-secret-value --secret-id afu9-database \
  --query 'SecretString' --output text | jq 'keys'
# Fix: Abschnitt 5.3
```

### 3. Database nicht benötigt
**Symptom:** `connect ECONNREFUSED` (DB nicht erreichbar)
```bash
# Fix: Database deaktivieren
npx cdk deploy Afu9EcsStack -c afu9-enable-database=false
```

### 4. Health Check fehlgeschlagen
**Symptom:** `Target.FailedHealthChecks`
```bash
# Prüfen
aws elbv2 describe-target-health --target-group-arn <TG_ARN>
# Logs prüfen
aws logs tail /ecs/afu9/control-center --since 30m \
  --filter-pattern "?error" --format short
```

### 5. Image fehlt
**Symptom:** `CannotPullContainerError`
```bash
# Prüfen
aws ecr describe-images --repository-name afu9/control-center
# Fix: Images bauen und pushen
```

---

## 📋 Kommando-Cheatsheet

### Service Events
```bash
aws ecs describe-services --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --query 'services[0].events[:10]' --output table
```

### Stopped Tasks
```bash
TASK_ARN=$(aws ecs list-tasks --cluster ${CLUSTER_NAME} \
  --service-name ${SERVICE_NAME} --desired-status STOPPED \
  --query 'taskArns[0]' --output text)

aws ecs describe-tasks --cluster ${CLUSTER_NAME} --tasks ${TASK_ARN} \
  --query 'tasks[0].{reason:stoppedReason,containers:containers[*].{name:name,exitCode:exitCode}}' \
  --output json
```

### Container Logs
```bash
aws logs tail /ecs/afu9/control-center --since 30m \
  --filter-pattern "?error ?Error ?ERROR" --format short
```

### Target Health
```bash
TG_ARN=$(aws ecs describe-services --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME} \
  --query 'services[0].loadBalancers[0].targetGroupArn' --output text)

aws elbv2 describe-target-health --target-group-arn ${TG_ARN} \
  --query 'TargetHealthDescriptions[*].{Target:Target.Id,State:TargetHealth.State}' \
  --output table
```

### Force Deployment
```bash
aws ecs update-service --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} --force-new-deployment

aws ecs wait services-stable --cluster ${CLUSTER_NAME} \
  --services ${SERVICE_NAME}
```

---

## 🔗 Weiterführende Links

- **[Vollständiger Runbook](./ecs-circuit-breaker-diagnosis.md)** - Detaillierte Schritte
- **[Runbook Übersicht](./README.md)** - Alle verfügbaren Runbooks
- **[ECS Deployment Guide](../ECS-DEPLOYMENT.md)** - Deployment-Dokumentation
- **[AWS Deploy Runbook](../AWS_DEPLOY_RUNBOOK.md)** - Source of Truth

---

## 🆘 Eskalation

Falls Root Cause nach 10 Min nicht gefunden:

1. Vollständige Logs exportieren
2. Diagnostic Script ausführen
3. GitHub Issue erstellen mit Outputs
4. Ggf. Rollback erwägen

---

**Version:** 1.0  
**Datum:** 2025-12-19  
**ID:** I-01-03-ECS-CIRCUIT-DIAG
