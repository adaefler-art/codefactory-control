/**
 * AFU-9 Deploy Memory - Playbook Management
 * 
 * Provides remediation playbooks for classified failures
 */

import { Playbook, ErrorClass, FactoryAction } from './types';

/**
 * Default playbooks for known error classes
 */
const DEFAULT_PLAYBOOKS: Record<ErrorClass, Playbook> = {
  ACM_DNS_VALIDATION_PENDING: {
    fingerprintId: 'acm-dns-validation',
    errorClass: 'ACM_DNS_VALIDATION_PENDING',
    proposedFactoryAction: 'WAIT_AND_RETRY',
    steps: `# ACM DNS Validation Pending

## Problem
ACM certificate is waiting for DNS validation to complete. This is a normal part of the certificate issuance process.

## Resolution Steps
1. **Verify DNS Records**: Check that the CNAME validation records are present in Route53 or your DNS provider
2. **Wait for Propagation**: DNS propagation can take 5-30 minutes
3. **Check Record Values**: Ensure the CNAME records match exactly what ACM requires
4. **Retry Deployment**: After DNS validation completes, retry the deployment

## Estimated Time
- Initial DNS propagation: 5-30 minutes
- Full validation: up to 72 hours (typically much faster)

## Automation
This can be automated with WAIT_AND_RETRY with exponential backoff:
- Initial retry: 5 minutes
- Subsequent retries: 15, 30, 60 minutes
- Max retries: 8 (within 3 hours)`,
    guardrails: [
      'Do not modify ACM certificate during validation',
      'Do not delete validation records',
      'Wait at least 5 minutes between retries',
      'Escalate to HUMAN_REQUIRED if validation fails after 3 hours',
    ],
  },

  ROUTE53_DELEGATION_PENDING: {
    fingerprintId: 'route53-delegation',
    errorClass: 'ROUTE53_DELEGATION_PENDING',
    proposedFactoryAction: 'HUMAN_REQUIRED',
    steps: `# Route53 Delegation Pending

## Problem
The hosted zone's NS (nameserver) records need to be configured in the parent domain.

## Resolution Steps
1. **Get NS Records**: Retrieve the NS records from the Route53 hosted zone
2. **Update Parent Domain**: Configure NS records in the parent domain registrar
3. **Verify Delegation**: Use \`dig NS <domain>\` to verify delegation
4. **Wait for Propagation**: DNS delegation can take 24-48 hours

## Manual Action Required
This requires access to the domain registrar to update NS records.

## Commands
\`\`\`bash
# Check current NS records
dig NS yourdomain.com

# Check from specific nameserver
dig @8.8.8.8 NS yourdomain.com
\`\`\``,
    guardrails: [
      'Verify NS records before updating parent domain',
      'Keep record of old NS records for rollback',
      'Do not deploy until delegation is verified',
      'Document NS records in deployment notes',
    ],
  },

  CFN_IN_PROGRESS_LOCK: {
    fingerprintId: 'cfn-in-progress',
    errorClass: 'CFN_IN_PROGRESS_LOCK',
    proposedFactoryAction: 'WAIT_AND_RETRY',
    steps: `# CloudFormation In-Progress Lock

## Problem
The CloudFormation stack is currently being updated and cannot accept new changes.

## Resolution Steps
1. **Check Stack Status**: Verify the current stack operation
2. **Wait for Completion**: Let the current operation finish
3. **Verify Stack Health**: Check if the operation succeeded or failed
4. **Retry Deployment**: Once stack is in a stable state, retry

## Automation
Automatically retry with:
- Initial wait: 2 minutes
- Check interval: 2 minutes
- Max wait time: 30 minutes
- If still locked after 30 minutes: OPEN_ISSUE

## Commands
\`\`\`bash
# Check stack status
aws cloudformation describe-stacks --stack-name <stack-name>
\`\`\``,
    guardrails: [
      'Do not attempt to cancel or modify the in-progress operation',
      'Wait for stable state: CREATE_COMPLETE, UPDATE_COMPLETE, or ROLLBACK_COMPLETE',
      'If stuck in IN_PROGRESS for >30 minutes, escalate',
      'Check for rollback scenarios that may require manual intervention',
    ],
  },

  CFN_ROLLBACK_LOCK: {
    fingerprintId: 'cfn-rollback',
    errorClass: 'CFN_ROLLBACK_LOCK',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# CloudFormation Rollback Lock

## Problem
The stack is rolling back due to a failure. This requires investigation before retry.

## Resolution Steps
1. **Identify Root Cause**: Check stack events to find what caused the rollback
2. **Review Resource Failures**: Examine failed resources and error messages
3. **Fix Underlying Issue**: Address the root cause before retrying
4. **Clean Up**: Ensure stack reaches a stable state (ROLLBACK_COMPLETE)
5. **Redeploy**: After fixing the issue, attempt deployment again

## Investigation
\`\`\`bash
# Get stack events to see failure reason
aws cloudformation describe-stack-events --stack-name <stack-name>

# Check specific resource
aws cloudformation describe-stack-resource --stack-name <stack-name> --logical-resource-id <resource-id>
\`\`\``,
    guardrails: [
      'Do not retry without investigating root cause',
      'Document rollback reason in issue',
      'Verify resource limits and quotas',
      'Check for permission issues',
    ],
  },

  MISSING_SECRET: {
    fingerprintId: 'missing-secret',
    errorClass: 'MISSING_SECRET',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# Missing Secret

## Problem
A required secret is not found in AWS Secrets Manager.

## Resolution Steps
1. **Identify Secret**: Note the secret name/ARN from the error message
2. **Check Secret Existence**: Verify if secret exists in correct region/account
3. **Create Secret**: If missing, create the secret with required values
4. **Verify Permissions**: Ensure IAM role has access to the secret
5. **Retry Deployment**: After creating secret, retry deployment

## Commands
\`\`\`bash
# List secrets
aws secretsmanager list-secrets --region <region>

# Create secret
aws secretsmanager create-secret --name <secret-name> --secret-string '{"key":"value"}' --region <region>

# Check IAM permissions
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>
\`\`\``,
    guardrails: [
      'Verify secret name matches exactly what the application expects',
      'Ensure secret is in the correct AWS region',
      'Do not commit secrets to code',
      'Document secret requirements in deployment notes',
    ],
  },

  MISSING_ENV_VAR: {
    fingerprintId: 'missing-env',
    errorClass: 'MISSING_ENV_VAR',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# Missing Environment Variable

## Problem
A required environment variable or configuration parameter is not set.

## Resolution Steps
1. **Identify Variable**: Note the missing variable name from error
2. **Check Configuration**: Review CDK/CloudFormation parameters
3. **Set Variable**: Add the variable to the appropriate configuration
4. **Update Stack**: Deploy with the corrected configuration

## Investigation
- Check CDK context values
- Review environment-specific config files
- Verify parameter store values
- Check secrets manager for config values`,
    guardrails: [
      'Document all required environment variables',
      'Use parameter store or secrets manager for sensitive values',
      'Validate configuration before deployment',
      'Test in staging environment first',
    ],
  },

  DEPRECATED_CDK_API: {
    fingerprintId: 'deprecated-cdk',
    errorClass: 'DEPRECATED_CDK_API',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# Deprecated CDK API Usage

## Problem
Code is using a deprecated CDK API that may be removed in future versions.

## Resolution Steps
1. **Identify API**: Note which API/method is deprecated
2. **Check Documentation**: Review CDK docs for recommended replacement
3. **Update Code**: Replace deprecated API with current alternative
4. **Test Changes**: Verify functionality with new API
5. **Deploy**: Deploy updated code

## Resources
- CDK API Documentation: https://docs.aws.amazon.com/cdk/api/latest/
- CDK Migration Guide: Check release notes for migration paths`,
    guardrails: [
      'Test API changes in non-production environment first',
      'Review breaking changes in CDK release notes',
      'Update CDK version if needed',
      'Check for other deprecated APIs in codebase',
    ],
  },

  UNIT_MISMATCH: {
    fingerprintId: 'unit-mismatch',
    errorClass: 'UNIT_MISMATCH',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# Unit Mismatch

## Problem
Configuration values are using incorrect units (e.g., MB vs MiB, seconds vs milliseconds).

## Resolution Steps
1. **Identify Mismatch**: Note which property has wrong units
2. **Check Requirements**: Verify expected units from AWS documentation
3. **Convert Value**: Convert to correct units
4. **Update Config**: Fix the configuration
5. **Deploy**: Deploy with corrected values

## Common Unit Issues
- **Memory**: AWS often uses MiB (mebibytes) not MB (megabytes)
  - 1 MiB = 1.048576 MB
- **Time**: Some services use seconds, others milliseconds
  - Always check AWS service documentation
- **Storage**: GB vs GiB for EBS and S3`,
    guardrails: [
      'Always verify units in AWS documentation',
      'Use CDK helper classes (Duration, Size) when available',
      'Document expected units in code comments',
      'Test with small values first',
    ],
  },

  UNKNOWN: {
    fingerprintId: 'unknown-error',
    errorClass: 'UNKNOWN',
    proposedFactoryAction: 'OPEN_ISSUE',
    steps: `# Unknown Deployment Error

## Problem
An unclassified deployment error occurred.

## Resolution Steps
1. **Collect Information**: Gather all error messages and stack traces
2. **Check AWS Logs**: Review CloudWatch logs for more details
3. **Search Documentation**: Look up error in AWS documentation
4. **Check Service Health**: Verify AWS service status
5. **Create Issue**: Open detailed issue for investigation

## Investigation
- CloudFormation stack events
- CloudWatch logs
- CDK synthesis output
- AWS Service Health Dashboard`,
    guardrails: [
      'Collect comprehensive error information',
      'Check for similar issues in project history',
      'Document troubleshooting steps taken',
      'Escalate to human engineer for unknown issues',
    ],
  },
};

/**
 * Retrieves a playbook for a given fingerprint or error class
 * 
 * @param fingerprintOrClass Fingerprint ID or error class
 * @returns Playbook with remediation steps
 */
export function getPlaybook(fingerprintOrClass: string): Playbook {
  // Check if it's a known fingerprint
  for (const playbook of Object.values(DEFAULT_PLAYBOOKS)) {
    if (playbook.fingerprintId === fingerprintOrClass) {
      return playbook;
    }
  }

  // Check if it's an error class
  const errorClass = fingerprintOrClass as ErrorClass;
  if (errorClass in DEFAULT_PLAYBOOKS) {
    return DEFAULT_PLAYBOOKS[errorClass];
  }

  // Default to UNKNOWN playbook
  return DEFAULT_PLAYBOOKS.UNKNOWN;
}

/**
 * Gets all available playbooks
 * 
 * @returns Array of all playbooks
 */
export function getAllPlaybooks(): Playbook[] {
  return Object.values(DEFAULT_PLAYBOOKS);
}

/**
 * Determines the factory action based on classification confidence
 * 
 * @param errorClass Error classification
 * @param confidence Classification confidence (0-1)
 * @returns Recommended factory action
 */
export function determineFactoryAction(
  errorClass: ErrorClass,
  confidence: number
): FactoryAction {
  // Low confidence - needs human review
  if (confidence < 0.6) {
    return 'OPEN_ISSUE';
  }

  // Use playbook recommendation for high confidence
  const playbook = getPlaybook(errorClass);
  return playbook.proposedFactoryAction;
}
