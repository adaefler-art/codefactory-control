# AFU-9 Control Plane Specification v1

## Übersicht

Diese Spezifikation definiert die standardisierten Health- und Readiness-Endpunkte für alle Komponenten der AFU-9 Control Plane. Alle Services (Control Center, MCP-Server) müssen diese Spezifikation implementieren, um eine konsistente, überwachbare und robuste Infrastruktur zu gewährleisten.

## Ziele

- **Standardisierung**: Einheitliche Health-/Readiness-Endpunkte über alle Services
- **Observability**: Zentrale Überwachung des Systemzustands
- **Verfügbarkeit**: Sicherstellen, dass nur bereite Services Traffic erhalten
- **Auditierbarkeit**: Nachvollziehbare Dependency-Checks und Statusmeldungen

## Endpunkt-Spezifikation

### 1. Health Endpoint: `/health`

**Zweck**: Schnelle Liveness-Probe - bestätigt, dass der Service läuft.

**Verwendung**:
- Kubernetes/ECS Liveness Probes
- Schnelle Verfügbarkeitschecks
- Monitoring-Systeme

**Anforderungen**:
- Muss innerhalb von 1 Sekunde antworten
- Keine externen Dependency-Checks
- Nur grundlegende Prozessüberprüfung

**Request**:
```
GET /health
```

**Response Format** (200 OK):
```json
{
  "status": "ok",
  "service": "mcp-github",
  "version": "0.2.0",
  "timestamp": "2025-12-16T17:00:00.000Z"
}
```

**Response Format** (503 Service Unavailable):
```json
{
  "status": "error",
  "service": "mcp-github",
  "version": "0.2.0",
  "error": "Service not initialized",
  "timestamp": "2025-12-16T17:00:00.000Z"
}
```

**Status Codes**:
- `200 OK`: Service ist betriebsbereit
- `503 Service Unavailable`: Service ist nicht verfügbar

---

### 2. Readiness Endpoint: `/ready`

**Zweck**: Umfassende Readiness-Probe - bestätigt, dass der Service bereit ist, Traffic zu verarbeiten.

**Verwendung**:
- Kubernetes/ECS Readiness Probes
- ALB Health Checks
- Deployment-Validierung
- Pre-traffic Checks

**Anforderungen**:
- Muss innerhalb von 5 Sekunden antworten
- **Muss** alle kritischen Dependencies prüfen
- Detaillierte Status-Informationen für jede Dependency

**Request**:
```
GET /ready
```

**Response Format** (200 OK):
```json
{
  "ready": true,
  "service": "mcp-github",
  "version": "0.2.0",
  "timestamp": "2025-12-16T17:00:00.000Z",
  "checks": {
    "service": {
      "status": "ok"
    },
    "github_api": {
      "status": "ok",
      "message": "GitHub API reachable",
      "latency_ms": 120
    },
    "authentication": {
      "status": "ok",
      "message": "Token configured and valid"
    }
  },
  "dependencies": {
    "required": ["github_api", "authentication"],
    "optional": []
  }
}
```

**Response Format** (503 Service Unavailable):
```json
{
  "ready": false,
  "service": "mcp-github",
  "version": "0.2.0",
  "timestamp": "2025-12-16T17:00:00.000Z",
  "checks": {
    "service": {
      "status": "ok"
    },
    "github_api": {
      "status": "error",
      "message": "Connection timeout",
      "latency_ms": 5000
    },
    "authentication": {
      "status": "ok"
    }
  },
  "dependencies": {
    "required": ["github_api", "authentication"],
    "optional": []
  },
  "errors": [
    "github_api check failed: Connection timeout"
  ]
}
```

**Status Codes**:
- `200 OK`: Service ist bereit, Traffic zu empfangen
- `503 Service Unavailable`: Service ist noch nicht bereit

