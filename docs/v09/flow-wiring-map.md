# docs/v09/flow-wiring-map.md — Vorlage (AFU-9 v0.9)

> Zweck: Kanonische, repo-übergreifende Wiring Map für **Real Issue Processing Loop**.
> Jede Capability (Endpoint oder Agent-Tool) zählt nur, wenn sie hier einem Flow-Step zugeordnet ist und Evidence produziert.
> Scope: UI + Engine + Control (3 Repos).

---

## 1) Begriffe

* **Flow-Step:** Kanonische Stufe im Real Issue Loop (Pick → Spec → Implement → Review → Merge → Deploy → Verify → Close → Debug/Remediate).
* **Trigger:** Was startet den Schritt? (UI action, webhook, scheduler, runner job).
* **Call Type:** `HTTP Endpoint` oder `MCP Tool Invocation`.
* **Evidence:** Persistentes Artefakt + Timeline Event (z.B. invocation record, run record, deploy record).
* **Idempotency Key:** Schlüssel, der Wiederholungen deterministisch macht (issueId/canonicalId/commitSha/runId).

---

## 2) Flow-Steps (v0.9 canonical)

| Step ID | Step Name       | Description                                                    | Exit Condition                     |
| ------- | --------------- | -------------------------------------------------------------- | ---------------------------------- |
| S1      | Pick Issue      | Select a real GitHub issue for processing                      | AFU-9 Issue linked + ownership set |
| S2      | Spec Ready      | Ensure minimum spec + acceptance criteria exist                | Issue marked SPEC_READY            |
| S3      | Implement       | Create/attach PR and start implementation                      | PR linked + checks running         |
| S4      | Review          | Request review / assign / prepare merge                        | checks green + review satisfied    |
| S5      | Merge           | Merge PR to main                                               | merge commit recorded              |
| S6      | Deploy          | Deploy triggered by merge                                      | deploy run recorded                |
| S7      | Verify          | Post-deploy verification gate                                  | GREEN or RED verdict recorded      |
| S8      | Close           | Close issue, finalize timeline                                 | DONE with evidence links           |
| S9      | Debug/Remediate | If RED: collect evidence, create incident, propose next action | HOLD + incident + evidence pack    |

---

## 3) Wiring Map (Haupttabelle)

> **Pflichtspalten**: Jeder Eintrag muss Trigger + Call + Evidence + Idempotency haben.
> **Used in Proof**: Link/ID zum ersten echten Durchlauf (Proof Issue).

