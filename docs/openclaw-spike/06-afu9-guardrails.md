# AFU-9 Guardrails (Derived from OpenClaw Risks)

## Non-negotiables (preconditions + CI policy)

- Repo allowlist: requests muessen auf explizit erlaubte owner/repo matchen.
- Scoped tokens: app installation/permissions minimal, no write ohne explicit policy.
- Deterministic audit headers: `x-afu9-request-id`, `x-afu9-handler`, `x-afu9-phase`, `x-afu9-missing-config` immer gesetzt.
- No secret echo: response bodies und logs muessen secrets redacted sein (deny env names, token patterns).
- Explicit capability gating: jede skill/tool action braucht deklarierte capability + allowlist.
- No unsigned skills: nur signierte/registrierte skill packages; hash pinning Pflicht.
- Preflight errors are actionable: error codes + requiredConfig + missingConfig ohne freie Textdiagnose.

## Skill review pipeline (signing, hash pinning, provenance)

- Manifest registry (source of truth) mit:
  - `name`, `version`, `hash`, `publisher`, `sourceUrl`, `signingKeyId`
- CI enforce:
  - Signature valid (sigstore oder org key)
  - Hash match (artifact + manifest)
  - Provenance attestation (build metadata, repo origin)
- Release gating:
  - required reviewers fuer new capabilities
  - block on missing security scan
- Runtime enforce:
  - hash pinning (no auto-update ohne approval)
  - allowlist by publisher + version range

## Runtime isolation recommendations

- Execution in isolated worker/container per request or per run.
- Network egress policy: default deny; allowlist per capability.
- Filesystem policy: read-only by default, explicit per-path allowlist for writes.
- Secret access: token broker mit short-lived tokens; never expose raw tokens to tools.
- Tool policy: deny-by-default; capability and scope checks enforced in engine.
- Audit trail: start/end events with reason codes, inputs hash, outputs hash.

## Control checks (preconditions) that can be derived

- Repo allowlist gate before any write operations.
- Capability gate before skill/tool invoke.
- Signed manifest + hash check at load time.
- Egress allowlist check on any external fetch.
- Secret redaction check on response/log sinks.

Diese Guardrails sind ausreichend, um konkrete Preconditions in Control-Center sowie CI Policies abzuleiten.
