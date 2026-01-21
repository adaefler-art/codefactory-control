# AFU-9 Deploy Memory

Persist, classify, and remediate recurring AWS/CDK deploy failures with deterministic recommendations.

## Overview

Deploy Memory is a pattern-based failure classification system that:
- **Collects** failure signals from CloudFormation and CDK CLI output
- **Classifies** errors into known categories with confidence scoring
- **Recommends** remediation steps via playbooks
- **Persists** events to DynamoDB for historical analysis
- **Integrates** with CI/CD pipelines and verdict engines

## Features

- ✅ **Deterministic classification** - Same error produces same fingerprint
- ✅ **Pattern-based rules** - Detects 8+ common AWS/CDK failure modes
- ✅ **Factory actions** - WAIT_AND_RETRY, OPEN_ISSUE, or HUMAN_REQUIRED
- ✅ **Markdown playbooks** - Step-by-step remediation guides
- ✅ **DynamoDB persistence** - Track recurring failures over time
- ✅ **CLI tool** - Standalone analysis for troubleshooting
- ✅ **No network calls** - Besides AWS SDK for CloudFormation/DynamoDB
- ✅ **Fully tested** - 48 unit tests covering all patterns

## Installation

```bash
cd packages/deploy-memory
npm install
npm run build
```

## Quick Start

### CLI Usage

```bash
# Analyze a CloudFormation stack
npx ts-node bin/afu9-deploy-memory-analyze.ts \
  --stack-name MyStack \
  --region eu-central-1

# Analyze CDK output
npx ts-node bin/afu9-deploy-memory-analyze.ts \
  --cdk-log deploy.log
```

### Programmatic Usage

```typescript
import {
  collectCfnFailureSignals,
  classifyFailure,
  getPlaybook,
  determineFactoryAction,
} from '@codefactory/deploy-memory';

// Collect signals from CloudFormation
const signals = await collectCfnFailureSignals({
  stackName: 'MyStack',
  region: 'eu-central-1',
});

// Classify the failure
const classification = classifyFailure(signals);

// Get remediation playbook
const playbook = getPlaybook(classification.errorClass);

// Determine recommended action
const action = determineFactoryAction(
  classification.errorClass,
  classification.confidence
);

console.log(`Error: ${classification.errorClass}`);
console.log(`Action: ${action}`);
console.log(`Steps:\n${playbook.steps}`);
```

## Detected Error Classes

| Error Class | Description | Factory Action |
|------------|-------------|----------------|
| `ACM_DNS_VALIDATION_PENDING` | ACM certificate waiting for DNS validation | WAIT_AND_RETRY |
| `ROUTE53_DELEGATION_PENDING` | NS records not configured in parent domain | HUMAN_REQUIRED |
| `CFN_IN_PROGRESS_LOCK` | Stack operation already in progress | WAIT_AND_RETRY |
| `CFN_ROLLBACK_LOCK` | Stack rolling back from failure | OPEN_ISSUE |
| `MISSING_SECRET` | AWS Secrets Manager secret not found | OPEN_ISSUE |
| `MISSING_ENV_VAR` | Required environment variable not set | OPEN_ISSUE |
| `DEPRECATED_CDK_API` | Using deprecated CDK constructs | OPEN_ISSUE |
| `UNIT_MISMATCH` | Configuration units incorrect (MB/MiB) | OPEN_ISSUE |
| `UNKNOWN` | Unclassified error | OPEN_ISSUE |

## Architecture

```
┌─────────────────┐
│   Collectors    │  Gather failure signals
├─────────────────┤
│ - CFN API       │  AWS SDK v3 CloudFormation
│ - CDK Parser    │  Regex-based log parsing
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Classifier    │  Pattern matching & fingerprinting
├─────────────────┤
│ - Error class   │  8+ predefined patterns
│ - Confidence    │  0.0 - 1.0 scoring
│ - Fingerprint   │  SHA-256 hash of normalized template
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Playbook     │  Remediation recommendations
├─────────────────┤
│ - Steps         │  Markdown formatted
│ - Action        │  WAIT_AND_RETRY / OPEN_ISSUE / HUMAN_REQUIRED
│ - Guardrails    │  Safety constraints
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  DynamoDB Store │  Historical tracking
├─────────────────┤
│ - Fingerprint   │  Partition key
│ - Timestamp     │  Sort key
│ - TTL: 90 days  │  Auto-cleanup
└─────────────────┘
```

## API Reference

### Collectors

#### `collectCfnFailureSignals(options)`

Collects failure signals from CloudFormation stack events.

**Parameters:**
- `stackName: string` - CloudFormation stack name
- `region?: string` - AWS region (default: us-east-1)
- `profile?: string` - AWS profile name
- `maxEvents?: number` - Max events to retrieve (default: 50)

**Returns:** `Promise<CfnFailureSignal[]>`

#### `collectCdkOutputSignals(logText)`

Parses CDK CLI output to extract failure signals.

**Parameters:**
- `logText: string` - CDK CLI output text

**Returns:** `CfnFailureSignal[]`

### Classifier

#### `classifyFailure(signals)`

Classifies deployment failure based on signal patterns.

**Parameters:**
- `signals: CfnFailureSignal[]` - Array of failure signals

**Returns:** `FailureClassification`

```typescript
interface FailureClassification {
  fingerprintId: string;      // Stable hash identifier
  errorClass: ErrorClass;     // Classified error type
  service: string;            // AWS service name
  confidence: number;         // 0.0 - 1.0
  tokens: string[];           // Extracted keywords
}
```

### Playbook

#### `getPlaybook(fingerprintOrClass)`

Retrieves remediation playbook for an error class or fingerprint.

**Parameters:**
- `fingerprintOrClass: string` - Error class or fingerprint ID

**Returns:** `Playbook`

```typescript
interface Playbook {
  fingerprintId: string;
  errorClass: ErrorClass;
  steps: string;                      // Markdown formatted
  proposedFactoryAction: FactoryAction;
  guardrails: string[];
}
```

#### `determineFactoryAction(errorClass, confidence)`

Determines recommended factory action based on classification.

**Parameters:**
- `errorClass: ErrorClass` - Classified error type
- `confidence: number` - Classification confidence

**Returns:** `FactoryAction` - One of: WAIT_AND_RETRY, OPEN_ISSUE, HUMAN_REQUIRED

### Store

#### `DeployMemoryStore`

DynamoDB client for persisting and querying deploy memory events.

```typescript
const store = new DeployMemoryStore('eu-central-1');

// Store event
await store.putEvent({
  fingerprintId: 'abc123',
  errorClass: 'ACM_DNS_VALIDATION_PENDING',
  service: 'ACM',
  confidence: 0.9,
  tokens: ['ACM', 'DNS', 'validation'],
  timestamp: new Date().toISOString(),
  stackName: 'MyStack',
  region: 'eu-central-1',
  rawSignals: JSON.stringify(signals),
});

// Query by fingerprint
const events = await store.queryByFingerprint('abc123', 50);

// Get statistics
const stats = await store.getEventStats('abc123');
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

All 48 tests validate:
- Pattern matching accuracy
- Fingerprint stability
- Playbook completeness
- CDK output parsing
- Error classification

## Integration

See [DEPLOY_MEMORY_INTEGRATION.md](../../docs/DEPLOY_MEMORY_INTEGRATION.md) for:
- GitHub Actions workflows
- Verdict engine integration
- Automation examples
- Best practices

## License

Part of the codefactory-control project.