| Row ID | Flow Step (S#) | Trigger (UI/Webhook/Job) | Call Type (HTTP/MCP) | Target (route/tool) | Owner Repo (ui/engine/control) | Inputs (min) | Outputs (min) | Evidence Produced (record + timeline) | Idempotency Key | Error Semantics (401/403/404/409/5xx) | Used in Proof (link/id) | Notes |
| ------ | -------------- | ------------------------ | -------------------- | ------------------- | ------------------------------ | ------------ | ------------- | ------------------------------------- | --------------- | ------------------------------------- | ----------------------- | ----- |
| W1     | S1             | Webhook                 | HTTP Endpoint        | POST /api/webhooks/github | control | delivery_id, event_type, payload | ok/ignored | webhook delivery record (recordGitHubWebhookDelivery) | delivery_id | 401 (missing/invalid signature), 400 (bad headers/json), 200 (ok/duplicate) | UNKNOWN | [control-center/app/api/webhooks/github/route.ts](control-center/app/api/webhooks/github/route.ts) `POST`; [control-center/src/lib/github-webhook-handler.ts](control-center/src/lib/github-webhook-handler.ts) `handleGitHubWebhook` |
| W2     | S2             | UI                       | HTTP Endpoint        | POST /api/intent/sessions/{id}/issue-draft/validate | control | sessionId, issue_json | validation + draft | intent_issue_authoring_events (draft_validate) | sessionId + issue_hash | 401/404/400/500 | UNKNOWN | [control-center/app/api/intent/sessions/[id]/issue-draft/validate/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/validate/route.ts) `POST`; [control-center/app/intent/components/IssueDraftPanel.tsx](control-center/app/intent/components/IssueDraftPanel.tsx) `handleValidate` |
| W3     | S2             | UI                       | HTTP Endpoint        | POST /api/intent/sessions/{id}/issue-draft/commit | control | sessionId | version, isNew | intent_issue_authoring_events (draft_commit) | issue_hash (commitIssueDraftVersion returns existing version) | 401/404/400/500 | UNKNOWN | [control-center/app/api/intent/sessions/[id]/issue-draft/commit/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/commit/route.ts) `POST`; [control-center/app/intent/components/IssueDraftPanel.tsx](control-center/app/intent/components/IssueDraftPanel.tsx) `handleCommit` |
| W4     | S3             | UNKNOWN_CALLER           | HTTP Endpoint        | POST /api/github/prs/{prNumber}/collect-summary | control | owner, repo, prNumber | summaryId, contentHash | implementation summary record (summaryId) | contentHash | 401/403/404/409/400/500 | UNKNOWN | [control-center/app/api/github/prs/[prNumber]/collect-summary/route.ts](control-center/app/api/github/prs/[prNumber]/collect-summary/route.ts) `POST` |
| W5     | S4             | UNKNOWN_CALLER           | HTTP Endpoint        | POST /api/github/prs/{prNumber}/request-review-and-wait | control | owner, repo, prNumber, reviewers? | rollup + evidence | manual touchpoint record (recordReviewTouchpoint) | requestId (not enforced) | 401/403/404/409/400/500 | UNKNOWN | [control-center/app/api/github/prs/[prNumber]/request-review-and-wait/route.ts](control-center/app/api/github/prs/[prNumber]/request-review-and-wait/route.ts) `POST` |
| W6     | S5             | UNKNOWN_CALLER           | HTTP Endpoint        | POST /api/github/prs/{prNumber}/merge | control | owner, repo, prNumber, approvalToken? | decision, commitSha? | merge audit event (auditEventId) | prNumber + requestId (not enforced) | 401/403/404/409/400/500 | UNKNOWN | [control-center/app/api/github/prs/[prNumber]/merge/route.ts](control-center/app/api/github/prs/[prNumber]/merge/route.ts) `POST` |
| W7     | S6             | UNKNOWN_CALLER           | HTTP Endpoint        | GET /api/deploy/status?env=... | control | env, force?, correlationId? | DeployStatusResponse | deploy_status_snapshot (insertDeployStatusSnapshot) | correlationId or verification runId | 400/503/200 | UNKNOWN | [control-center/app/api/deploy/status/route.ts](control-center/app/api/deploy/status/route.ts) `GET` |
| W8     | S7             | Job                      | HTTP Endpoint        | POST /api/playbooks/post-deploy-verify/run?env=stage|prod | control | env, variables? | run result (id, status) | playbook run record (executePlaybook) | runId | 401/409/400/500 | UNKNOWN | [control-center/app/api/playbooks/post-deploy-verify/run/route.ts](control-center/app/api/playbooks/post-deploy-verify/run/route.ts) `POST` |
| W9     | S8             | UNKNOWN_CALLER           | HTTP Endpoint        | POST /api/ops/db/issues/set-done | control | confirm, statuses, githubIssueMin/Max | updatedCount | ops_admin_actions audit record | requestId (uuid) | 401/403/409/400/500 | UNKNOWN | [control-center/app/api/ops/db/issues/set-done/route.ts](control-center/app/api/ops/db/issues/set-done/route.ts) `POST` |
| W10    | S9             | UNKNOWN_CALLER           | HTTP Endpoint        | POST /api/incidents/{id}/classify | control | incidentId | incident + classification | incident event CLASSIFIED | classificationHash | 401/400/404/500 | UNKNOWN | [control-center/app/api/incidents/[id]/classify/route.ts](control-center/app/api/incidents/[id]/classify/route.ts) `POST` |
| W11    | S3             | UI                       | HTTP Endpoint        | POST /api/intent/sessions/{id}/issue-draft/versions/publish | control | owner, repo, version_id? or issue_set_id | batch_id, summary | intent_issue_set_publish_batch_events + item events | batch_hash | 401/403/409/400/404/500 | UNKNOWN | [control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts) `POST`; [control-center/app/intent/components/IssueDraftPanel.tsx](control-center/app/intent/components/IssueDraftPanel.tsx) `handlePublish` |
| W12    | S2             | UI                       | HTTP Endpoint        | POST /api/intent/sessions/{id}/issues/create | control | sessionId | issueId, publicId, canonicalId | AFU9 issue row + timeline ISSUE_CREATED (ensureIssueForCommittedDraft) | canonicalId | 401/404/409/400/500 | UNKNOWN | [control-center/app/api/intent/sessions/[id]/issues/create/route.ts](control-center/app/api/intent/sessions/[id]/issues/create/route.ts) `POST`; [control-center/app/intent/components/IssueDraftPanel.tsx](control-center/app/intent/components/IssueDraftPanel.tsx) `handleCreateAfu9Issue` |
| W13    | S9             | UNKNOWN_CALLER           | MCP Tool Invocation  | observability.logs.search | control | logGroupName, startTime, endTime, filterPattern? | events, nextToken | none (invocation record missing) | time range + logGroupName (not enforced) | N/A (tool errors bubble to caller) | UNKNOWN | [mcp-servers/observability/src/index.ts](mcp-servers/observability/src/index.ts) `registerTools` |
| W14    | S9             | UI                       | HTTP Endpoint        | GET /api/health | engine | none | ok, service, version | none (read-only; evidence record missing) | N/A | 200 (ok payload), 500 | UNKNOWN | [codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx](codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx) `EngineConnectivityPanel`; [codefactory-ui/src/lib/api/engine.ts](codefactory-ui/src/lib/api/engine.ts) `getHealth`; [codefactory-engine/api/health.ts](codefactory-engine/api/health.ts) `handler` |
| W15    | S9             | UI                       | HTTP Endpoint        | GET /api/status | engine | none | status, signals | none (read-only; evidence record missing) | N/A | 200 (error payload on failure) | UNKNOWN | [codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx](codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx) `EngineConnectivityPanel`; [codefactory-ui/src/lib/api/engine.ts](codefactory-ui/src/lib/api/engine.ts) `getStatus`; [codefactory-engine/api/status.ts](codefactory-engine/api/status.ts) `handler` |
| W16    | S9             | UI                       | HTTP Endpoint        | GET /api/dev/endpoints | engine | none | endpoints[], count | none (read-only; evidence record missing) | N/A | 200 (error payload on failure) | UNKNOWN | [codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx](codefactory-ui/src/components/afu9/operate/EngineConnectivityPanel.tsx) `EngineConnectivityPanel`; [codefactory-ui/src/lib/api/engine.ts](codefactory-ui/src/lib/api/engine.ts) `getEndpoints`; [codefactory-engine/api/dev/endpoints.ts](codefactory-engine/api/dev/endpoints.ts) `handler` |
| W17    | S9             | UNKNOWN_CALLER           | HTTP Endpoint        | GET /api/engine/runs/{runId}/evidence | engine | runId | evidenceHash, logs, deployStatus | none (read-only; deterministic evidence payload) | runId | 400/200/500 | UNKNOWN | [codefactory-engine/packages/engine/src/api/endpointsManifest.ts](codefactory-engine/packages/engine/src/api/endpointsManifest.ts) `ENGINE_ENDPOINTS`; [codefactory-engine/packages/engine/src/api/evidenceHandlers.ts](codefactory-engine/packages/engine/src/api/evidenceHandlers.ts) `getRunEvidenceHandler` |

---

## 4) Endpoint Inventory (klassische HTTP Endpoints)

> Zweck: Liste aller relevanten HTTP Endpoints, damit “dead endpoints” sichtbar werden.
> Jeder Endpoint muss in Abschnitt 3 referenziert werden, sonst gilt er als **unwired**.

| Endpoint ID | Method | Route | Owner Repo | Purpose (1 sentence) | Caller (UI/Job/Webhook) | Referenced in Wiring Row (W#) | Evidence? (Y/N) | Notes |
| ----------- | ------ | ----- | ---------- | -------------------- | ----------------------- | ----------------------------- | --------------- | ----- |
| E1 | POST | /api/webhooks/github | control | Receive GitHub webhooks and persist delivery record. | Webhook | W1 | Y | [control-center/app/api/webhooks/github/route.ts](control-center/app/api/webhooks/github/route.ts) `POST` |
| E2 | POST | /api/intent/sessions/{id}/issue-draft/validate | control | Validate issue draft and record validation evidence. | UI | W2 | Y | [control-center/app/api/intent/sessions/[id]/issue-draft/validate/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/validate/route.ts) `POST` |
| E3 | POST | /api/intent/sessions/{id}/issue-draft/commit | control | Commit draft to immutable version with evidence. | UI | W3 | Y | [control-center/app/api/intent/sessions/[id]/issue-draft/commit/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/commit/route.ts) `POST` |
| E4 | POST | /api/github/prs/{prNumber}/collect-summary | control | Collect implementation summary for a PR. | UNKNOWN_CALLER | W4 | Y | [control-center/app/api/github/prs/[prNumber]/collect-summary/route.ts](control-center/app/api/github/prs/[prNumber]/collect-summary/route.ts) `POST` |
| E5 | POST | /api/github/prs/{prNumber}/request-review-and-wait | control | Request review and poll checks until terminal state. | UNKNOWN_CALLER | W5 | Y | [control-center/app/api/github/prs/[prNumber]/request-review-and-wait/route.ts](control-center/app/api/github/prs/[prNumber]/request-review-and-wait/route.ts) `POST` |
| E6 | POST | /api/github/prs/{prNumber}/merge | control | Merge PR with explicit approval and audit logging. | UNKNOWN_CALLER | W6 | Y | [control-center/app/api/github/prs/[prNumber]/merge/route.ts](control-center/app/api/github/prs/[prNumber]/merge/route.ts) `POST` |
| E7 | GET | /api/deploy/status?env=... | control | Resolve and cache deploy status snapshots. | UNKNOWN_CALLER | W7 | Y | [control-center/app/api/deploy/status/route.ts](control-center/app/api/deploy/status/route.ts) `GET` |
| E8 | POST | /api/playbooks/post-deploy-verify/run?env=stage|prod | control | Execute post-deploy verification playbook and return run result. | Job | W8 | Y | [control-center/app/api/playbooks/post-deploy-verify/run/route.ts](control-center/app/api/playbooks/post-deploy-verify/run/route.ts) `POST` |
| E9 | POST | /api/ops/db/issues/set-done | control | Set AFU9 issues to DONE and audit the admin action. | UNKNOWN_CALLER | W9 | Y | [control-center/app/api/ops/db/issues/set-done/route.ts](control-center/app/api/ops/db/issues/set-done/route.ts) `POST` |
| E10 | POST | /api/incidents/{id}/classify | control | Classify an incident and emit CLASSIFIED event. | UNKNOWN_CALLER | W10 | Y | [control-center/app/api/incidents/[id]/classify/route.ts](control-center/app/api/incidents/[id]/classify/route.ts) `POST` |
| E11 | POST | /api/intent/sessions/{id}/issue-draft/versions/publish | control | Publish committed issue draft versions to GitHub issues (batch). | UI | W11 | Y | [control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts](control-center/app/api/intent/sessions/[id]/issue-draft/versions/publish/route.ts) `POST` |
| E12 | POST | /api/intent/sessions/{id}/issues/create | control | Create AFU-9 issue from committed draft (idempotent). | UI | W12 | Y | [control-center/app/api/intent/sessions/[id]/issues/create/route.ts](control-center/app/api/intent/sessions/[id]/issues/create/route.ts) `POST` |
| E13 | GET | /api/health | engine | Engine health probe for connectivity. | UI | W14 | N | [codefactory-engine/api/health.ts](codefactory-engine/api/health.ts) `handler` |
| E14 | GET | /api/status | engine | Engine operational status with signals. | UI | W15 | N | [codefactory-engine/api/status.ts](codefactory-engine/api/status.ts) `handler` |
| E15 | GET | /api/dev/endpoints | engine | List engine endpoint catalog (dev). | UI | W16 | N | [codefactory-engine/api/dev/endpoints.ts](codefactory-engine/api/dev/endpoints.ts) `handler` |
| E16 | GET | /api/engine/runs/{runId}/evidence | engine | Return deterministic run evidence payload for a run. | UNKNOWN_CALLER | W17 | N | [codefactory-engine/packages/engine/src/api/evidenceHandlers.ts](codefactory-engine/packages/engine/src/api/evidenceHandlers.ts) `getRunEvidenceHandler` |
| E17 | GET | /api/ready | engine | Engine readiness/config check for required env. | UNKNOWN_CALLER |  | N | UNWIRED: [codefactory-engine/api/ready.ts](codefactory-engine/api/ready.ts) `handler` |

---

## 5) Agent Tool Inventory (MCP Tools)

> Zweck: Liste aller MCP Tools, damit ungenutzte Agenten-Infra sichtbar wird.
> Jedes Tool muss in Abschnitt 3 referenziert werden, sonst gilt es als **unwired**.

| Tool ID | MCP Server | Tool Name | Owner Repo | Purpose (1 sentence) | Referenced in Wiring Row (W#) | Evidence? (Y/N) | Notes |
| ------- | ---------- | --------- | ---------- | -------------------- | ----------------------------- | --------------- | ----- |
| T1 | github | getIssue | control | Get details of a GitHub issue. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T2 | github | listIssues | control | List issues in a repository. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T3 | github | createBranch | control | Create a new branch in a repository. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T4 | github | commitFileChanges | control | Commit file changes to a branch. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T5 | github | createPullRequest | control | Create a pull request. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T6 | github | mergePullRequest | control | Merge a pull request. | UNWIRED | N | [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts) `registerTools` |
| T7 | deploy | updateService | control | Update an ECS service with new image tag or force deployment. | UNWIRED | N | [mcp-servers/deploy/src/index.ts](mcp-servers/deploy/src/index.ts) `registerTools` |
| T8 | deploy | getServiceStatus | control | Get ECS service status including deployments and tasks. | UNWIRED | N | [mcp-servers/deploy/src/index.ts](mcp-servers/deploy/src/index.ts) `registerTools` |
| T9 | observability | logs.search | control | Search CloudWatch logs by filter pattern. | W13 | N | [mcp-servers/observability/src/index.ts](mcp-servers/observability/src/index.ts) `registerTools` |
| T10 | observability | metrics.getServiceHealth | control | Fetch ECS service health metrics. | UNWIRED | N | [mcp-servers/observability/src/index.ts](mcp-servers/observability/src/index.ts) `registerTools` |
| T11 | observability | getAlarmStatus | control | Fetch CloudWatch alarm status. | UNWIRED | N | [mcp-servers/observability/src/index.ts](mcp-servers/observability/src/index.ts) `registerTools` |
| T12 | runner | run.create | control | Create a new run from a RunSpec. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |
| T13 | runner | run.execute | control | Execute a previously created run. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |
| T14 | runner | run.status | control | Get current status of a run. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |
| T15 | runner | run.read | control | Read full results of a run. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |
| T16 | runner | playbook.list | control | List available playbooks. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |
| T17 | runner | playbook.get | control | Get a playbook by ID. | UNWIRED | N | [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts) `registerTools` |

---

## 6) Evidence Records (kanonische Minimaltypen)

> Diese Records müssen existieren oder als v0.9 Deliverable eingeführt werden.

### 6.1 Invocation Record (für MCP Tools)

* `invocationId`
* `issueId` (AFU-9) + optional `githubIssueNumber`
* `toolName`
* `inputsHash`, `outputsHash`
* `status`, `durationMs`
* `requestId`
* `createdAt`

### 6.2 Run Record (für Runner/Orchestrator Steps)

* `runId`
* `issueId`
* `step` (S1..S9)
* `status` (started/succeeded/failed)
* `evidenceRefs[]`
* `createdAt`

### 6.3 Deploy Record

* `deployId`
* `commitSha`
* `prUrl`
* `issueId`
* `environment`
* `status`
* `createdAt`

### 6.4 Verification Record (Gate)

* `verificationId`
* `deployId`
* `checks[]` (name, status, url)
* `verdict` (GREEN/YELLOW/RED)
* `reason`
* `createdAt`

### 6.5 Incident Record

* `incidentId`
* `issueId`
* `deployId`
* `type`
* `summary`
* `evidencePackId`
* `createdAt`

---

## 7) Proof Issue Template (v0.9 Abnahme)

> Jeder Epic muss mindestens 1 Proof Issue haben.

* GitHub Issue: `<link>`
* AFU-9 Issue: `<id/link>`
* PR: `<link>`
* Deploy: `<link>`
* Verification: `<link>`
* Timeline: `<link>`
* Result: DONE / HOLD (mit Incident)

---

## 8) Regeln (Fail-Closed)

1. Kein Endpoint/Tool ohne Wiring Row (Abschnitt 3) zählt als Feature.
2. Jeder Step muss Evidence produzieren.
3. Jede Action muss idempotent sein (Idempotency Key Pflicht).
4. Proof Issue ist Teil der Definition of Done.

---

## Dead/Unwired Candidates

* MCP Tools (UNWIRED): github.getIssue, github.listIssues, github.createBranch, github.commitFileChanges, github.createPullRequest, github.mergePullRequest; deploy.updateService, deploy.getServiceStatus; observability.metrics.getServiceHealth, observability.getAlarmStatus; runner.run.create, runner.run.execute, runner.run.status, runner.run.read, runner.playbook.list, runner.playbook.get. Source: [mcp-servers/github/src/index.ts](mcp-servers/github/src/index.ts), [mcp-servers/deploy/src/index.ts](mcp-servers/deploy/src/index.ts), [mcp-servers/observability/src/index.ts](mcp-servers/observability/src/index.ts), [mcp-servers/afu9-runner/src/index.ts](mcp-servers/afu9-runner/src/index.ts)
* UNWIRED endpoints: /api/ready (engine). Source: [codefactory-engine/api/ready.ts](codefactory-engine/api/ready.ts)
