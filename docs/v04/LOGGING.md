# AFU-9 Logging Konzept

Dieses Dokument beschreibt das zentrale Logging-Konzept für AFU-9 v0.2, einschließlich strukturierter Logs, CloudWatch-Integration und Best Practices.

## Überblick

AFU-9 verwendet strukturierte JSON-Logs für alle Komponenten, um eine konsistente Observability über die gesamte Plattform zu gewährleisten. Alle Logs werden zentral in AWS CloudWatch Logs gespeichert und können über die Control Center UI, CLI oder direkt in CloudWatch durchsucht werden.

### Komponenten

1. **Control Center** (Next.js) - Strukturierte Logs mit Workflow-Kontext
2. **MCP Server** (Base, GitHub, Deploy, Observability) - Strukturierte Logs mit Request-Kontext
3. **Lambda Functions** (v0.1 Pipeline) - Strukturierte Logs mit Execution-Kontext

## Log Level Konventionen

AFU-9 verwendet standardisierte Log Level gemäß Best Practices:

### DEBUG
- **Verwendung**: Detaillierte Diagnoseinformationen für Entwicklung und Debugging
- **Produktion**: Kann über `AFU9_DEBUG_MODE` aktiviert werden
- **Beispiele**: 
  - Variablenwerte bei der Fehlersuche
  - Detaillierte Request/Response-Details
  - Interne Zustandsänderungen
  - MCP JSON-RPC Kommunikation
  - Workflow-Schritt Parameter-Substitution

```typescript
logger.debug('Processing workflow step', { 
  stepId: 'analyze-code',
  inputData: {...}
});
```

**Debug Mode aktivieren**:
```bash
# Umgebungsvariable setzen
AFU9_DEBUG_MODE=true

# Debug Mode kann auch in Production aktiviert werden für Troubleshooting
# Standardmäßig: an in development, aus in production
```

**Debug Mode über API abfragen**:
```bash
curl http://localhost:3000/api/system/config
# Zeigt: { "system": { "debugMode": true, ... } }
```

**Was wird im Debug Mode geloggt**:
- **Workflow Engine**: Step-Parameter vor/nach Substitution, Condition-Evaluierung, Context-Updates
- **Agent Runner**: LLM Requests/Responses, Tool-Call Details, Iterationen
- **MCP Client**: Raw JSON-RPC Requests/Responses, Retry-Versuche, Fehlerdetails

### INFO
- **Verwendung**: Allgemeine Informationen über normale Operationen
- **Produktion**: Aktiv
- **Beispiele**:
  - Start/Ende von Operationen
  - Erfolgreiche API-Calls
  - Workflow-Fortschritt

```typescript
logger.info('Workflow started', { 
  workflowId: 'wf-123',
  executionId: 'exec-456'
});
```

### WARN
- **Verwendung**: Potentiell problematische Situationen, die keine sofortigen Fehler verursachen
- **Produktion**: Aktiv
- **Beispiele**:
  - Deprecated Feature-Verwendung
  - Rate Limits sich nähern
  - Retry-Versuche

```typescript
logger.warn('GitHub API rate limit approaching', { 
  remaining: 50,
  limit: 5000
});
```

### ERROR
- **Verwendung**: Fehler, die die aktuelle Operation beeinträchtigen, aber die Anwendung weiterlaufen lassen
- **Produktion**: Aktiv, mit Stack Trace (optional in Production)
- **Beispiele**:
  - API-Fehler
  - Validierungsfehler
  - Externe Service-Ausfälle

```typescript
logger.error('Failed to create pull request', error, { 
  repo: 'owner/repo',
  branchName: 'feature/xyz'
});
```

## Log Format

### Standard JSON Schema

Alle Logs folgen einem einheitlichen JSON-Schema:

```json
{
  "timestamp": "2025-12-12T17:00:00.000Z",
  "level": "INFO",
  "service": "mcp-github",
  "component": "tool-handler",
  "message": "GitHub issue fetched successfully",
  "context": {
    "requestId": "req-1702396800-abc123",
    "tool": "getIssue",
    "owner": "adaefler-art",
    "repo": "codefactory-control",
    "issueNumber": 42,
    "duration": 234
  },
  "error": {
    "name": "GitHubAPIError",
    "message": "API rate limit exceeded",
    "stack": "Error: API rate limit exceeded\n    at ...",
    "code": "RATE_LIMIT"
  }
}
```

