# AFU9 Testlauf – AFU9-TL-001

## Zweck
Validierung des vollständigen DB→API→UI-Durchstichs für Deploy-Events:
Ein erfolgreicher Deploy soll automatisch ein Deploy-Event schreiben und im Control Center sichtbar machen.

## Scope
- Deploy-Workflow (GitHub Actions)
- Internal API `/api/internal/deploy-events`
- Postgres Tabelle `deploy_events`
- UI Anzeige „Latest Deploy Event“ im Control Center (Login/Dashboard)

Nicht im Scope:
- Allgemeine DB-Abstraktionen
- Übergreifende Contract-Layer (Folgearbeit)

## Intent
Prüfen, ob AFU-9 in der Lage ist,
- **produktive Deploy-Artefakte** (Deploy-Status) strukturiert zu persistieren
- und diese **zuverlässig im UI darzustellen**,
ohne manuelle Eingriffe oder Copy-&-Paste.

## Ablauf
1. Erweiterung des Deploy-Workflows um „Record deploy event (internal)“
2. Absicherung der API-Route gegen unvollständige Payloads (Validation)
3. Direkter DB-Write-Test via ECS Exec zur Verifikation des Schemas
4. Analyse von Workflow-Runs inkl. Payload, Target-Host und HTTP-Status
5. UI-Fix für korrektes env/service-Filtering und Error-Handling
6. Verifikation:
   - erfolgreicher Deploy
   - automatischer DB-Insert
   - sichtbarer Eintrag im Control Center

## Erwartetes Ergebnis
- Jeder erfolgreiche Deploy erzeugt genau **einen** Deploy-Event-Eintrag
- Pflichtfelder des DB-Schemas werden korrekt gesetzt
- UI zeigt den neuesten Deploy-Event an
- Fehlerfälle sind sichtbar (kein „silent empty state“)

## Ist-Ergebnis
- Deploy-Workflow schreibt automatisch Deploy-Events (staging)
- DB enthält korrekte Einträge (`env`, `service`, `version`, `commit_hash`, `status`, `message`)
- UI zeigt den neuesten Deploy-Event korrekt an
- Fehlerzustände (401/503) werden nicht mehr als „No deploy events found“ maskiert

## Artefakte
- GitHub Actions Run: 20461595180
- Commit (Route + UI Fix): `3edae4af`
- Tabelle: `public.deploy_events`
- API:
  - POST `/api/internal/deploy-events`
  - GET `/api/deploy-events`

## Abweichungen
- Initiale Inkonsistenz zwischen DB-Schema und Writer-Payload
- UI nutzte Default-Fallback `env=prod` ohne explizite Parameter
- Fehlerzustände wurden im UI als „leer“ dargestellt

Alle Abweichungen wurden im Rahmen des Testlaufs behoben.

## Lessons Learned
- DB-Schema ist ein **harter Contract** für alle Writer (Workflow, API)
- env/service dürfen **niemals implizit** gefallbackt werden
- UI muss non-2xx explizit als Fehler darstellen
- DB-Writes müssen vor UI-Integration isoliert testbar sein

## Entscheidung (Verdict)

**AFU9-TL-001: ADOPT ✅**

**Begründung:**
- Der vollständige Durchstich (Workflow → API → DB → UI) funktioniert stabil
- Deploy-Events sind zuverlässig, reproduzierbar und sichtbar
- AFU-9 kann Deploy-Status als produktionsrelevantes Signal verarbeiten

## Folgepunkte (nicht Teil dieses Testlaufs)
- Einführung eines übergreifenden DB-Contract-Layers (Validation + Insert-Helper)
- Roadmap-Gate: „DB E2E green“ vor Feature-Abhängigkeiten

- ADJUST Issue: https://github.com/adaefler-art/codefactory-control/issues/218