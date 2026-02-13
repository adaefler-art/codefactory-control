# AFU-9 Risikoanalyse: OpenClaw-Konzepte ohne Destabilisierung

## Executive summary

- Phase 1 (Guardrails Preflight + Audit Snapshot) ist sofort umsetzbar und risikoarm. (ref: 07-poc-plan.md)
- Skills Snapshot/Watcher ist sinnvoll, aber nur mit Manifest + Capability Gating. (ref: 04-skills.md, 06-afu9-guardrails.md)
- Plugin Registry ist hoher Impact und hohes Risiko ohne Signing/Isolation. (ref: 02-mapping-table.md, 05-security.md, 06-afu9-guardrails.md)
- Security Guardrails sind die minimal erforderliche Basis fuer jede weitere Adoption. (ref: 05-security.md, 06-afu9-guardrails.md)
- Prompt injection bleibt der dominante Bedrohungsvektor; Tool/Repo-Write muessen strikt gated sein. (ref: 05-security.md, 06-afu9-guardrails.md)
- Token leakage und repo takeover sind No-Go Risiken ohne scoped tokens + no secret echo. (ref: 05-security.md, 06-afu9-guardrails.md)
- Plugin/Skill Supply Chain braucht Signing + Hash Pinning + Provenance. (ref: 06-afu9-guardrails.md)
- Entscheidung: PoC Phase 1 starten, Plugin Registry erst nach Go-Kriterien. (ref: 07-poc-plan.md)

## What we can safely adopt now

- Guardrails Preflight + Audit Snapshot (API + headers + policy checks). (ref: 07-poc-plan.md)
- Deterministic audit headers in control routes. (ref: 06-afu9-guardrails.md)

## What we should avoid

- Plugin Registry ohne Signing/Isolation und ohne capability allowlist. (ref: 05-security.md, 06-afu9-guardrails.md)
- Skills Snapshot/Watcher ohne Manifest-Validator und capability gating. (ref: 04-skills.md, 06-afu9-guardrails.md)

## What must be gated behind guardrails

- Repo-write operations (labels/PR/branch). (ref: 05-security.md, 06-afu9-guardrails.md)
- Tool execution/egress. (ref: 05-security.md, 06-afu9-guardrails.md)
- Skill execution (any external binary/installer). (ref: 04-skills.md, 06-afu9-guardrails.md)

## Risk Matrix

| Integration candidate | Benefit | Security risk | Complexity risk | Runtime risk (Edge/Node/Env/Isolation) | Operational risk (deploy, observability, rollback) | Failure modes | Mitigations | AFU-9 fit (Workflow-first vs Plugin-first) | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Security audit + guardrails preflight | High | Low | Med | Node/Env | Low | Incorrect block/allow, missing config detection, header drift | Deterministic headers, explicit codes, feature flag rollback, tests | Workflow-first | Adopt now (Phase 1) |
| Skills snapshot + watcher | Med | Med | Med | Node/Env | Med | Stale prompts, missing gating, untrusted skill activation | Manifest validator, capability allowlist, signed skills, audit trail | Workflow-first | Adopt later |
| Plugin discovery + registry | High | High | Med | Node/Isolation | High | Supply-chain compromise, in-process exploit, privilege escalation | Signing + hash pinning, isolate runtime, allowlist publishers | Plugin-first | Do not adopt now |
| Memory/state concepts (optional) | Low | Med | High | Node/Env | Med | Data leakage, index inconsistency, cost spikes | Access controls, redaction, bounded indexing | Workflow-first | Optional later |

(ref: 02-mapping-table.md, 03-openclaw-code-map.md, 04-skills.md, 05-security.md, 06-afu9-guardrails.md, 07-poc-plan.md)

## Threat-model mapping

| Threat | Attack path in AFU-9 | Proposed guardrail | Residual risk |
| --- | --- | --- | --- |
| Prompt injection | Tool exec + repo-write in S3 implement | Capability allowlist + preflight gate + audit headers | Med |
| Data exfiltration | Read tools + logs + outbound egress | Egress allowlist + secret redaction + audit snapshot | Med |
| Malicious skill | Skill execution with hidden scripts | Signed manifest + hash pinning + capability approvals | Med |
| Token leakage | Logs/response bodies | No secret echo + scoped tokens + audit checks | Low |
| Repo takeover | PR/branch/label writes | Repo allowlist + scoped tokens + preflight gate | Low |
| Network exposure | External endpoints | Egress allowlist + preflight checks | Med |
| Plugin supply-chain risk | In-process plugin code | Signed plugins + isolation + allowlist | High (until isolated) |

(ref: 05-security.md, 06-afu9-guardrails.md)

## Blast radius analysis

Malicious skill/plugin added:
- Current AFU-9 posture: No native skill registry, so risk is lower, but any future registry without signing is high risk. (ref: 02-mapping-table.md)
- With OpenClaw-like mechanisms: Risk increases unless signing/hash pinning and capability gating are enforced. (ref: 06-afu9-guardrails.md)
- Non-negotiable: Signed manifest, hash pinning, capability allowlist, audit trail. (ref: 06-afu9-guardrails.md)

GitHub credentials leak:
- Current AFU-9 posture: Tokens are used for repo operations; leak enables repo takeover. (ref: 05-security.md)
- With OpenClaw-like mechanisms: Guardrails reduce exposure only if scoped tokens + no secret echo are enforced. (ref: 06-afu9-guardrails.md)
- Non-negotiable: Scoped tokens, deny secret echo, repo allowlist gate. (ref: 06-afu9-guardrails.md)

Prompt injection in implement stage:
- Current AFU-9 posture: Preflight checks exist but must be standardized and deterministic. (ref: 07-poc-plan.md)
- With OpenClaw-like mechanisms: Tool policy + sandboxing reduces blast radius, but only if enforced. (ref: 05-security.md, 06-afu9-guardrails.md)
- Non-negotiable: Capability gating, deterministic preflight headers, no raw secret in outputs. (ref: 06-afu9-guardrails.md)

## Go/No-Go Criteria (checklist)

Plugin registry:
- [ ] Signing + hash pinning is enforced at load time. (ref: 06-afu9-guardrails.md)
- [ ] Capability allowlist + approvals exist. (ref: 06-afu9-guardrails.md)
- [ ] Runtime isolation is defined (worker/container). (ref: 06-afu9-guardrails.md)
- [ ] Audit headers and policy logs are deterministic. (ref: 06-afu9-guardrails.md)

Skills snapshotting:
- [ ] Manifest schema + validator in place. (ref: 04-skills.md)
- [ ] Capability allowlist + approvals implemented. (ref: 06-afu9-guardrails.md)
- [ ] Signing/hash pinning requirements enforced. (ref: 06-afu9-guardrails.md)
- [ ] Runtime isolation assumptions documented. (ref: 06-afu9-guardrails.md)
- [ ] Audit headers present in skill execution path. (ref: 06-afu9-guardrails.md)

## Concrete next steps

- Phase 1: Guardrails preflight + audit snapshot (no OpenClaw code vendoring). (ref: 07-poc-plan.md)
- Phase 1: Deterministic headers enforced for preflight responses. (ref: 07-poc-plan.md)
- Phase 2: Minimal manifest schema + capability model (optional). (ref: 04-skills.md, 06-afu9-guardrails.md)
- Phase 2: Signed manifest + hash pinning policy. (ref: 06-afu9-guardrails.md)
- Phase 3: Plugin registry only if Go criteria met. (ref: 02-mapping-table.md, 06-afu9-guardrails.md)
- Phase 3: Isolation plan for plugins (worker/container). (ref: 06-afu9-guardrails.md)