### Felder-Beschreibungen

| Feld | Typ | Beschreibung | Erforderlich |
|------|-----|--------------|--------------|
| `timestamp` | string (ISO 8601) | Zeitstempel des Log-Eintrags | Ja |
| `level` | string | Log Level (DEBUG, INFO, WARN, ERROR) | Ja |
| `service` | string | Service-Name (control-center, mcp-github, etc.) | Ja |
| `component` | string | Komponente innerhalb des Service | Nein |
| `message` | string | Menschenlesbare Beschreibung | Ja |
| `context` | object | Zusätzliche kontextuelle Informationen | Nein |
| `error` | object | Fehlerdetails mit name, message, stack | Nur bei ERROR |

### Context-Felder

Typische Context-Felder je nach Komponente:

**Control Center:**
- `workflowId` - Eindeutige Workflow-ID
- `executionId` - Ausführungs-ID
- `stepId` - Workflow-Step-ID
- `agentRunId` - Agent Runner ID
- `userId` - Benutzer-ID

**MCP Server:**
- `requestId` - Request-ID für Request-Tracking
- `tool` - Aufgerufenes MCP-Tool
- `method` - JSON-RPC-Methode
- `duration` - Ausführungszeit in Millisekunden

**Lambda Functions:**
- `executionArn` - Step Functions Execution ARN
- `issueNumber` - GitHub Issue Nummer
- `repo` - Repository (owner/repo)
- `githubRunId` - GitHub Actions Run ID

## Implementierung

### Control Center (Next.js)

Der Control Center verwendet bereits einen strukturierten Logger:

```typescript
import { logger } from '@/lib/logger';

// Komponenten-spezifischer Logger
const log = logger.withComponent('workflow-engine');

// Info logging mit Context
log.info('Workflow started', {
  workflowId: 'wf-123',
  executionId: 'exec-456',
  userId: 'user-789'
});

// Error logging mit vollem Context
try {
  await executeWorkflow();
} catch (error) {
  log.error('Workflow execution failed', error, {
    workflowId: 'wf-123',
    executionId: 'exec-456',
    step: 'create_pr'
  });
}

// Timed operations
const start = Date.now();
await performOperation();
log.timed('Operation completed', Date.now() - start, {
  workflowId: 'wf-123'
});
```

### MCP Server

MCP Server erben vom Base-Server, der automatisch strukturiertes Logging bereitstellt:

```typescript
import { MCPServer } from '../../base/src/server';

export class GitHubMCPServer extends MCPServer {
  constructor(port: number = 3001) {
    super(port, 'mcp-github');
    // this.logger ist automatisch verfügbar
  }

  private async getIssue(args: any) {
    this.logger.info('Fetching GitHub issue', { 
      owner: args.owner, 
      repo: args.repo, 
      issueNumber: args.number 
    });

    try {
      const result = await this.octokit.rest.issues.get(args);
      this.logger.info('Successfully fetched issue', { 
        issueNumber: args.number,
        state: result.data.state 
      });
      return result;
    } catch (error) {
      this.logger.error('Failed to fetch issue', error, { 
        owner: args.owner,
        repo: args.repo,
        issueNumber: args.number 
      });
      throw error;
    }
  }
}
```

### Lambda Functions

Lambda Functions verwenden einen dedizierten Lambda Logger:

```typescript
import { LambdaLogger } from './logger';

const logger = new LambdaLogger('afu9-orchestrator');

export const handler = async (event: GithubPayload) => {
  logger.info('AFU-9 Orchestrator started', { 
    repo: event.repo,
    ref: event.ref,
    issueNumber: event.issueNumber,
    githubRunId: event.githubRunId
  });

  try {
    // Perform operation
    const result = await startStateMachine(event);
    
    logger.info('State machine started successfully', { 
      executionArn: result.executionArn,
      repo: event.repo,
      issueNumber: event.issueNumber
    });

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    logger.error('Failed to start state machine', error, {
      repo: event.repo,
      issueNumber: event.issueNumber
    });
    throw error;
  }
};
```

