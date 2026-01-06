# GitHub Mirror Status Diagnose-Skript

Automatische 3-Schritt-Diagnose für Issue #624: GitHub Mirror Status Persistierung

## Überblick

Das Skript `scripts/diagnose-github-mirror-status.ts` führt eine umfassende Diagnose durch, um Probleme mit der GitHub Mirror Status Synchronisation zu identifizieren.

## Installation

```bash
# Dependencies sind bereits in package.json vorhanden
npm install
```

## Verwendung

### Standard-Diagnose

```bash
npm run ts-node scripts/diagnose-github-mirror-status.ts
```

### Mit Verbose-Ausgabe (SQL-Queries anzeigen)

```bash
npm run ts-node scripts/diagnose-github-mirror-status.ts -- --verbose
```

### Nur Datenbank-Analyse (Sync-Test überspringen)

```bash
npm run ts-node scripts/diagnose-github-mirror-status.ts -- --skip-sync
```

## Umgebungsvariablen

- `DATABASE_URL` (erforderlich): PostgreSQL-Verbindungs-URL
- `SYNC_URL` (optional): Custom URL für Sync-Endpoint (Standard: `http://localhost:3000/api/ops/issues/sync`)

```bash
# Beispiel
DATABASE_URL="postgresql://user:pass@localhost:5432/afu9_control" \
npm run ts-node scripts/diagnose-github-mirror-status.ts
```

## Was wird geprüft?

### [1/3] Datenbank-Analyse

1. **Issue I691 Status**: Prüft das spezifische Problem-Issue
   - `github_mirror_status` sollte nicht UNKNOWN sein
   - `github_issue_last_sync_at` sollte nicht NULL sein
   - `handoff_state` sollte SYNCED sein

2. **Status-Verteilung**: Zeigt Verteilung aller GitHub Mirror Status
   - Wie viele Issues haben UNKNOWN vs. OPEN/CLOSED/ERROR

3. **Nie gesynct**: Zählt Issues mit GitHub-Link aber ohne Sync
   - Sollte idealerweise 0 sein

4. **Letzter Sync**: Wann war der letzte erfolgreiche Sync?
   - Zeigt Anzahl erfolgreich gesyncte Issues

### [2/3] Sync-Endpoint Test

Ruft `POST /api/ops/issues/sync` auf und analysiert:

- `statusFetchOk`: Anzahl erfolgreich gefetchte Issues vom GitHub API
- `statusPersistOk`: Anzahl erfolgreich persistierte Updates
- `statusPersistFailed`: Anzahl fehlgeschlagene Persist-Versuche ⚠️
- `statusSynced`: Anzahl tatsächlich aktualisierte Issues

### [3/3] Diagnose-Ergebnis

Fasst die Ergebnisse zusammen und gibt konkrete nächste Schritte.

## Beispiel-Ausgaben

### ✅ Szenario 1: Alles funktioniert

```
╔═══════════════════════════════════════════════════════════════╗
║  GitHub Mirror Status Diagnose                                ║
╚═══════════════════════════════════════════════════════════════╝

[1/3] Datenbank-Analyse
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Query 1: Issue I691 (GitHub #477)
┌─────────────────────────────────────────────────────────────┐
│ public_id: 6b707209                                          │
│ title: I691 (E69) — GitHub Auth Konsolidierung...            │
│ github_issue_number: 477                                     │
│ github_mirror_status: OPEN ✅                                │
│ github_url: https://github.com/.../issues/477                │
│ handoff_state: SYNCED                                        │
│ github_issue_last_sync_at: 2026-01-06T10:30:00.000Z ✅      │
└─────────────────────────────────────────────────────────────┘

📊 Query 2: GitHub Mirror Status Verteilung
┌─────────────────────────────────────────────────────────────┐
│ 🟢 OPEN       : 45                                           │
│ 🔴 CLOSED     : 22                                           │
│ ─────────────────────────────────────────────────────────────│
│ Total: 67                                                    │
└─────────────────────────────────────────────────────────────┘

📊 Query 3: Issues ohne Sync
✅ 0 Issues wurden niemals gesynct

📊 Query 4: Letzter erfolgreicher Sync
✅ Letzter Sync: 2026-01-06T10:30:15.123Z
✅ Gesyncte Issues: 67

[2/3] Sync-Endpoint Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Sync Response:
┌─────────────────────────────────────────────────────────────┐
│ statusFetchOk: 67 ✅                                         │
│ statusPersistOk: 67 ✅                                       │
│ statusPersistFailed: 0 ✅                                    │
│ statusSynced: 67 ✅                                          │
└─────────────────────────────────────────────────────────────┘

[3/3] Diagnose-Ergebnis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ ERFOLGE:

  1. ✅ 67 Issues erfolgreich gesynct

🔧 NÄCHSTE SCHRITTE:

  → Alles funktioniert wie erwartet! 🎉

╔═══════════════════════════════════════════════════════════════╗
║  ✅ STATUS: ALLES OK                                          ║
╚═══════════════════════════════════════════════════════════════╝
```

