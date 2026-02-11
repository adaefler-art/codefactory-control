# S2 vs S3: Systematischer Vergleich + Delta-Fixplan

## S2 Golden Path

Referenz: control-center/app/api/afu9/s1s3/issues/[id]/spec/route.ts + control-center/app/api/afu9/s1s9/issues/[id]/spec/route.ts

Headers (aus Code):
- Basis (jsonResponse): x-afu9-build-sha, x-afu9-service, x-cf-build-sha, x-cf-build-time, x-cf-service, x-cf-trace, x-request-id (wenn requestId vorhanden)
- Control: x-afu9-auth-path=control, x-afu9-request-id, x-afu9-handler=control, x-afu9-route
- Scope: x-afu9-scope-requested, x-afu9-scope-resolved
- S2 spec handler: x-afu9-stage=S2, x-afu9-handler=<registry handler>, x-cf-handler=s1s3-spec
- Wrapper (s1s9): x-afu9-handler=s1s9-spec, x-afu9-handler-ver=v1, x-afu9-commit=<short sha>, x-cf-handler=s1s9-spec
- Error envelope: x-afu9-error-code (bei Fehlern)

applyHandlerHeaders() enforced:
- Wrapper fängt Exceptions ab, baut jsonResponse und setzt handler headers in jedem Return (try + catch).

Catch-Block / Error-Envelope:
- Wrapper catch -> status 500/502, jsonResponse mit errorCode=spec_ready_failed, requestId, detailsSafe, thrown, errorName, errorMessageSafe, hasStatusField.
- Handler catch -> respondWithSpecError(...) nutzt jsonResponse mit ok=false, code/errorCode, requestId, detailsSafe, upstreamStatus, x-afu9-error-code.

Preconditions:
- Service token enforcement (wenn kein x-afu9-sub und SERVICE_READ_TOKEN konfiguriert).
- Issue-Identifier-Resolution inkl. 404/invalid handling.
- Payload-Validation: scope required, acceptanceCriteria required.
- Issue-State: nur CREATED oder SPEC_READY.
- GitHub mirror metadata erforderlich, sonst 409 spec_invalid_payload.

"BLOCKED" Semantik (Fix aus Commit 6586037a):
- Spec wird zuerst persistiert (updateS1S3IssueSpec).
- Run + Step werden erzeugt.
- Falls Stage config fehlt: Run/Step wird auf BLOCKED gesetzt (status='BLOCKED', blockedReason), githubSync.status='BLOCKED'.
- Response bleibt ok=true, Run/Step enthalten BLOCKED + blockedReason.

## S3 Current Path

Referenz: control-center/app/api/afu9/s1s3/issues/[id]/implement/route.ts + control-center/app/api/afu9/s1s9/issues/[id]/implement/route.ts

Headers (aus Code):
- Handler (s1s3): x-afu9-stage=S3, x-afu9-handler=s1s3-implement, x-afu9-handler-ver=v1, x-afu9-commit=<short sha>, x-cf-handler=s1s3-implement
- Control + Scope: x-afu9-auth-path, x-afu9-request-id, x-afu9-handler=control, x-afu9-route, x-afu9-scope-requested/resolved
- Wrapper (s1s9): x-afu9-handler=s1s9-implement, x-afu9-handler-ver=v1, x-afu9-commit=<short sha>, x-cf-handler=s1s9-implement
- Error envelope: x-afu9-error-code (wenn respondS3Error genutzt wird)

applyHandlerHeaders Nutzung:
- S1S3 handler nutzt applyHandlerHeaders auf allen Success/Error Responses.
- Wrapper setzt applyHandlerHeaders nur auf Rückgaben, aber kein try/catch -> bei Throw keine Handler-Header.

Catch-Block / Error-Envelope:
- Handler catch -> respondS3Error status 500, code=IMPLEMENT_FAILED, detailsSafe.
- Wrapper: kein Catch-Block -> Throw/Exception führt zu 500 ohne standardisierten Envelope/Headers.

Preconditions:
- AFU9_STAGE muss gesetzt sein (sonst 500 ENGINE_MISCONFIGURED).
- Stage config vorhanden (resolveStageMissingConfig) -> 409 GITHUB_AUTH_MISSING + missingConfig.
- Issue lookup (resolveIssueIdentifierOr404) -> VALIDATION_FAILED.
- Spec status: SPEC_READY / IMPLEMENTING / PR_CREATED (sonst 409 SPEC_NOT_READY).
- Mirror/issue metadata (repo_full_name + github_issue_number) -> 409 GITHUB_MIRROR_MISSING.
- Trigger config (label/comment) -> 409 IMPLEMENT_TRIGGER_CONFIG_MISSING.

Upstream Calls + Error Mapping:
- triggerAfu9Implementation (GitHub label/comment) -> 409 GITHUB_AUTH_INVALID (401/403), 409 GITHUB_TARGET_NOT_FOUND (404), 409 GITHUB_VALIDATION_FAILED (422), sonst 502 GITHUB_UPSTREAM_UNREACHABLE.
- RepoAccessDeniedError -> 409 GITHUB_AUTH_INVALID.

## Delta Table (S2 vs S3)

| Kategorie | S2 (spec) | S3 (implement) | Delta / Hypothese |
| --- | --- | --- | --- |
| Wrapper existiert & delegiert | ja (s1s9 -> s1s3) | ja (s1s9 -> s1s3) | gleich |
| applyHandlerHeaders auf jeder Response | ja (try + catch) | nein (nur auf returned Response) | bei Throw fehlen Handler-Header -> upstreamHeaders leer |
| Error envelope im catch | ja (jsonResponse + status mapping) | nein (Wrapper wirft durch) | 500/502 ohne Envelope -> UI zeigt 500/502 + leerer Headerblock |
| 409/422 statt 500 bei Preconditions | ja | ja | gleich |
| GitHub/Auth Guards | n/a / ja | ja | gleich |
| Upstream Fehler-Mapping | ja (spec: 502/404 etc) | ja (401/403/404/422 -> 409) | gleich |
| UpstreamHeaders/handler im UI sichtbar | ja | nein (bei Wrapper-Throw) | Wrapper catch fehlt -> kein Header-Set |

Fazit: S3 unterscheidet sich von S2 in genau 1-2 Punkten: Wrapper hat kein Catch-Envelope + applyHandlerHeaders bei Throw. Das erklaert upstreamHeaders: {} und 500.

## Minimaler Fixplan (nur Deltas)

1. S3 Wrapper (s1s9/implement) wie S2:
   - try/catch einfuehren, jsonResponse mit code/errorCode und detailsSafe.
   - applyHandlerHeaders im catch erzwingen.
   - Response headers via getControlResponseHeaders + buildAfu9ScopeHeaders setzen.

2. Keine weiteren Aenderungen: Handler bleibt unveraendert (Preconditions + Error Mapping sind bereits korrekt).
