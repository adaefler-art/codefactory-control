# codefactory-control

Zentrale Orchestrierungs- und Control-Plane für die autonome Software-Fabrik AFU-9. Steuert Agenten, Workflows und GitHub-Integrationen für vollautomatische Code-Erzeugung, Bugfixing und CI-basierte Self-Healing-Prozesse.

## 🎯 Überblick

AFU-9 (Autonomous Fabrication Unit) ist eine vollautomatische Code-Fabrikationsplattform, die GitHub-Issues analysiert, Code-Patches generiert, Pull Requests erstellt und CI-Feedback verarbeitet.

## 🏗️ Architektur

### Modulare Komponenten

#### 1. Issue Interpreter
- **Zweck**: Analysiert GitHub-Issues und extrahiert actionable Tasks
- **Funktionen**:
  - Issue-Typ-Erkennung (Bug, Feature, Enhancement)
  - Prioritätsbestimmung
  - Komplexitätsschätzung
  - Lösungsansatz-Vorschläge
- **Modul**: `src/issue-interpreter/`

#### 2. Patch Generator
- **Zweck**: Generiert Code-Patches basierend auf Issue-Analyse
- **Funktionen**:
  - Patch-Plan-Erstellung
  - Branch-Naming
  - Test-Strategie-Definition
  - Patch-Validierung
- **Modul**: `src/patch-generator/`

#### 3. PR Orchestrator
- **Zweck**: Verwaltet Pull Requests und CI-Feedback
- **Funktionen**:
  - PR-Erstellung und -Aktualisierung
  - CI-Feedback-Verarbeitung
  - Auto-Merge bei erfolgreichen Checks
  - Fehleranalyse und Korrekturvorschläge
- **Modul**: `src/pr-orchestrator/`

### AWS Lambda Functions

1. **Issue Analysis Handler**: Webhook-Empfang und Workflow-Initiierung
2. **Patch Generation Handler**: Patch-Generierung
3. **PR Creation Handler**: Pull-Request-Erstellung
4. **CI Feedback Handler**: CI-Feedback-Verarbeitung

### Step Functions Workflow

Der Workflow orchestriert den gesamten Prozess:

```
GitHub Issue → Analyse → Patch-Generierung → PR-Erstellung → CI-Checks → Auto-Merge
```

**Workflow-Schritte**:
1. `AnalyzeIssue`: Issue analysieren
2. `CheckIfActionable`: Prüfen ob actionable
3. `GeneratePatch`: Patch generieren
4. `ValidatePatch`: Patch validieren
5. `CreatePullRequest`: PR erstellen
6. `WaitForCI`: Auf CI-Checks warten
7. `ProcessCIFeedback`: CI-Feedback verarbeiten
8. `CheckCIStatus`: Status prüfen und Auto-Merge

## 🔒 Sicherheit

**KEINE HARDCODED SECRETS!**

- Alle Secrets werden in AWS Secrets Manager gespeichert
- GitHub Private Keys über `GITHUB_PRIVATE_KEY_SECRET_ARN`
- Webhook Secrets als Umgebungsvariablen
- IAM-Rollen mit minimalen Berechtigungen

## 🚀 Setup & Deployment

### Voraussetzungen

```bash
# Node.js und npm
node --version  # v18+
npm --version

# AWS CLI konfiguriert
aws configure

# AWS CDK
npm install -g aws-cdk
```

### Installation

```bash
# Dependencies installieren
npm install

# TypeScript kompilieren
npm run build

# CDK Bootstrap (einmalig pro AWS Account/Region)
cdk bootstrap

# Stack deployen
npm run deploy
```

### GitHub App Setup

1. GitHub App erstellen mit Permissions:
   - Issues: Read & Write
   - Pull Requests: Read & Write
   - Contents: Read & Write
   - Checks: Read

2. Private Key generieren und in AWS Secrets Manager speichern:
```bash
aws secretsmanager create-secret \
  --name codefactory/github-private-key \
  --secret-string file://github-private-key.pem
```

3. Environment Variables setzen:
```bash
export GITHUB_APP_ID="your-app-id"
export GITHUB_WEBHOOK_SECRET="your-webhook-secret"
export GITHUB_INSTALLATION_ID="your-installation-id"
```

4. Webhook URL in GitHub App konfigurieren (aus CDK Output)

## 💻 Entwicklung

### Build

```bash
npm run build
```

### Tests ausführen

```bash
npm test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### CDK Synth (CloudFormation Template generieren)

```bash
npm run synth
```

## 📦 Projektstruktur

```
codefactory-control/
├── src/
│   ├── config/              # Konfigurationsmanagement
│   │   └── config-manager.ts
│   ├── issue-interpreter/   # Issue-Analyse-Modul
│   │   └── issue-interpreter.ts
│   ├── patch-generator/     # Patch-Generierungs-Modul
│   │   └── patch-generator.ts
│   ├── pr-orchestrator/     # PR-Management-Modul
│   │   └── pr-orchestrator.ts
│   ├── github/              # GitHub-Integration
│   │   └── github-client.ts
│   ├── lambdas/             # Lambda Handler
│   │   ├── issue-analysis-handler.ts
│   │   ├── patch-generation-handler.ts
│   │   ├── pr-creation-handler.ts
│   │   └── ci-feedback-handler.ts
│   ├── step-functions/      # Workflow-Definitionen
│   │   └── workflow-definition.ts
│   ├── cdk-app.ts          # CDK App Entry Point
│   └── index.ts            # Main Export
├── lib/
│   └── codefactory-stack.ts # CDK Stack Definition
├── package.json
├── tsconfig.json
├── jest.config.js
└── cdk.json
```

## 🔄 Workflow-Beispiel

1. **Issue erstellt** in GitHub Repository
2. **Webhook** triggert `issue-analysis-handler`
3. **Step Functions Workflow** startet:
   - Issue wird analysiert
   - Patch wird generiert
   - Branch wird erstellt
   - PR wird erstellt
   - CI-Checks werden überwacht
   - Bei Success: Auto-Merge
   - Bei Failure: Feedback-Kommentar

## 🛠️ Konfiguration

### Umgebungsvariablen

- `AWS_REGION`: AWS Region (default: us-east-1)
- `GITHUB_APP_ID`: GitHub App ID
- `GITHUB_WEBHOOK_SECRET`: Webhook Secret
- `GITHUB_PRIVATE_KEY_SECRET_ARN`: ARN des Secrets mit Private Key
- `GITHUB_INSTALLATION_ID`: Installation ID der GitHub App
- `STEP_FUNCTION_ARN`: ARN der Step Functions State Machine

## 📊 Monitoring

Die Plattform nutzt AWS CloudWatch für:
- Lambda-Logs
- Step Functions Execution History
- API Gateway Access Logs
- Metriken und Alarme

## 🤝 Beitragen

Dieses Projekt folgt dem Prinzip der autonomen Code-Fabrikation. Issues werden automatisch verarbeitet!

## 📄 Lizenz

MIT License