**Check Status Values**:
- `ok`: Check erfolgreich
- `warning`: Check erfolgreich mit Einschränkungen (z.B. hohe Latenz)
- `error`: Check fehlgeschlagen
- `not_configured`: Dependency nicht konfiguriert (kann ok sein in Dev-Umgebung)

---

## Service-spezifische Dependency Checks

### MCP GitHub Server

**Required Dependencies**:
1. **github_api**: GitHub API erreichbar (https://api.github.com)
   - Timeout: 3s
   - Prüfung: HEAD Request zu /zen oder /rate_limit
   
2. **authentication**: GitHub Token konfiguriert und gültig
   - Prüfung: Token vorhanden und Format korrekt
   - Optional: Rate-Limit-Status abrufen

**Optional Dependencies**:
- AWS Secrets Manager (production only)

### MCP Deploy Server

**Required Dependencies**:
1. **aws_connectivity**: AWS API erreichbar
   - Timeout: 3s
   - Prüfung: AWS STS GetCallerIdentity
   
2. **ecs_permissions**: ECS Permissions vorhanden
   - Prüfung: DescribeServices mit bekanntem Cluster

**Optional Dependencies**:
- ECR Zugriff

### MCP Observability Server

**Required Dependencies**:
1. **aws_connectivity**: AWS API erreichbar
   - Timeout: 3s
   - Prüfung: AWS STS GetCallerIdentity
   
2. **cloudwatch_permissions**: CloudWatch Permissions vorhanden
   - Prüfung: DescribeAlarms oder DescribeLogGroups

### Control Center

**Required Dependencies**:
1. **database**: RDS Postgres Verbindung
   - Timeout: 2s
   - Prüfung: `SELECT 1` Query
   
2. **mcp_servers**: Alle MCP Server erreichbar
   - Timeout: 3s pro Server
   - Prüfung: GET /health für jeden Server

**Optional Dependencies**:
- GitHub OAuth (für User-Login)
- External LLM APIs

---

## Monitoring Integration

### CloudWatch Metrics

Alle Services sollen folgende Metriken exportieren:

1. **HealthCheckSuccess** (0 oder 1)
   - Dimension: Service, Endpoint (/health oder /ready)
   
2. **ReadinessCheckSuccess** (0 oder 1)
   - Dimension: Service, DependencyName
   
3. **DependencyCheckLatency** (Millisekunden)
   - Dimension: Service, DependencyName

### CloudWatch Alarms

Empfohlene Alarm-Konfiguration:

```yaml
HealthCheckFailure:
  Metric: HealthCheckSuccess
  Threshold: < 1
  EvaluationPeriods: 2
  DatapointsToAlarm: 2
  Period: 60s
  Severity: P1 (Critical)

ReadinessCheckFailure:
  Metric: ReadinessCheckSuccess
  Threshold: < 1
  EvaluationPeriods: 3
  DatapointsToAlarm: 2
  Period: 60s
  Severity: P2 (High)

DependencyHighLatency:
  Metric: DependencyCheckLatency
  Threshold: > 2000ms
  EvaluationPeriods: 5
  DatapointsToAlarm: 3
  Period: 60s
  Severity: P3 (Warning)
```

---

## Deployment-Integration

### ECS Task Definition

Beispiel Health Check Konfiguration:

```json
{
  "healthCheck": {
    "command": [
      "CMD-SHELL",
      "curl -f http://localhost:3001/health || exit 1"
    ],
    "interval": 30,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 60
  }
}
```

### ALB Target Group

Empfohlene Health Check Konfiguration:

```typescript
{
  healthCheck: {
    enabled: true,
    path: '/ready',
    protocol: 'HTTP',
    port: 'traffic-port',
    interval: cdk.Duration.seconds(30),
    timeout: cdk.Duration.seconds(5),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 3,
    matcher: {
      httpCode: '200'
    }
  }
}
```

---

## Best Practices

### 1. Fail Fast
- Health Checks sollten sofort fehlschlagen, wenn der Service nicht betriebsbereit ist
- Keine Retries innerhalb des Health Checks

### 2. Timeout Management
- Health Check: max 1s
- Readiness Check: max 5s
- Dependency Checks: individuelle Timeouts (1-3s)

### 3. Logging
Alle Health/Readiness Checks sollen geloggt werden:

```json
{
  "timestamp": "2025-12-16T17:00:00.000Z",
  "level": "INFO",
  "component": "health-check",
  "endpoint": "/ready",
  "duration_ms": 234,
  "status": "ok",
  "checks": {
    "github_api": "ok",
    "authentication": "ok"
  }
}
```

### 4. Caching
- Health Check Ergebnisse können für kurze Zeit gecacht werden (5-10s)
- Readiness Check Ergebnisse sollten nicht gecacht werden

### 5. Error Handling
- Alle Exceptions müssen gefangen und als 503 zurückgegeben werden
- Niemals unkontrollierte Errors nach außen geben
- Stack Traces nur in Development-Modus

---

## Testing

### Unit Tests

Jeder Service muss Unit Tests für folgende Szenarien haben:

1. `/health` gibt 200 zurück wenn Service läuft
2. `/health` gibt 503 zurück wenn Service nicht initialisiert
3. `/ready` gibt 200 zurück wenn alle Dependencies ok
4. `/ready` gibt 503 zurück wenn eine Required Dependency fehlschlägt
5. `/ready` gibt 200 zurück wenn nur Optional Dependencies fehlschlagen

### Integration Tests

1. Health Check von jedem Service in Staging
2. Readiness Check von jedem Service in Staging
3. Dependency Failure Simulation (z.B. ungültiges Token)
4. Timeout-Verhalten bei langsamen Dependencies

### Smoke Tests

Nach jedem Deployment:

```bash
#!/bin/bash
# Smoke test für alle Services

SERVICES=("control-center:3000" "mcp-github:3001" "mcp-deploy:3002" "mcp-observability:3003")

for SERVICE in "${SERVICES[@]}"; do
  NAME=$(echo $SERVICE | cut -d: -f1)
  PORT=$(echo $SERVICE | cut -d: -f2)
  
  echo "Testing $NAME..."
  
  # Health check
  if ! curl -f "http://localhost:$PORT/health"; then
    echo "❌ $NAME health check failed"
    exit 1
  fi
  
  # Readiness check
  if ! curl -f "http://localhost:$PORT/ready"; then
    echo "❌ $NAME readiness check failed"
    exit 1
  fi
  
  echo "✅ $NAME is healthy and ready"
done

echo "✅ All services passed smoke tests"
```

---

## KPIs

### Factory Uptime

**Definition**: Prozentsatz der Zeit, in der alle kritischen Services betriebsbereit sind.

**Berechnung**:
```
Factory Uptime = (Total Time - Downtime) / Total Time * 100%
```

**Target**: 99.5% (ca. 3.6 Stunden Downtime pro Monat)

**Measurement**: CloudWatch Metric `FactoryAvailability`

### MTTR (Mean Time To Recovery)

**Definition**: Durchschnittliche Zeit von Erkennung eines Ausfalls bis zur vollständigen Wiederherstellung.

**Berechnung**:
```
MTTR = Sum(Recovery Times) / Count(Incidents)
```

**Target**: < 15 Minuten

**Measurement**: CloudWatch Logs Insights Query über Incident-Logs

---

## Versionierung

- Spec Version: **1.0.0**
- Letzte Aktualisierung: 2025-12-16
- Status: **Active**

Änderungen an dieser Spezifikation müssen durch einen Review-Prozess gehen und über ein CHANGELOG dokumentiert werden.

---

## Siehe auch

- [Observability Documentation](./OBSERVABILITY.md)
- [Deployment Runbook](./AWS_DEPLOY_RUNBOOK.md)
- [Logging Guidelines](./LOGGING.md)
- [Alerting Setup](./ALERTING.md)
