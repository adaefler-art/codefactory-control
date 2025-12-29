EPIC E6.1 — Issue Lifecycle, Activation & GitHub Handoff (deterministisch)

Ziel: AFU-9 Issues sind vollwertig: Liste/Detail/Edit, eindeutige Aktivierung, Handoff sauber nachvollziehbar.

I6.1.1 — Issue Lifecycle State Machine & Events Ledger

Intent: Status-Transitions sind kanonisch und auditierbar.

AC:

Enum: CREATED → SPEC_READY → IMPLEMENTING → VERIFIED → MERGE_READY → DONE + HOLD/KILLED

issue_events Tabelle (who/when/from/to/reason/payload)

Jede Transition schreibt Event; API validiert erlaubte Transition

Evidence: Contract-Tests für Transition-Validierung.

I6.1.2 — Activate Semantik (maxActive=1) atomar erzwingen

Intent: “Aktives Issue” ist eindeutig und race-safe.

AC:

POST /api/issues/{id}/activate atomar (Transaktion/Lock)

Aktivierung setzt activated_at/by, Status → SPEC_READY

Entweder: (A) deaktiviert vorheriges Active automatisch oder (B) 409 (klar dokumentiert)

Evidence: Test: Activate A, Activate B → definierte Semantik wird eingehalten.

I6.1.3 — GitHub Handoff Metadaten + Idempotenz

Intent: Handoff erzeugt brauchbare GH Issues, ohne Duplikate.

AC:

Payload enthält Canonical ID, Intent, AC, Links, Context (letzte Events)

Speichert github_issue_number, handoff_at, handoff_status, handoff_error

Idempotenz-Key: wiederholter Handoff updatet/verlinkt statt Duplikat

Evidence: Mocked GH Call Test + UI zeigt GH-Link.