## CloudWatch Integration

### Log Groups

AFU-9 verwendet separate CloudWatch Log Groups für jede Komponente:

| Komponente | Log Group Name | Retention |
|------------|----------------|-----------|
| Control Center | `/ecs/afu9/control-center` | 7 Tage |
| MCP GitHub | `/ecs/afu9/mcp-github` | 7 Tage |
| MCP Deploy | `/ecs/afu9/mcp-deploy` | 7 Tage |
| MCP Observability | `/ecs/afu9/mcp-observability` | 7 Tage |
| Lambda Orchestrator | `/aws/lambda/afu9-orchestrator` | 7 Tage |
| Lambda Issue Interpreter | `/aws/lambda/afu9-issue-interpreter` | 7 Tage |
| Lambda Patch Generator | `/aws/lambda/afu9-patch-generator` | 7 Tage |
| Lambda PR Creator | `/aws/lambda/afu9-pr-creator` | 7 Tage |

### Log Retention

Die Standard-Retention ist auf 7 Tage eingestellt, um Kosten zu optimieren. Für Production kann dies angepasst werden:

```typescript
// In afu9-ecs-stack.ts
const controlCenterLogGroup = new logs.LogGroup(this, 'ControlCenterLogGroup', {
  logGroupName: '/ecs/afu9/control-center',
  retention: logs.RetentionDays.ONE_MONTH, // Anpassen nach Bedarf
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

### Logs Suchen

#### Via Control Center UI

Die Control Center UI bietet eine Observability-Seite unter `/observability`:

1. **Log Group auswählen** - Wählen Sie die gewünschte Komponente
2. **Zeitbereich festlegen** - 1 Stunde, 6 Stunden, 24 Stunden
3. **Filter Pattern eingeben** - z.B. `ERROR`, `workflowId`, `issueNumber`
4. **Ergebnisse durchsuchen** - Strukturierte Darstellung mit Timestamp und Message

#### Via AWS CLI

Logs in Echtzeit verfolgen:

```bash
# Alle ERROR-Logs im Control Center
aws logs tail /ecs/afu9/control-center --follow --filter-pattern ERROR

# Logs für eine spezifische Workflow-ID
aws logs tail /ecs/afu9/control-center --follow --filter-pattern "wf-123"

# Alle Logs eines MCP Servers
aws logs tail /ecs/afu9/mcp-github --follow
```

Historische Logs abfragen:

```bash
# Letzte 1 Stunde
aws logs filter-log-events \
  --log-group-name /ecs/afu9/control-center \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern ERROR

# Mit spezifischem Pattern
aws logs filter-log-events \
  --log-group-name /ecs/afu9/mcp-github \
  --filter-pattern '{ $.level = "ERROR" && $.context.tool = "getIssue" }'
```

#### Via CloudWatch Logs Insights

Erweiterte Queries mit CloudWatch Logs Insights:

```sql
-- Alle ERROR-Logs der letzten Stunde
fields @timestamp, service, message, context.workflowId, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 20

-- Durchschnittliche Tool-Ausführungszeit
fields @timestamp, context.tool, context.duration
| filter context.tool = "getIssue"
| stats avg(context.duration) as avg_duration by context.tool

-- Fehlerhafte Workflows identifizieren
fields @timestamp, context.workflowId, message, error.message
| filter level = "ERROR" and context.workflowId != null
| stats count() by context.workflowId
| sort count desc
```

### MCP Observability Server

Der MCP Observability Server stellt das Tool `logs.search` bereit:

```typescript
// Über MCP Client
const result = await mcpClient.callTool('logs.search', {
  logGroupName: '/ecs/afu9/control-center',
  filterPattern: 'ERROR',
  startTime: Date.now() - 3600000, // 1 Stunde
  endTime: Date.now(),
  limit: 100
});
```

Response Format:

```json
{
  "events": [
    {
      "timestamp": 1702396800000,
      "message": "{\"level\":\"ERROR\",\"service\":\"control-center\",\"message\":\"Workflow failed\",\"context\":{\"workflowId\":\"wf-123\"}}",
      "logStreamName": "ecs/control-center/task-abc123"
    }
  ],
  "searchedLogStreams": [...],
  "nextToken": "..." // Für Pagination
}
```

## Filter Patterns

### Einfache Patterns

```bash
# Alle ERROR-Logs
ERROR

