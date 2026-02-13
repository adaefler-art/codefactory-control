# OpenClaw Spike - Overview

## Kurzprofil

OpenClaw ist ein lokal betriebenes, multi-channel Agent-Gateway mit CLI, das Nachrichtenquellen, Skills/Tools, Modelle, Memory und eine Web-Control-UI zu einem laufenden Assistant-Stack zusammenfuehrt. Der Code fokussiert auf eine zentrale Gateway-Control-Plane (WS/HTTP), plugin-basiertes Erweitern, und lokale Zustands- sowie Sicherheitspruefungen.

## Relevante Subsysteme

- Gateway / Control plane: Gateway-Server, WS/HTTP-Methoden, Control-UI, Channel-Start und Sidecars. Zentral in [src/gateway](../openclaw/src/gateway) und [src/entry.ts](../openclaw/src/entry.ts).
- Skills/Tools: Skill-Laden, Watcher, Prompt-Snapshot, Tool-Integration fuer Agent-Run. Zentral in [src/agents/skills](../openclaw/src/agents/skills) und [skills/](../openclaw/skills).
- Tooling / Plugins: Plugin-Discovery, Registry, CLI-Command-Registrierung, Gateway-Handler-Extension. Zentral in [src/plugins](../openclaw/src/plugins).
- Memory / State: lokales Memory-Indexing mit SQLite + Vektorsuche, Session-Transcripts, Sync und Query. Zentral in [src/memory/manager.ts](../openclaw/src/memory/manager.ts) und [src/sessions](../openclaw/src/sessions).
- Security: Security-Audit, Auth- und Allowlist-Checks, Dateisystem- und Gateway-Sicherheitspruefung. Zentral in [src/security](../openclaw/src/security).

## Aehnlich zu AFU-9 / Anders

Aehnlich:
- zentrale Control-Plane fuer Orchestrierung und Zustandswechsel (OpenClaw Gateway vs. AFU-9 Control Center)
- starke Tool/Skill-Orientierung mit Registry, Konfiguration und Sicherheits-Gating
- Fokus auf Observability (diagnostics, audit, health, status) und robuste Sidecar-Startlogik

Anders:
- OpenClaw ist lokal-first mit WS-Gateway und Channel-Connectors, AFU-9 ist serverseitig mit Issue-Flow-APIs
- OpenClaw integriert End-User Messaging und Device Nodes, AFU-9 ist vorwiegend Repo/Issue/PR-Workflow
- OpenClaw Memory ist eingebaut (SQLite + Vektorsuche), AFU-9 nutzt primar DB/Run-Records statt lokaler Memory-Index

## Reuse-Kandidaten (konkret)

1) Plugin-Loader + Registry fuer optionale Erweiterungen (hohe Wiederverwendbarkeit)
2) Skills-Snapshot + Watcher (Skill-Discovery, Filter, Prompt-Export)
3) Security-Audit Checks (Allowlist/Filesystem/Auth Exposure) als Vorbild fuer AFU-9 Preconditions
