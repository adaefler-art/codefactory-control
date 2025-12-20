# AFU-9 Deploy Memory Integration Guide

This guide explains how to integrate AFU-9 Deploy Memory into your deployment pipelines.

## Overview

AFU-9 Deploy Memory automatically classifies deployment failures and provides remediation recommendations. It can be integrated into:
- GitHub Actions workflows
- AWS Step Functions (Verdict Engine)
- Manual troubleshooting via CLI

## CLI Usage

### Analyze CloudFormation Stack Failures

```bash
# Analyze a failed CloudFormation stack
npx ts-node bin/afu9-deploy-memory-analyze.ts \
  --stack-name Afu9NetworkStack \
  --region eu-central-1

# Output to file
npx ts-node bin/afu9-deploy-memory-analyze.ts \
  --stack-name Afu9NetworkStack \
  --region eu-central-1 \
  --output deploy-failure.json
```

### Analyze CDK Deploy Output

```bash
# Save CDK output to file during deployment
cdk deploy 2>&1 | tee deploy.log

# Analyze the log
npx ts-node bin/afu9-deploy-memory-analyze.ts \
  --cdk-log deploy.log
```

## GitHub Actions Integration

Add a failure analysis step to your deployment workflows:

```yaml
- name: Deploy CDK Stack
  id: deploy
  continue-on-error: true
  run: |
    npm run cdk deploy -- --all --require-approval never 2>&1 | tee deploy.log
    
- name: Analyze Deploy Failure
  if: steps.deploy.outcome == 'failure'
  run: |
    npx ts-node bin/afu9-deploy-memory-analyze.ts \
      --cdk-log deploy.log \
      --output deploy-failure.json
    
    # Display recommendation
    cat deploy-failure.json | jq -r '.recommendedSteps' >> $GITHUB_STEP_SUMMARY
    
- name: Create Issue for Deploy Failure
  if: steps.deploy.outcome == 'failure'
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const analysis = JSON.parse(fs.readFileSync('deploy-failure.json', 'utf8'));
      
      if (analysis.proposedFactoryAction === 'OPEN_ISSUE') {
        await github.rest.issues.create({
          owner: context.repo.owner,
          repo: context.repo.repo,
          title: `Deploy Failure: ${analysis.errorClass}`,
          body: `## Deploy Failure Analysis\n\n` +
                `**Error Class:** ${analysis.errorClass}\n` +
                `**Service:** ${analysis.service}\n` +
                `**Confidence:** ${analysis.confidence}\n` +
                `**Fingerprint:** ${analysis.fingerprintId}\n\n` +
                `## Recommended Steps\n\n${analysis.recommendedSteps}`,
          labels: ['deploy-failure', 'auto-generated']
        });
      }
```

## Verdict Engine Integration

Extend your verdict payload in Step Functions:

```typescript
import { 
  analyzeDeployFailure,
  extendVerdictWithDeployMemory 
} from './infra/lambdas/afu9_deploy_memory_integration';