# Spezifische Workflow-ID
wf-123

# Spezifischer Benutzer
user-789

# Issue Number
"issueNumber":42
```

### JSON Filter Patterns

CloudWatch unterstützt JSON-basierte Filter für strukturierte Logs:

```bash
# Alle ERROR-Level Logs
{ $.level = "ERROR" }

# Fehler bei spezifischem Tool
{ $.level = "ERROR" && $.context.tool = "getIssue" }

# Workflow-Fehler
{ $.level = "ERROR" && $.context.workflowId = "wf-123" }

# Langsame Operationen (> 5 Sekunden)
{ $.context.duration > 5000 }

# Spezifischer HTTP Status Code
{ $.error.code = "404" }
```

### Pattern Kombinationen

```bash
# ERROR oder WARN
{ $.level = "ERROR" || $.level = "WARN" }

# Fehler in GitHub oder Deploy Server
{ $.level = "ERROR" && ($.service = "mcp-github" || $.service = "mcp-deploy") }

# Lange laufende Workflows mit Fehlern
{ $.level = "ERROR" && $.context.workflowId = * && $.context.duration > 60000 }
```

## Best Practices

### 1. Konsistente Context-Felder

Verwenden Sie konsistente Feldnamen für Context-Daten:

```typescript
// Gut ✅
logger.info('Processing issue', { 
  issueNumber: 42,
  repo: 'owner/repo'
});

// Schlecht ❌
logger.info('Processing issue', { 
  issue_num: 42,
  repository: 'owner/repo'
});
```

### 2. Strukturierte Nachrichten

Schreiben Sie klare, aktionsorientierte Nachrichten:

```typescript
// Gut ✅
logger.info('Pull request created successfully', { prNumber: 123 });

// Schlecht ❌
logger.info('PR creation finished', { pr: 123 });
```

### 3. Sensitive Daten vermeiden

Loggen Sie niemals sensitive Daten:

```typescript
// Gut ✅
logger.info('User authenticated', { userId: 'user-123' });

// Schlecht ❌
logger.info('User authenticated', { 
  userId: 'user-123',
  token: '<REDACTED_GITHUB_TOKEN>',
  password: '...'
});
```

### 4. Fehler-Context bereitstellen

Geben Sie bei Fehlern immer genug Context für Debugging:

```typescript
// Gut ✅
logger.error('Failed to fetch issue', error, {
  owner: 'org',
  repo: 'repo',
  issueNumber: 42,
  attemptNumber: 3
});

// Schlecht ❌
logger.error('Failed', error);
```

### 5. Timed Operations für Performance

Loggen Sie Performance-kritische Operationen mit Timing:

```typescript
const start = Date.now();
try {
  await expensiveOperation();
  logger.timed('Operation completed', Date.now() - start, {
    operationType: 'github-clone'
  });
} catch (error) {
  logger.error('Operation failed', error, {
    duration: Date.now() - start
  });
}
```

### 6. Request-IDs für Tracing

Verwenden Sie Request-IDs für End-to-End Tracing:

```typescript
// Generate request ID at entry point
const requestId = `req-${Date.now()}-${generateRandomId()}`;

// Pass through all operations
logger.info('Starting workflow', { requestId });
await step1(requestId);
await step2(requestId);
logger.info('Workflow completed', { requestId });
```

## Troubleshooting

### Häufige Log-Patterns

#### Workflow-Fehler identifizieren

```sql
fields @timestamp, context.workflowId, message, error.message
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

#### GitHub API Rate Limits

