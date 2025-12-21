# AFU-9 Deploy Intent & Compiler Contract (v1 – Canonical)

## Purpose
Deployment intent must be explicit, machine-readable, and enforceable.
This document defines the only valid way to express deploy intent in AFU-9.

---

## 1. Intent Schema

```json
{
  "intent": "deploy-app",
  "env": "staging",
  "image": "afu9/control-center:sha-<commit>",
  "expected_effect": "no-infra-change",
  "manage_dns": false,
  "create_staging_service": false
}
2. Allowed Values
Field	Allowed
intent	deploy-app | deploy-infra
env	staging | production
expected_effect	no-infra-change | infra-additive
manage_dns	true | false
create_staging_service	true | false

Anything else → REJECT

3. Compiler Rules (Hard Guards)
If intent == deploy-app AND expected_effect != no-infra-change → REJECT

If env == production AND create_staging_service == true → REJECT

If manage_dns == false AND CDK diff touches Route53 → REJECT

If preflight != OK → REJECT

4. Compiler Output (Example)
json
Code kopieren
{
  "workflow": "deploy-ecs.yml",
  "cluster": "afu9-cluster",
  "service": "afu9-control-center-staging",
  "allowed_stacks": ["Afu9EcsStack"],
  "blocked_resources": [
    "AWS::ECS::Cluster",
    "AWS::IAM::Role",
    "AWS::Route53::RecordSet"
  ]
}
Principle
Intent is the only human input.
Everything else is compilation.

yaml
Code kopieren

---

## 🔧 Optional: alles automatisch per PowerShell anlegen

Wenn du willst, sag Bescheid, dann gebe ich dir **einen einzigen PowerShell-Block**, der:
- die Ordner anlegt  
- alle drei Dateien schreibt  
- optional direkt committet  

---

### Einordnung (wichtig)
Das hier ist **kein „nice to have“**.  
Das ist die **Gegenmaßnahme gegen KI-Drift**, die du beobachtet hast.

Ab jetzt gilt:
- **Intent > Meinung**
- **Diff > Hoffnung**
- **Guardrails > Kreativität**

Wenn du willst, gehen wir als Nächstes **DEPLOY_STATE.json** oder den **Intent-Compiler** an.