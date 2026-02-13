# OpenClaw Skills Deep-Dive (AFU-9 Vergleich)

## Skill discovery/install

OpenClaw Skills sind Ordner mit einer `SKILL.md`. Discovery folgt einer festen Reihenfolge:

1) Bundled skills (shipped mit der Distribution)
2) Managed/local skills: `~/.openclaw/skills`
3) Workspace skills: `<workspace>/skills`
4) Extra skill Ordner: `skills.load.extraDirs` (niedrigste Prioritaet)
5) Plugin skills: via `openclaw.plugin.json` in Plugins (wenn Plugin aktiviert)

Discovery und Merge-Logik: `src/agents/skills/workspace.ts` (loadSkillsFromDir + Merge mit Prioritaet).
Watcher/Hot-Reload: `src/agents/skills/refresh.ts` (chokidar, debounce, snapshot versioning).

Install/Registry:
- ClawHub ist die oeffentliche Registry fuer Skills (CLI `clawhub install` etc.).
- Install-Optionen werden aus Skill-Metadata gelesen (brew/node/go/uv/download) und ueber Gateway gestartet.
- Installer laufen lokal auf dem Gateway-Host (nicht im Client).

Codepfade:
- Loader: `src/agents/skills/workspace.ts`
- Eligibility/Gating: `src/agents/skills/config.ts`, `src/agents/skills-status.ts`
- Install: `src/agents/skills-install.ts`
- Plugin skill discovery: `src/agents/skills/plugin-skills.ts`
- CLI surface: `src/cli/skills-cli.ts`

## Skill interface/contract (Schema, entrypoints, IO)

Skill-Vertrag ist rein dokumentenbasiert:

- `SKILL.md` mit YAML Frontmatter.
- Pflichtfelder: `name`, `description`.
- Optional: `homepage`, `user-invocable`, `disable-model-invocation`, `command-dispatch`, `command-tool`, `command-arg-mode`.
- `metadata` ist ein einzeiliges JSON5 Objekt; OpenClaw liest `metadata.openclaw`.

Metadata Schema (aus Code):
- `metadata.openclaw.requires`: `bins`, `anyBins`, `env`, `config`
- `metadata.openclaw.os`: Plattform-Gating (darwin/linux/win32)
- `metadata.openclaw.primaryEnv`: env alias fuer `skills.entries.<key>.apiKey`
- `metadata.openclaw.install`: Installer-Spez (brew/node/go/uv/download)

Entry/Execution Contract:
- Skills werden als Prompt-Snippet in den Agent-Systemprompt integriert.
- Optionaler Direct Dispatch: `command-dispatch: tool` ruft ein Tool direkt auf (bypasst Model) mit `{ command, commandName, skillName }`.
- Environment Injection pro Agent Run: `skills.entries.*.env` und `apiKey` werden fuer die Dauer der Agent-Execution gesetzt und danach zurueckgesetzt.
- Session Snapshot: Skills werden beim Session-Start gesnapshottet und reused, bis Watcher oder Session-Reset.

## Skill permissions / sandboxing / dangerous capabilities

- Eligibility-Gating ist host-basiert (bin/env/config/os). Fehlende Requirements markieren Skills als ineligible.
- Bundled allowlist: `skills.allowBundled` (default allow, optional blocklist per allowlist).
- Sandbox: Wenn Sessions im Docker-Sandbox laufen, muss das required binary auch im Container existieren.
- Installations-Safety: `skills-install` scannt Skill-Dirs mit `security/skill-scanner` und gibt Warnungen bei suspicious patterns.
- Security-Audit: `src/security/audit.ts` (Basis fuer systemweite Security-Checks, inkl. Plugins/Skills Findings).

Gefaehrliche Faehigkeiten sind nicht explizit typisiert; es gibt aber:
- Bin/Env/Config gating
- Install-Scanner Warnungen
- Sandbox-Optionen im Gateway

## Versioning & compatibility

- Kein explizites semver Feld im `SKILL.md` Schema.
- Versioning erfolgt indirekt ueber Distribution/ClawHub, Git oder installierte Skill-Pakete.
- Compatibility wird durch Skills-Format + Tool-Verfuegbarkeit + Gating erzwungen.

## Skills Beispiele (Referenz)

- `skills/summarize/SKILL.md`: requires `summarize` bin, brew installer, API keys via env.
- `skills/peekaboo/SKILL.md`: macOS-only (`os: [darwin]`), requires `peekaboo` bin, brew installer.
- `skills/spotify-player/SKILL.md`: requires any bin (`spogo` oder `spotify_player`), multiple brew installers.

## Vergleichstabelle: OpenClaw Skill step vs AFU-9

| OpenClaw Skill step | AFU-9 Step (S1/S2/S3...) | Was fehlt AFU-9 | 
| --- | --- | --- |
| Skill discovery (bundled/managed/workspace/plugin) | S1/S2/S3 Handler-Registry + Engine routing | Unified skill registry + precedence rules + plugin skill loading |
| Eligibility gating (bins/env/config/os) | S3 preflight gates (env/config) | Standardisierte skill gating policy (bins/env/os) |
| Prompt snapshot pro Session | Run/step context in Engine | Skill prompt snapshot + reload semantics |
| Direct command dispatch (tool) | Engine tool invocation (if present) | Skill-level command dispatch metadata |
| Install actions via metadata | AFU-9 installer scripts (ad-hoc) | Installer schema + CLI surface |
| Security scan warnings on install | S3 preflight + security summaries | Skill-level code scanning + warnings |

## AFU-9 Skill Proposal v0 (Design)

### Minimal manifest Felder

```yaml
name: <skill-name>
description: <short>
owner: <team|org>
entrypoint:
  kind: prompt | tool
  toolName: <tool>
  argMode: raw
requirements:
  bins: []
  env: []
  config: []
  os: []
install:
  - kind: brew | node | go | uv | download
    id: <string>
    label: <string>
    bins: []
    package/formula/module/url: <string>
version:
  channel: bundled | workspace | registry
  ref: <git-sha|tag|registry-id>
```

### Capability model (allowlist + user approval)

- Capability categories: `filesystem`, `network`, `exec`, `repo-write`, `secrets-read`.
- Default deny for `exec` und `repo-write` ausser explizit allowlisted.
- User approval pro Skill und pro Capability; Speicherung im Control DB.
- Runtime gating: capability checks als Preflight (blocking) + audit log entry.

### Deterministic execution envelope

- Request envelope: `requestId`, `issueId`, `stage`, `phase`, `actor`.
- Skill execution log: `skillName`, `skillVersion`, `toolName`, `capabilities`, `inputsHash`, `outputsHash`.
- Audit trail: start/end events + error classification (preflight/mapped/runtime).
- Deterministic headers: `x-afu9-request-id`, `x-afu9-skill`, `x-afu9-phase`, `x-afu9-missing-config`.

### Ergebnis

Dieses Manifest + Capability-Modell ist ausreichend, um ein AFU-9 Epic in Teilthemen zu schneiden:
- Registry/Discovery
- Manifest Parser + Validator
- Capability Gating + Approval
- Execution Envelope + Audit
- Installer/Updater
