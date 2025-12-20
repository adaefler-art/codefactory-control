# Canonical VS-Copilot Deploy Prompt

**Version:** 1.0.0  
**Issue:** I-03-02-DEPLOY-PROMPT  
**Last Updated:** 2025-12-20  
**Status:** ✅ Active

## Overview

This document contains the **canonical, copy/paste-ready deployment prompt** for AFU-9 infrastructure deployments using AWS CDK. Use this prompt with VS Copilot (GitHub Copilot) to execute safe, reproducible deployments following the standard workflow: **Build → Synth → Diff → Deploy → Verify**.

## When to Use This Prompt

Use this prompt when:
- Deploying CDK infrastructure stacks to AWS
- Updating existing infrastructure
- Following the standard AFU-9 deployment workflow
- Ensuring consistent deployment practices across the team

## The Canonical Deploy Prompt

Copy and paste this prompt to VS Copilot when you need to deploy AFU-9 infrastructure:

---

```
I need to deploy an AFU-9 CDK stack to AWS following the canonical deployment workflow.

Stack to deploy: [STACK_NAME]
Environment: [staging/production]
Context flags: [any additional context flags]

Please execute the following workflow:

PHASE 1: BUILD
- Run: npm run build
- This validates secrets and compiles TypeScript
- Ensure no build errors before proceeding

PHASE 2: SYNTH
- Run: npm run synth [STACK_NAME]
- This synthesizes CloudFormation template with validation
- Review the generated template for correctness
- Check that all required resources are included

PHASE 3: DIFF (MANDATORY GATE)
- Run: npm run validate:diff -- [STACK_NAME] [context flags]
- This is a MANDATORY step that validates infrastructure changes
- Blocking changes will prevent deployment (exit code 1)
- Review any warnings carefully
- If blocked, document justification and get approval before override
- Examples:
  - npm run validate:diff -- Afu9NetworkStack -c afu9-enable-https=false -c environment=staging
  - npm run validate:diff -- Afu9EcsStack -c environment=staging -c imageTag=staging-latest
  - npm run validate:diff -- Afu9DatabaseStack -c environment=staging -c multiAz=false

PHASE 4: DEPLOY
- Only proceed if diff-gate validation passed (exit code 0)
- Run: npx cdk deploy [STACK_NAME] [context flags] --require-approval never
- Monitor deployment progress
- Watch for CloudFormation events and errors
- Examples:
  - npx cdk deploy Afu9NetworkStack --context afu9-enable-https=false --context environment=staging --require-approval never
  - npx cdk deploy Afu9EcsStack --context environment=staging --context imageTag=staging-latest --require-approval never
  - npx cdk deploy Afu9DatabaseStack --context environment=staging --context multiAz=false --require-approval never

PHASE 5: VERIFY
- Check stack deployment status
- Verify stack outputs
- Run smoke tests if applicable
- Check CloudWatch logs for errors
- For ECS deployments: verify service stability and health endpoints
- Commands:
  - aws cloudformation describe-stacks --stack-name [STACK_NAME]
  - aws ecs describe-services --cluster afu9-cluster --services [SERVICE_NAME] (for ECS stacks)
  - curl http://[ALB_DNS]/api/health (for application stacks)
  - ./scripts/smoke-test-staging.sh [ALB_DNS] (staging environment)

IMPORTANT RULES:
1. Never skip the diff-gate validation (Phase 3)
2. Do not proceed with deployment if diff-gate returns exit code 1
3. Document any overrides or emergency deployments
4. Always verify deployment success before considering the task complete
5. Follow the deployment order for dependent stacks (Network → Database → ECS → Alarms)

REFERENCE DOCUMENTATION:
- Deployment Runbook: docs/AWS_DEPLOY_RUNBOOK.md
- Diff-Gate Rules: docs/DIFF_GATE_RULES.md
- Post-Deploy Verification: docs/POST_DEPLOY_VERIFICATION.md
- ECS Deployment Guide: docs/ECS-DEPLOYMENT.md

Please execute this workflow step-by-step and report the output from each phase.
```

---

## Prompt Variables

Customize the prompt with these variables:

