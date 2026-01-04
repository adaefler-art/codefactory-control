# Lessons Learned — Staging Smoke Key + MCP Runner (v0.6 → v0.7)

## Kontext
Während der v0.6/v0.7-Phase kam es zu wiederholten Deploy-/Smoke-Test-Fehlschlägen:
- Staging Requests wurden 401, obwohl Smoke-Key korrekt aus Secrets Manager gelesen wurde.
- Deploy/Workflow lief teilweise “gegen prod” oder mit prod-Parametern, obwohl staging intendiert war.
- MCP Runner war zwar in CDK “wired”, aber nicht zuverlässig im Standard-Deploypfad gebaut/aktualisiert.
- Workflow brach wegen `unbound variable` (bash `set -u`) ab.

## Root Causes
1) **Smoke-Key Rotation Footgun**
   - Staging Task Definition war auf einen *suffixed Secret ARN* gepinnt (z.B. `.../smoke-key-<suffix>`).
   - Rotation erzeugt neuen ARN; Service injiziert weiter den alten → Smoke-Key-Match schlägt fehl → 401.

2) **Staging/Prod Ambiguität**
   - Fehlende oder uneindeutige “fail-closed” Checks erlaubten, dass Deploy-Schritte implizit prod-Stack/Service trafen.

3) **Runner Deploy Gap**
   - Workflow baute/pushte nicht immer `afu9/mcp-runner` und rewritete dessen Image nicht deterministisch im TaskDef.

4) **Workflow Robustness**
   - Bash step nutzte Variablen (z.B. `READY_HOST`, `APP_VERSION`) ohne Defaults → `unbound variable` → Workflow failt trotz erfolgreichem Deploy.

## Guardrails (Non-negotiables)
### A) Smoke-Key muss rotations-sicher sein
- Deploy darf **nie** einen suffixed ARN hardcoden.
- Deploy muss den Secret ARN **per Name** auflösen:
  - `aws secretsmanager describe-secret --secret-id "afu9/stage/smoke-key" --query ARN`
- Deploy muss in der staging TaskDef `AFU9_SMOKE_KEY.valueFrom` **rewrite’n** (replace-or-add) und
  - `aws ecs update-service ... --force-new-deployment` ausführen.
- Post-Deploy Assertion:
  - Active staging TaskDef muss `AFU9_SMOKE_KEY.valueFrom == resolved ARN` erfüllen (sonst fail).

### B) Staging ist wirklich Staging (fail-closed)
- Jeder staging Deploy muss explizit:
  - Service: `afu9-control-center-staging`
  - Endpoint/Host: `stage.afu-9.com`
  - Secret Name: `afu9/stage/smoke-key`
- Guardrail: Wenn `DEPLOY_ENV=staging`, dann darf **kein** prod-Service/Host/Secret referenziert werden.

### C) MCP Runner muss im Standard-Deploypfad “first-class” sein
- Workflow muss `afu9/mcp-runner` wie die anderen Sidecars build/pushen.
- TaskDef Mutation muss das Runner-Image rewrite’n (wenn Container existiert).
- Optional: Wenn staging TaskDef keinen Runner enthält, darf Deploy ihn als `essential:false` hinzufügen (Port 3004).

### D) Workflow muss `set -u`-safe sein
- Alle Variablen, die in bash steps verwendet werden, müssen:
  - aus `env:` gesetzt sein **oder**
  - im Script via `${VAR:-default}` abgesichert werden.
- Keine “unbound variable” Fehler mehr.

## Definition of Done (Operational)
Ein Deploy gilt als “GREEN”, wenn:
1) Smoke Request ist 200:
   - `GET https://stage.afu-9.com/api/timeline/chain?...`
   - Header: `x-afu9-smoke-key-match: 1` und `x-afu9-smoke-auth-used: 1`
2) Staging TaskDef enthält `AFU9_SMOKE_KEY` unter `secrets[]` (nicht environment).
3) `mcp-runner` ist RUNNING und HEALTHY.
4) `npm run repo:verify`, `npm --prefix control-center run build` grün.