```sql
fields @timestamp, message, context.remaining, context.limit
| filter message like /rate limit/
| sort @timestamp desc
```

#### Lange laufende Operationen

```sql
fields @timestamp, message, context.duration
| filter context.duration > 5000
| sort context.duration desc
```

#### Fehlerhafte MCP Tool-Calls

```sql
fields @timestamp, context.tool, message, error.message
| filter level = "ERROR" and context.tool != null
| stats count() by context.tool
| sort count desc
```

### Debug-Modus aktivieren

Für lokale Entwicklung können Sie DEBUG-Logs aktivieren:

```bash
# Development mode
NODE_ENV=development npm run dev

# DEBUG-Logs werden automatisch geloggt
```

In Production sind DEBUG-Logs deaktiviert, um Log-Volumen zu reduzieren.

## Monitoring und Alerting

### CloudWatch Alarms

Erstellen Sie Alarms für kritische Fehler:

```typescript
// In afu9-alarms-stack.ts
const errorAlarm = new cloudwatch.Alarm(this, 'HighErrorRate', {
  metric: logGroup.metricFilterLogEvents({
    filterPattern: '{ $.level = "ERROR" }',
    metricName: 'ErrorCount',
    metricNamespace: 'AFU9/Logs',
  }),
  threshold: 10,
  evaluationPeriods: 1,
  alarmDescription: 'High error rate in Control Center',
});
```

### Metric Filters

Erstellen Sie Metric Filters für wichtige Log-Patterns:

```typescript
// ERROR Count Metric
new logs.MetricFilter(this, 'ErrorMetric', {
  logGroup: controlCenterLogGroup,
  filterPattern: logs.FilterPattern.literal('{ $.level = "ERROR" }'),
  metricNamespace: 'AFU9/Logs',
  metricName: 'ErrorCount',
  metricValue: '1',
});
```

## Kosten-Optimierung

### Log-Volumen reduzieren

1. **DEBUG-Logs in Production deaktivieren** - Automatisch durch `IS_PRODUCTION` Flag
2. **Log Retention anpassen** - Standard 7 Tage, für weniger wichtige Logs kürzer
3. **Sampling für hohe Frequenz** - Bei sehr hohem Durchsatz Sampling verwenden
4. **Alte Logs archivieren** - Nach S3 exportieren für Langzeitaufbewahrung

```bash
# Logs nach S3 exportieren
aws logs create-export-task \
  --log-group-name /ecs/afu9/control-center \
  --from $(date -u -d '30 days ago' +%s)000 \
  --to $(date -u -d '7 days ago' +%s)000 \
  --destination afu9-logs-archive \
  --destination-prefix control-center/
```

### CloudWatch Insights Kosten

CloudWatch Logs Insights berechnet nach Datenmenge. Optimieren Sie Queries:

1. **Zeitbereich einschränken** - Nur notwendigen Zeitraum abfragen
2. **Filter früh anwenden** - Reduziert gescannte Datenmenge
3. **Limit verwenden** - Begrenzt zurückgegebene Ergebnisse

## Compliance und Audit

### Audit Logs

Für Compliance können bestimmte Logs länger aufbewahrt werden:

```typescript
const auditLogGroup = new logs.LogGroup(this, 'AuditLogs', {
  logGroupName: '/ecs/afu9/audit',
  retention: logs.RetentionDays.ONE_YEAR,
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Logs bleiben bei Stack-Deletion
});
```

### CloudTrail Integration

CloudTrail loggt alle AWS API-Calls:

- Secrets Manager Zugriffe
- CloudWatch Logs Zugriffe
- IAM Role Assumptions

## Weiterführende Dokumentation

- [Observability Guide](OBSERVABILITY.md) - Umfassendes Observability-Konzept
- [CloudWatch Logs User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/WhatIsCloudWatchLogs.html)
- [CloudWatch Logs Insights Query Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [JSON Filter Pattern](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html#matching-terms-json-log-events)

## Support

Bei Fragen oder Problemen:
- Platform Team: ops@yourdomain.com
- Interne Dokumentation: Confluence
- Emergency: Follow runbook escalation path