| Variable | Description | Examples |
|----------|-------------|----------|
| `[STACK_NAME]` | Name of the CDK stack to deploy | `Afu9NetworkStack`, `Afu9EcsStack`, `Afu9DatabaseStack`, `Afu9AlarmsStack` |
| `[staging/production]` | Target environment | `staging`, `production` |
| `[context flags]` | Additional CDK context parameters | `-c environment=staging`, `-c afu9-enable-https=false`, `-c imageTag=staging-latest` |
| `[SERVICE_NAME]` | ECS service name (for ECS stacks) | `afu9-control-center-stage`, `afu9-control-center-prod` |
| `[ALB_DNS]` | Application Load Balancer DNS name | Output from NetworkStack deployment |

## Example Usage

### Example 1: Deploy Network Stack (Staging)

```
I need to deploy an AFU-9 CDK stack to AWS following the canonical deployment workflow.

Stack to deploy: Afu9NetworkStack
Environment: staging
Context flags: -c afu9-enable-https=false -c environment=staging

[... rest of the canonical prompt ...]
```

### Example 2: Deploy ECS Stack (Staging)

```
I need to deploy an AFU-9 CDK stack to AWS following the canonical deployment workflow.

Stack to deploy: Afu9EcsStack
Environment: staging
Context flags: -c environment=staging -c imageTag=staging-latest

[... rest of the canonical prompt ...]
```

### Example 3: Deploy Database Stack (Production)

```
I need to deploy an AFU-9 CDK stack to AWS following the canonical deployment workflow.

Stack to deploy: Afu9DatabaseStack
Environment: production
Context flags: -c environment=production -c multiAz=true

[... rest of the canonical prompt ...]
```

## Deployment Workflow Details

### Phase 1: Build

**Purpose:** Validate secrets and compile TypeScript code

**Command:**
```bash
npm run build
```

**What it does:**
- Validates required AWS Secrets Manager secrets exist
- Compiles TypeScript to JavaScript
- Checks for type errors
- Prepares CDK constructs for synthesis

**Success criteria:** Exit code 0, no compilation errors

**Troubleshooting:**
- If secret validation fails, check AWS Secrets Manager configuration
- If compilation fails, fix TypeScript errors before proceeding

### Phase 2: Synth

**Purpose:** Generate CloudFormation templates

**Command:**
```bash
npm run synth [STACK_NAME]
```

**What it does:**
- Runs CDK synthesis with validation
- Generates CloudFormation templates in `cdk.out/`
- Validates stack configuration
- Checks for CDK construct errors

**Success criteria:** Template generated in `cdk.out/`, exit code 0

**Troubleshooting:**
- Review template for correctness
- Check that all resources are properly defined
- Verify context parameters are applied

### Phase 3: Diff (Mandatory Gate)

**Purpose:** Validate infrastructure changes before deployment

**Command:**
```bash
npm run validate:diff -- [STACK_NAME] [context flags]
```

**What it does:**
- Compares current stack state with proposed changes
- Identifies blocking changes (ECS Service replacement, DNS changes, etc.)
- Provides warnings for changes requiring review
- Prevents unsafe deployments

**Success criteria:** Exit code 0 (safe or warning changes only)

**Blocking criteria:**
- ECS Service replacement → causes downtime
- DNS record deletion/replacement → breaks availability
- ACM Certificate changes → breaks HTTPS
- Security Group deletion → breaks connectivity
- RDS instance replacement → requires migration
- Load Balancer replacement → changes DNS endpoint

**Override process (emergency only):**
1. Document justification in PR/issue
2. Get team approval
3. Use: `SKIP_DIFF_GATE=true npm run validate:diff -- [STACK_NAME]`

**Reference:** See [DIFF_GATE_RULES.md](./DIFF_GATE_RULES.md) for complete rules

### Phase 4: Deploy

**Purpose:** Deploy infrastructure changes to AWS

**Command:**
```bash
npx cdk deploy [STACK_NAME] [context flags] --require-approval never
```

**What it does:**
- Deploys CloudFormation stack to AWS
- Creates or updates infrastructure resources
- Waits for stack operations to complete
- Outputs stack results