### ❌ Szenario 2: Persist schlägt fehl (Aktuelles Problem)

```
╔═══════════════════════════════════════════════════════════════╗
║  GitHub Mirror Status Diagnose                                ║
╚═══════════════════════════════════════════════════════════════╝

[1/3] Datenbank-Analyse
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Query 1: Issue I691 (GitHub #477)
┌─────────────────────────────────────────────────────────────┐
│ public_id: 6b707209                                          │
│ title: I691 (E69) — GitHub Auth Konsolidierung...            │
│ github_issue_number: 477                                     │
│ github_mirror_status: UNKNOWN ❌                             │
│ github_url: https://github.com/.../issues/477                │
│ handoff_state: SYNCED                                        │
│ github_issue_last_sync_at: NULL ⚠️                           │
└─────────────────────────────────────────────────────────────┘

📊 Query 2: GitHub Mirror Status Verteilung
┌─────────────────────────────────────────────────────────────┐
│ ❌ UNKNOWN    : 67                                           │
│ ─────────────────────────────────────────────────────────────│
│ Total: 67                                                    │
└─────────────────────────────────────────────────────────────┘

📊 Query 3: Issues ohne Sync
⚠️ 67 Issues wurden niemals gesynct

📊 Query 4: Letzter erfolgreicher Sync
❌ Keine erfolgreichen Syncs gefunden

[2/3] Sync-Endpoint Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Sync Response:
┌─────────────────────────────────────────────────────────────┐
│ statusFetchOk: 67 ✅                                         │
│ statusPersistOk: 0 ❌                                        │
│ statusPersistFailed: 67 ❌                                   │
│ statusSynced: 0 ⚠️                                           │
└─────────────────────────────────────────────────────────────┘

[3/3] Diagnose-Ergebnis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 PROBLEME GEFUNDEN:

  1. ❌ Issue I691 hat Status UNKNOWN trotz GitHub-Link
  2. ❌ Issue I691 wurde niemals gesynct (github_issue_last_sync_at = NULL)
  3. ❌ Sync fetch funktioniert, aber alle Persist-Versuche schlagen fehl
  4. ❌ 67 Issues konnten nicht persistiert werden
  5. ❌ Keine erfolgreichen Syncs trotz GitHub-Issues in der DB

⚠️  WARNUNGEN:

  1. ⚠️  67 Issues mit GitHub-Link wurden nie gesynct

💡 MÖGLICHE URSACHEN:

  1. ❌ TypeScript-Type-Casting umgeht Compile-Zeit-Checks
     → Prüfe: Record<string, unknown> vs. Partial<Afu9IssueInput>
     → Prüfe: "as any" Casts in updateAfu9Issue Calls
  2. ❌ CHECK Constraint noch nicht aktualisiert
     → Verifiziere Migration 049 wurde angewendet
  3. ❌ RLS Permissions blockieren Write
     → Prüfe ob Service Role verwendet wird

🔧 NÄCHSTE SCHRITTE:

  → Prüfe Server-Logs nach "Persist failed" Fehlern
  → Untersuche control-center/app/api/ops/issues/sync/route.ts
  → Verifiziere Type-Safety in persistPayload
  → Führe aus: psql -c "\d afu9_issues" | grep github_mirror_status

╔═══════════════════════════════════════════════════════════════╗
║  ❌ STATUS: PROBLEM GEFUNDEN                                  ║
╚═══════════════════════════════════════════════════════════════╝
```