// In your Lambda function
export const handler = async (event: any) => {
  let verdict = {
    repo: event.repo,
    targetBranch: event.targetBranch,
    issue: event.issue,
    classification: event.classification,
  };

  // Check if there's a deploy failure context
  if (event.deployFailure) {
    verdict = await extendVerdictWithDeployMemory(verdict, {
      stackName: event.deployFailure.stackName,
      region: event.deployFailure.region,
    });
  }

  return verdict;
};
```

### Verdict Payload Structure

When deploy memory is integrated, the verdict payload includes:

```typescript
interface VerdictPayload {
  repo: string;
  targetBranch: string;
  issue?: any;
  classification?: any;
  deployMemory?: {
    fingerprintId: string;
    proposedFactoryAction: 'WAIT_AND_RETRY' | 'OPEN_ISSUE' | 'HUMAN_REQUIRED';
    recommendedSteps: string;  // Markdown formatted
    confidence: number;
    errorClass: string;
  };
}
```

## Factory Actions

Deploy Memory recommends one of three factory actions:

### WAIT_AND_RETRY
Automatically retry after a delay. Used for:
- ACM DNS validation pending
- CloudFormation in-progress locks
- Temporary AWS service issues

### OPEN_ISSUE
Create a GitHub issue for investigation. Used for:
- CloudFormation rollback scenarios
- Missing secrets/configuration
- Deprecated API usage
- Unit mismatches

### HUMAN_REQUIRED
Requires manual intervention. Used for:
- Route53 delegation (requires registrar access)
- Complex configuration issues
- Unknown errors

## Error Classes

Deploy Memory detects and classifies these error patterns:

1. **ACM_DNS_VALIDATION_PENDING** - Certificate waiting for DNS validation
2. **ROUTE53_DELEGATION_PENDING** - NS records not configured
3. **CFN_IN_PROGRESS_LOCK** - Stack operation in progress
4. **CFN_ROLLBACK_LOCK** - Stack rolling back from failure
5. **MISSING_SECRET** - AWS Secrets Manager secret not found
6. **MISSING_ENV_VAR** - Required environment variable not set
7. **DEPRECATED_CDK_API** - Using deprecated CDK constructs
8. **UNIT_MISMATCH** - Configuration units incorrect (MB/MiB, s/ms)
9. **UNKNOWN** - Unclassified error

## DynamoDB Schema

Events are stored in the `afu9_deploy_memory` table:

```
Partition Key: pk (FINGERPRINT#<fingerprintId>)
Sort Key: sk (EVENT#<timestamp>)
TTL: 90 days

Attributes:
- fingerprintId
- errorClass
- service
- confidence
- tokens[]
- timestamp
- stackName
- region
- rawSignals (JSON)
```

## Querying Historical Data

```typescript
import { DeployMemoryStore } from './packages/deploy-memory/src/store';

const store = new DeployMemoryStore('eu-central-1');

// Get recent events for a fingerprint
const events = await store.queryByFingerprint('abc123def456', 50);

// Get statistics
const stats = await store.getEventStats('abc123def456');
console.log(`Total occurrences: ${stats.totalOccurrences}`);
console.log(`First seen: ${stats.firstSeen}`);
console.log(`Average confidence: ${stats.averageConfidence}`);
```

## Automation Example

Complete workflow with automatic retry logic:

```yaml
- name: Deploy with Retry Logic
  id: deploy-with-retry
  run: |
    MAX_RETRIES=3
    RETRY_DELAY=300  # 5 minutes
    
    for i in $(seq 1 $MAX_RETRIES); do
      echo "Deployment attempt $i of $MAX_RETRIES"
      
      if npm run cdk deploy -- --all --require-approval never 2>&1 | tee deploy.log; then
        echo "Deployment succeeded!"
        exit 0
      fi
      
      # Analyze failure
      npx ts-node bin/afu9-deploy-memory-analyze.ts \
        --cdk-log deploy.log \
        --output deploy-failure.json
      
      ACTION=$(cat deploy-failure.json | jq -r '.proposedFactoryAction')
      
      if [ "$ACTION" == "WAIT_AND_RETRY" ] && [ $i -lt $MAX_RETRIES ]; then
        echo "Deploy Memory recommends WAIT_AND_RETRY. Retrying in ${RETRY_DELAY}s..."
        sleep $RETRY_DELAY
      else
        echo "Deploy Memory recommends: $ACTION"
        exit 1
      fi
    done
```

## Best Practices

1. **Always persist events** - Keep `--no-persist` flag off in production
2. **Review recommendations** - Deploy Memory is deterministic but not perfect
3. **Monitor fingerprints** - Track recurring failures over time
4. **Update playbooks** - Extend pattern rules as new failure modes are discovered
5. **Fail-closed** - If analysis fails, treat as unknown error

## Extending Pattern Rules

To add new failure detection patterns, edit `packages/deploy-memory/src/classifier.ts`:

```typescript
{
  errorClass: 'MY_NEW_ERROR',
  service: 'AWS::Service::Name',
  patterns: [
    /error pattern regex/i,
    /another pattern/i,
  ],
  confidence: 0.9,
  tokens: ['keyword1', 'keyword2'],
}
```

Then add a playbook in `packages/deploy-memory/src/playbook.ts`.