**Success criteria:** Stack status `CREATE_COMPLETE` or `UPDATE_COMPLETE`

**Monitoring:**
- Watch CloudFormation events in AWS Console
- Monitor for rollback or failure events
- Check resource creation progress

**Deployment order for dependent stacks:**
1. `Afu9NetworkStack` (VPC, ALB, Security Groups)
2. `Afu9DatabaseStack` (RDS PostgreSQL)
3. `Afu9EcsStack` (ECS Cluster, Services, Task Definitions)
4. `Afu9AlarmsStack` (CloudWatch Alarms)
5. `Afu9IamStack` (IAM Roles - independent)

### Phase 5: Verify

**Purpose:** Confirm deployment success and application health

**Commands:**
```bash
# Check stack status
aws cloudformation describe-stacks --stack-name [STACK_NAME]

# For ECS stacks: Check service health
aws ecs describe-services --cluster afu9-cluster --services [SERVICE_NAME]

# For application stacks: Test health endpoint
curl http://[ALB_DNS]/api/health

# Run automated smoke tests (staging)
./scripts/smoke-test-staging.sh [ALB_DNS]
```

**Verification checklist:**
- [ ] Stack status is `CREATE_COMPLETE` or `UPDATE_COMPLETE`
- [ ] All stack outputs are present and correct
- [ ] ECS service is stable (if ECS stack)
- [ ] Health endpoints return 200 OK (if application stack)
- [ ] CloudWatch logs show no errors
- [ ] ALB targets are healthy (if Network stack)
- [ ] Database is available (if Database stack)

**Reference:** See [POST_DEPLOY_VERIFICATION.md](./POST_DEPLOY_VERIFICATION.md) for complete verification guide

## Integration with Existing Documentation

This canonical prompt references and aligns with:

| Document | Purpose | Link |
|----------|---------|------|
| AWS Deploy Runbook | Complete staging deployment guide | [AWS_DEPLOY_RUNBOOK.md](./AWS_DEPLOY_RUNBOOK.md) |
| Diff-Gate Rules | Validation rules and patterns | [DIFF_GATE_RULES.md](./DIFF_GATE_RULES.md) |
| Post-Deploy Verification | Verification procedures | [POST_DEPLOY_VERIFICATION.md](./POST_DEPLOY_VERIFICATION.md) |
| ECS Deployment Guide | ECS-specific deployment details | [ECS-DEPLOYMENT.md](./ECS-DEPLOYMENT.md) |
| Deployment Guide | General deployment information | [DEPLOYMENT.md](./DEPLOYMENT.md) |

## Common Deployment Scenarios

### Scenario 1: First-Time Infrastructure Deployment

```bash
# 1. Deploy Network Stack
npm run build
npm run synth Afu9NetworkStack
npm run validate:diff -- Afu9NetworkStack -c afu9-enable-https=false -c environment=staging
npx cdk deploy Afu9NetworkStack --context afu9-enable-https=false --context environment=staging --require-approval never

# 2. Deploy Database Stack
npm run validate:diff -- Afu9DatabaseStack -c environment=staging -c multiAz=false
npx cdk deploy Afu9DatabaseStack --context environment=staging --context multiAz=false --require-approval never

# 3. Deploy ECS Stack
npm run validate:diff -- Afu9EcsStack -c environment=staging -c imageTag=staging-latest
npx cdk deploy Afu9EcsStack --context environment=staging --context imageTag=staging-latest --require-approval never

# 4. Deploy Alarms Stack
npm run validate:diff -- Afu9AlarmsStack -c environment=staging
npx cdk deploy Afu9AlarmsStack --context environment=staging --require-approval never

# 5. Verify deployment
./scripts/smoke-test-staging.sh [ALB_DNS]
```

### Scenario 2: Update ECS Service with New Image

```bash
# 1. Build and validate
npm run build

# 2. Diff-gate validation
npm run validate:diff -- Afu9EcsStack -c environment=staging -c imageTag=v1.2.3

# 3. Deploy if safe
npx cdk deploy Afu9EcsStack --context environment=staging --context imageTag=v1.2.3 --require-approval never

# 4. Verify service stability
aws ecs describe-services --cluster afu9-cluster --services afu9-control-center-stage
curl http://[ALB_DNS]/api/health
```

