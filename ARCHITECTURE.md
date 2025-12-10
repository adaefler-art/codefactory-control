# Architecture Documentation - AFU-9 CodeFactory Control

## System Overview

AFU-9 ist eine vollautomatische Code-Fabrikationsplattform, die auf AWS serverless Technologien basiert und mit GitHub integriert ist.

## Architekturdiagramm

```
┌─────────────────────────────────────────────────────────────────────┐
│                           GitHub Repository                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Issues  │  │   PRs    │  │   Code   │  │ CI/CD    │           │
│  └────┬─────┘  └────▲─────┘  └────▲─────┘  └────┬─────┘           │
│       │             │             │             │                   │
└───────┼─────────────┼─────────────┼─────────────┼───────────────────┘
        │             │             │             │
        │ Webhook     │ API         │ API         │ Webhook
        │             │             │             │
┌───────▼─────────────┴─────────────┴─────────────▼───────────────────┐
│                         AWS Cloud                                    │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                   API Gateway                              │    │
│  │              (Webhook Endpoint)                            │    │
│  └──────────────────────┬─────────────────────────────────────┘    │
│                         │                                           │
│  ┌──────────────────────▼─────────────────────────────────────┐    │
│  │            Lambda: Webhook Handler                          │    │
│  │         (Issue Analysis Handler)                            │    │
│  └──────────────────────┬─────────────────────────────────────┘    │
│                         │ Trigger                                   │
│                         │                                           │
│  ┌──────────────────────▼─────────────────────────────────────┐    │
│  │          AWS Step Functions Workflow                        │    │
│  │                                                             │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │    │
│  │  │  Analyze     │→ │  Generate    │→ │  Create PR   │    │    │
│  │  │  Issue       │  │  Patch       │  │              │    │    │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │    │
│  │         │                  │                  │            │    │
│  │    ┌────▼────┐        ┌───▼────┐        ┌───▼────┐       │    │
│  │    │ Lambda  │        │ Lambda │        │ Lambda │       │    │
│  │    │ Issue   │        │ Patch  │        │   PR   │       │    │
│  │    │Interpret│        │  Gen   │        │ Creator│       │    │
│  │    └─────────┘        └────────┘        └────────┘       │    │
│  │                                              │            │    │
│  │  ┌──────────────┐  ┌──────────────┐        │            │    │
│  │  │  Wait for    │→ │  Process CI  │←───────┘            │    │
│  │  │  CI Checks   │  │  Feedback    │                     │    │
│  │  └──────────────┘  └──────┬───────┘                     │    │
│  │                           │                              │    │
│  │                      ┌────▼────┐                         │    │
│  │                      │ Lambda  │                         │    │
│  │                      │   CI    │                         │    │
│  │                      │Feedback │                         │    │
│  │                      └─────────┘                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           AWS Secrets Manager                            │    │
│  │    ┌──────────────────────────────────┐                 │    │
│  │    │  GitHub App Private Key          │                 │    │
│  │    └──────────────────────────────────┘                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           CloudWatch Logs & Monitoring                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Komponenten

### 1. API Gateway
- **Zweck**: Webhook Endpoint für GitHub Events
- **Endpoints**: `/webhook` (POST)
- **Sicherheit**: Webhook-Signatur-Verifizierung

### 2. Lambda Functions

#### Webhook Handler
- **Trigger**: API Gateway
- **Funktion**: Webhook empfangen, verifizieren, Step Function starten
- **Runtime**: Node.js 18
- **Timeout**: 30s

#### Issue Interpreter
- **Trigger**: Step Functions
- **Funktion**: Issue analysieren, Typ bestimmen, Priorität setzen
- **Runtime**: Node.js 18
- **Timeout**: 30s

#### Patch Generator
- **Trigger**: Step Functions
- **Funktion**: Code-Patch generieren, Validieren
- **Runtime**: Node.js 18
- **Timeout**: 60s

#### PR Creator
- **Trigger**: Step Functions
- **Funktion**: Branch erstellen, Änderungen committen, PR erstellen
- **Runtime**: Node.js 18
- **Timeout**: 60s

#### CI Feedback Handler
- **Trigger**: Step Functions
- **Funktion**: CI-Status prüfen, Feedback verarbeiten, Auto-Merge
- **Runtime**: Node.js 18
- **Timeout**: 30s

### 3. Step Functions State Machine

**Workflow-States**:

1. **AnalyzeIssue**: Issue-Analyse durchführen
2. **CheckIfActionable**: Prüfen ob actionable
3. **GeneratePatch**: Patch generieren (bei actionable)
4. **ValidatePatch**: Patch validieren
5. **CreatePullRequest**: PR erstellen (bei validem Patch)
6. **WaitForCI**: Auf CI-Checks warten (60s)
7. **ProcessCIFeedback**: CI-Feedback verarbeiten
8. **CheckCIStatus**: Status prüfen und entscheiden
   - Success → Auto-Merge
   - Failure → Feedback-Kommentar
   - Pending → Zurück zu WaitForCI

### 4. AWS Secrets Manager

**Gespeicherte Secrets**:
- GitHub App Private Key
- (Zukünftig) weitere API-Keys

### 5. CloudWatch

**Logging**:
- Lambda Execution Logs
- Step Functions Execution History
- API Gateway Access Logs

**Metriken**:
- Lambda-Invocations
- Lambda-Errors
- Step Functions Executions
- API Gateway Requests

## Datenfluss

### Issue-zu-PR Workflow

```
1. Developer erstellt Issue in GitHub
      ↓
