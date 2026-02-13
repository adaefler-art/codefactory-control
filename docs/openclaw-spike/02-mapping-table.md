# OpenClaw -> AFU-9 Mapping

| OpenClaw Concept | OpenClaw Location (Repo path / module name) | AFU-9 Analog (Komponente/Epic/Route) | Reuse Potential | Integration Risk (Security/Complexity/Runtime/License) |
| --- | --- | --- | --- | --- |
| Gateway WebSocket/HTTP control plane | src/gateway/server.impl.ts | Control Center API + AFU-9 handlers (control-center/app/api/afu9/...) | Med | Security: Med; Complexity: High; Runtime: Med; License: Low |
| CLI entry + routing | src/entry.ts, src/cli/run-main.ts, openclaw.mjs | AFU-9 operator CLI (scripts/ + control-center tooling) | Low | Security: Low; Complexity: Med; Runtime: Low; License: Low |
| Plugin discovery + registry | src/plugins/loader.ts, src/plugins/registry.ts | AFU-9 extension modules / handler registry | High | Security: Med; Complexity: Med; Runtime: Med; License: Low |
| Skills load + snapshot + watch | src/agents/skills/workspace.ts, src/agents/skills/refresh.ts | AFU-9 tool catalog / prompt assembly | High | Security: Med; Complexity: Med; Runtime: Low; License: Low |
| Channel connectors + routing | src/channels/, src/routing/ | AFU-9 inbound surfaces / request routing | Med | Security: Med; Complexity: High; Runtime: Med; License: Low |
| Memory index + search | src/memory/manager.ts | AFU-9 memory/state retrieval (control-center DB + engine context) | Med | Security: Med; Complexity: High; Runtime: Med; License: Low |
| Session transcripts + state | src/sessions/ | AFU-9 run/step state + issue lifecycle | Low | Security: Low; Complexity: Med; Runtime: Low; License: Low |
| Security audit + hardening | src/security/audit.ts | AFU-9 preflight checks (env/config/policy gates) | High | Security: Low; Complexity: Med; Runtime: Low; License: Low |
| Browser control server | src/gateway/server-browser.ts, src/browser/ | AFU-9 tooling sidecars (browser/automation) | Med | Security: High; Complexity: High; Runtime: Med; License: Low |
| Plugin services (sidecars) | src/plugins/services.ts | AFU-9 async workers / sidecar services | Med | Security: Med; Complexity: Med; Runtime: Med; License: Low |

Stop-Kriterium: Die Tabelle erlaubt mindestens 3 konkrete Reuse-Kandidaten (Plugin-Loader, Skills-Snapshot, Security-Audit).