### ⚠️ Szenario 3: Sync läuft nicht / Keine Issues

```
╔═══════════════════════════════════════════════════════════════╗
║  GitHub Mirror Status Diagnose                                ║
╚═══════════════════════════════════════════════════════════════╝

[1/3] Datenbank-Analyse
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Query 1: Issue I691 (GitHub #477)
⚠️  Issue I691 nicht gefunden

📊 Query 2: GitHub Mirror Status Verteilung
┌─────────────────────────────────────────────────────────────┐
│ ─────────────────────────────────────────────────────────────│
│ Total: 0                                                     │
└─────────────────────────────────────────────────────────────┘

📊 Query 3: Issues ohne Sync
✅ 0 Issues wurden niemals gesynct

📊 Query 4: Letzter erfolgreicher Sync
❌ Keine erfolgreichen Syncs gefunden

[2/3] Sync-Endpoint Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Sync Response:
┌─────────────────────────────────────────────────────────────┐
│ statusFetchOk: 0 ❌                                          │
│ statusPersistOk: 0 ❌                                        │
│ statusPersistFailed: 0 ✅                                    │
│ statusSynced: 0 ⚠️                                           │
└─────────────────────────────────────────────────────────────┘

[3/3] Diagnose-Ergebnis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  WARNUNGEN:

  1. ⚠️  Keine Issues vom GitHub-API gefetcht

💡 MÖGLICHE URSACHEN:

  1. ⚠️  GitHub API Rate Limit erreicht
  2. ⚠️  Sync läuft nicht automatisch
  3. ⚠️  Keine GitHub-Issues vorhanden

🔧 NÄCHSTE SCHRITTE:

  → Verifiziere Migration 049 wurde angewendet
  → Prüfe RLS Policies auf afu9_issues Tabelle
  → Teste manuellen Sync-Aufruf mit korrekten Credentials

╔═══════════════════════════════════════════════════════════════╗
║  ❌ STATUS: PROBLEM GEFUNDEN                                  ║
╚═══════════════════════════════════════════════════════════════╝
```

## Fehlerbehebung

### "DATABASE_URL environment variable not set"

```bash
# Setze DATABASE_URL vor dem Ausführen
export DATABASE_URL="postgresql://user:pass@localhost:5432/afu9_control"
npm run ts-node scripts/diagnose-github-mirror-status.ts
```

### "Sync-Endpoint Fehler: fetch failed"

1. Stelle sicher, dass der Control Center Server läuft:
   ```bash
   npm --prefix control-center run dev
   ```

2. Oder überspringe den Sync-Test:
   ```bash
   npm run ts-node scripts/diagnose-github-mirror-status.ts -- --skip-sync
   ```

### "HTTP 401: Unauthorized"

Der Sync-Endpoint benötigt eventuell Authentication. Setze `x-afu9-sub` Header oder verwende `--skip-sync`.

## Integration in CI/CD

```yaml
# .github/workflows/diagnostic.yml
- name: Run GitHub Mirror Status Diagnostic
  run: |
    npm run ts-node scripts/diagnose-github-mirror-status.ts
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    SYNC_URL: https://stage.afu-9.com/api/ops/issues/sync
```

## Weitere Informationen

- **Issue #624**: GitHub Mirror Status Persistierung schlägt fehl
- **Migration 049**: Fügt `github_mirror_status` Enum hinzu
- **Sync Route**: `control-center/app/api/ops/issues/sync/route.ts`
- **Type Safety Fix**: Commit `6c8bb67d` - Fix #624

## Verwandte Dateien

- `scripts/diagnose-github-mirror-status.ts` - Diagnose-Skript
- `control-center/app/api/ops/issues/sync/route.ts` - Sync-Endpoint
- `control-center/src/lib/db/afu9Issues.ts` - DB-Operations
- `control-center/src/lib/contracts/afu9Issue.ts` - TypeScript-Contracts
- `control-center/migrations/049_add_github_mirror_status.sql` - Migration
