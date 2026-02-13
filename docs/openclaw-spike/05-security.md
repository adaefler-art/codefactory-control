# OpenClaw Security Spike - Risiko- und Mitigationsbild

## Threat model (5-8 bullets)

- Prompt injection ueber Nachrichten/Links/Anhange fuehrt zu Tool-Missbrauch (exec, browser, write).
- Data exfiltration aus lokalen Dateien, Session-Logs oder Credentials.
- Malicious skill (SKILL.md + scripts) mit versteckten Nebenwirkungen.
- Token leakage ueber Logs, Prompt-echo, env injection oder untrusted content.
- Repo takeover ueber Schreibzugriff (PR/branch creation, labels) bei falscher Policy.
- Network exposure: Gateway ohne Auth oder mit oeffentlicher Exposition.
- Plugin supply-chain risk: in-process execution mit vollem Gateway-Recht.

## OpenClaw mitigations (falls vorhanden)

- Security audit (`openclaw security audit`) mit Fixes fuer DM/Group policies, logging redaction, file perms.
- DM pairing/allowlist und group policy gating (inbound access control).
- Sandbox (Docker) fuer Tools mit separatem workspace, optional ohne Netzwerk.
- Tool policy allow/deny + elevated exec gates.
- Skill gating ueber metadata.openclaw.requires (bins/env/config/os) und allowlist fuer bundled skills.
- Skill install scanner (`security/skill-scanner`) mit Warnungen bei suspicious code.
- Control UI security flags (token/device auth, trusted proxies).

## Gaps/Risiken fuer AFU-9

- Plugins laufen in-process (kein isolation boundary).
- Skill Manifest hat keine Signatur, kein Hash-Pinning, keine Provenance.
- Install/Registry ist soft-gated (ClawHub), aber keine harte CI Enforcierung.
- Capability model ist implizit (bins/env/config), kein explizites privilege set pro skill/tool.
- Audit ist operational, aber kein verpflichtender Preflight in jeder Route.

Quellen (OpenClaw):
- Security: [docs/gateway/security/index.md](../openclaw/docs/gateway/security/index.md)
- Sandboxing: [docs/gateway/sandboxing.md](../openclaw/docs/gateway/sandboxing.md)
- Tool policy/elevated: [docs/gateway/sandbox-vs-tool-policy-vs-elevated.md](../openclaw/docs/gateway/sandbox-vs-tool-policy-vs-elevated.md)
- Skills gating: [docs/tools/skills.md](../openclaw/docs/tools/skills.md)
