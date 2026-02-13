# OpenClaw Code Map

## Top 10 Dateien/Ordner

1) src/gateway/server.impl.ts - Hauptlogik fuer Gateway-Start, Config-Loading, Plugins, Channels, Sidecars.
2) src/gateway/server-startup.ts - Start von Sidecars (Browser, Gmail hooks, Channels, Plugin-Services, Memory).
3) src/entry.ts - CLI Bootstrap (Env-Setup, respawn, CLI Start).
4) src/cli/run-main.ts - CLI Routing, Commander-Programm, Subcommand-Registrierung.
5) src/plugins/loader.ts - Plugin-Discovery, JIT-Loading, Registry-Aufbau.
6) src/plugins/registry.ts - Plugin Registry und Hook/Tool/Channel/Gateway Registrierungen.
7) src/agents/skills/workspace.ts - Skill-Loading, Snapshot/PROMPT-Assembly, Filters.
8) src/agents/skills/refresh.ts - Skills Watcher, Snapshot Versioning.
9) src/memory/manager.ts - Memory Indexing, Embeddings, SQLite/Vektor-Suche.
10) src/security/audit.ts - Security Audit Checks (Files, Gateway Auth, Allowlist).

## Entry-Points (Startpfade)

- CLI: openclaw.mjs -> dist/entry.(m)js (build output) -> src/entry.ts
- CLI Router: src/cli/run-main.ts (Commander, Subcommands, plugin CLI registration)
- Gateway: src/gateway/server.impl.ts (startGatewayServer) und src/gateway/server-startup.ts (sidecars)

## Wo werden Skills geladen/ausgefuehrt?

- Skills werden aus mehreren Quellen geladen (workspace skills/, config skills/, extraDirs, plugin skills) in src/agents/skills/workspace.ts.
- Skill-Ordner werden ueberwacht und Snapshot-Versionen erhoeht in src/agents/skills/refresh.ts.
- Plugin Skills werden via src/agents/skills/plugin-skills.ts aus Plugin-Manifests aufgeloest.
- Die Ausfuehrung erfolgt im Agent-Tooling (pi-agent integration) ueber die erzeugten Skill-Prompts und Tool-Registries.
