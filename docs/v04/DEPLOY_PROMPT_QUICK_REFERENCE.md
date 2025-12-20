# Canonical Deploy Prompt - Quick Reference

**Version:** 1.0.0  
**Issue:** I-03-02-DEPLOY-PROMPT  
**Full Documentation:** [CANONICAL_DEPLOY_PROMPT.md](docs/CANONICAL_DEPLOY_PROMPT.md)

## Quick Start

Copy this prompt to VS Copilot for AFU-9 infrastructure deployments:

```
I need to deploy an AFU-9 CDK stack to AWS following the canonical deployment workflow.

Stack to deploy: [STACK_NAME]
Environment: [staging/production]

PHASE 1: BUILD → npm run build
PHASE 2: SYNTH → npm run synth [STACK_NAME]
PHASE 3: DIFF (MANDATORY) → npm run validate:diff -- [STACK_NAME] [context flags]
PHASE 4: DEPLOY → npx cdk deploy [STACK_NAME] [context flags] --require-approval never
PHASE 5: VERIFY → Check stack status, health endpoints, and logs

See docs/CANONICAL_DEPLOY_PROMPT.md for complete prompt and examples.
```

## Common Stacks

| Stack | Environment | Context Flags |
|-------|-------------|---------------|
| Afu9NetworkStack | staging | `-c afu9-enable-https=false -c environment=staging` |
| Afu9DatabaseStack | staging | `-c environment=staging -c multiAz=false` |
| Afu9EcsStack | staging | `-c environment=staging -c imageTag=staging-latest` |
| Afu9AlarmsStack | staging | `-c environment=staging` |

## Must Remember

1. ⚠️ **Never skip Phase 3 (Diff-Gate validation)**
2. 🚫 **Do not deploy if diff-gate returns exit code 1**
3. 📝 **Document all deployments and overrides**
4. ✅ **Always verify deployment success**
5. 📊 **Follow stack deployment order**: Network → Database → ECS → Alarms

## Links

- **Full Prompt**: [docs/CANONICAL_DEPLOY_PROMPT.md](docs/CANONICAL_DEPLOY_PROMPT.md)
- **Deployment Runbook**: [docs/AWS_DEPLOY_RUNBOOK.md](docs/AWS_DEPLOY_RUNBOOK.md)
- **Diff-Gate Rules**: [docs/DIFF_GATE_RULES.md](docs/DIFF_GATE_RULES.md)