### Scenario 3: Emergency Deployment with Override

```bash
# Only when blocking changes are intentional and approved

# 1. Document justification in PR/issue
# 2. Get team approval
# 3. Build and synth
npm run build
npm run synth Afu9EcsStack

# 4. Run diff-gate with skip (not recommended)
SKIP_DIFF_GATE=true npm run validate:diff -- Afu9EcsStack -c environment=staging

# 5. Deploy with extra monitoring
npx cdk deploy Afu9EcsStack --context environment=staging --require-approval never

# 6. Intensive verification
# Monitor CloudFormation, ECS service events, CloudWatch logs
```

## Best Practices

1. **Always run all 5 phases** - Never skip phases, especially diff-gate validation
2. **Document context** - Record which stacks were deployed and why
3. **Verify thoroughly** - Don't consider deployment complete until verification passes
4. **Follow deployment order** - Respect stack dependencies
5. **Monitor during deployment** - Watch CloudFormation events and CloudWatch logs
6. **Test before production** - Always deploy to staging first
7. **Keep prompts versioned** - Reference this canonical version for consistency
8. **Update prompt as needed** - Submit PRs to update this document when workflows change

## Troubleshooting

### Build Phase Fails

**Symptom:** `npm run build` exits with error

**Solutions:**
- Check AWS Secrets Manager configuration: `aws secretsmanager list-secrets`
- Fix TypeScript compilation errors
- Ensure all dependencies are installed: `npm install`
- Review error messages for specific issues

### Synth Phase Fails

**Symptom:** `npm run synth` fails to generate template

**Solutions:**
- Check CDK construct code for errors
- Verify context parameters are correct
- Review CDK version compatibility
- Check for missing dependencies

### Diff-Gate Blocks Deployment

**Symptom:** `npm run validate:diff` exits with code 1

**Solutions:**
- Review blocking changes in output
- Determine if changes are intentional
- If unintentional, fix CDK code
- If intentional, document justification and get approval
- Use override only in emergencies

### Deploy Phase Fails

**Symptom:** CloudFormation stack rollback

**Solutions:**
- Check CloudFormation events for specific error
- Review CloudWatch logs
- Verify IAM permissions
- Check resource limits (VPC limits, EIP limits, etc.)
- Review stack dependencies

### Verify Phase Fails

**Symptom:** Health checks fail or service unstable

**Solutions:**
- Check ECS service events
- Review CloudWatch logs for application errors
- Verify security group rules
- Check secrets configuration
- Test database connectivity
- Follow [ECS Circuit Breaker Diagnosis Runbook](./runbooks/ecs-circuit-breaker-diagnosis.md)

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-20 | Initial canonical deploy prompt (Issue I-03-02) |

## Maintenance

**Review Schedule:** Quarterly  
**Next Review:** 2025-03-20  
**Maintained by:** AFU-9 Infrastructure Team

## Related Documentation

- [AWS_DEPLOY_RUNBOOK.md](./AWS_DEPLOY_RUNBOOK.md) - Source of truth for AFU-9 staging deployments
- [DIFF_GATE_RULES.md](./DIFF_GATE_RULES.md) - Complete diff-gate validation rules
- [POST_DEPLOY_VERIFICATION.md](./POST_DEPLOY_VERIFICATION.md) - Post-deployment verification guide
- [ECS-DEPLOYMENT.md](./ECS-DEPLOYMENT.md) - Detailed ECS deployment guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - General deployment guide (v0.1 Lambda-based)
- [IMPLEMENTATION_SUMMARY_I-03-01.md](../IMPLEMENTATION_SUMMARY_I-03-01.md) - Diff-gate implementation details

## Feedback and Improvements

To suggest improvements to this canonical prompt:
1. Create a GitHub issue with label `documentation`
2. Describe the improvement and rationale
3. Submit a PR with proposed changes
4. Update version number according to semantic versioning

---

**Status:** ✅ Active  
**Document ID:** I-03-02-DEPLOY-PROMPT  
**Canonical Version:** 1.0.0