2. GitHub sendet Webhook an API Gateway
      ↓
3. Webhook Handler empfängt und verifiziert
      ↓
4. Step Functions Workflow startet
      ↓
5. Issue Interpreter analysiert Issue
      ↓
6. Patch Generator erstellt Patch-Plan
      ↓
7. PR Creator erstellt Branch & PR
      ↓
8. CI/CD Pipeline läuft
      ↓
9. CI Feedback Handler überwacht Status
      ↓
10. Bei Success: Auto-Merge
    Bei Failure: Feedback-Kommentar
```

## Sicherheitsarchitektur

### Secrets Management
- ✅ Keine Hardcoded Secrets
- ✅ AWS Secrets Manager für Private Keys
- ✅ Environment Variables für Konfiguration
- ✅ IAM Roles für Service-to-Service Auth

### IAM-Berechtigungen

**Lambda Execution Role**:
```
- AWSLambdaBasicExecutionRole (CloudWatch Logs)
- SecretsManager:GetSecretValue (für GitHub Key)
- States:StartExecution (für Step Functions)
```

**Step Functions Role**:
```
- Lambda:InvokeFunction (für alle Lambdas)
```

### Network Security
- API Gateway mit HTTPS
- Webhook-Signatur-Verifizierung
- Private Secrets in Secrets Manager
- VPC-Integration (optional für zusätzliche Isolation)

## Skalierung & Performance

### Auto-Scaling
- Lambda: Automatisch (bis 1000 concurrent executions)
- API Gateway: Automatisch (10.000 requests/second)
- Step Functions: Unbegrenzte parallel executions

### Performance-Optimierungen
- Secret Caching in Lambda (reduziert API-Calls)
- Asynchrone Verarbeitung via Step Functions
- Retry-Logik für transiente Fehler

## Kosten-Optimierung

### Lambda
- ARM-basierte Lambdas (Graviton2)
- Angemessene Memory-Allocation
- Timeout-Optimierung

### Logs
- Log Retention Policy (7-30 Tage)
- Log-Level Konfiguration (ERROR in Production)

### Step Functions
- Express Workflows für High-Throughput (optional)
- Batch-Processing wo möglich

## Monitoring & Alerting

### CloudWatch Dashboards
- Lambda Execution Metrics
- Step Functions Success Rate
- API Gateway Latency
- Error Rates

### CloudWatch Alarms
- Lambda-Fehlerrate > 5%
- Step Functions Failed Executions
- API Gateway 5xx Errors
- Secrets Manager Access Failures

## Disaster Recovery

### Backup-Strategie
- Infrastructure as Code (CDK)
- Secrets in Secrets Manager (automatisches Backup)
- CloudFormation Stack Exports

### Recovery
1. Stack neu deployen via CDK
2. Secrets aus Backup wiederherstellen
3. GitHub Webhook URL aktualisieren

### RTO/RPO
- **RTO** (Recovery Time Objective): < 30 Minuten
- **RPO** (Recovery Point Objective): Near-zero (Stateless)

## Erweiterbarkeit

### Geplante Features
- [ ] Multi-Repository-Support
- [ ] Advanced AI-basierte Patch-Generierung
- [ ] Code-Review-Integration
- [ ] Metriken-Dashboard
- [ ] Slack/Teams-Benachrichtigungen

### Integration-Punkte
- GitHub API
- AWS Services (Lambda, Step Functions, Secrets Manager)
- (Zukünftig) OpenAI API für Code-Generierung
- (Zukünftig) Slack/Teams APIs
