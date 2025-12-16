# AFU-9 Roadmap v0.3 — Kanonische Issue-Datei

Diese Datei ist die **Single Source of Truth** für alle AFU‑9 v0.3 Epics & Issues.
Sie ist bewusst **factory-neutral** formuliert und dient als Input für GitHub
sowie später read-only für AFU‑9.

---

## EPIC 1 — Factory Control Plane v1

### Issue 1.1 — Global Health & Readiness Standard
**Ziel:** Einheitliche Betriebsfähigkeit aller MCP-Server sicherstellen.

**Beschreibung:**
Alle MCP-Server müssen standardisierte `/health` und `/ready` Endpunkte
bereitstellen, inkl. Dependency-Checks.

**Akzeptanzkriterien:**
- `/health` → Prozess lebt
- `/ready` → Abhängigkeiten verfügbar
- Einheitliches JSON-Schema

**Priorität:** P0  
**KPI:** Factory Uptime, MTTR

---

### Issue 1.2 — Central Factory Status API
**Ziel:** Gesamtzustand der Factory aggregiert abrufen.

**Beschreibung:**
Eine API, die Runs, Verdicts, Errors und KPIs konsolidiert zurückliefert.

**Akzeptanzkriterien:**
- Read-only
- Versioniert
- JSON only

**Priorität:** P0  
**KPI:** Mean Time to Insight

---

## EPIC 2 — Verdict Engine v1.1

### Issue 2.1 — Policy Snapshotting pro Run
**Ziel:** Governance-Nachvollziehbarkeit.

**Beschreibung:**
Jeder Run speichert einen unveränderlichen Snapshot aller Policies.

**Akzeptanzkriterien:**
- Snapshot immutable
- Im Verdict referenziert

**Priorität:** P0  
**KPI:** Auditability

---

### Issue 2.2 — Confidence Score Normalisierung
**Ziel:** Vergleichbarkeit von Verdicts.

**Beschreibung:**
Confidence Score muss deterministisch und dokumentiert sein.

**Akzeptanzkriterien:**
- Skala 0–100
- Identische Inputs → identischer Score

**Priorität:** P1  
**KPI:** Verdict Consistency

---

## EPIC 3 — KPI System & Telemetry

### Issue 3.1 — Canonical KPI Definition
**Ziel:** Einheitliche Steuerungsbasis.

**Beschreibung:**
Definition aller Factory-KPIs inkl. Berechnung.

**Akzeptanzkriterien:**
- Dokumentiert
- Versioniert

**Priorität:** P0  
**KPI:** Steering Accuracy

---

### Issue 3.2 — KPI Aggregation Pipeline
**Ziel:** KPIs aus Runs ableiten.

**Beschreibung:**
Pipeline aggregiert KPIs von Run → Product → Factory.

**Akzeptanzkriterien:**
- Reproduzierbar
- Historisiert

**Priorität:** P0  
**KPI:** KPI Freshness

---

## EPIC 4 — Product Registry & Templates

### Issue 4.1 — AFU Product Registry
**Ziel:** Klare Produkt-Isolation.

**Beschreibung:**
Registry für Produkte mit Metadaten, KPIs, Constraints.

**Akzeptanzkriterien:**
- Produkt eindeutig identifizierbar
- KPI-Isolation enforced

**Priorität:** P0  
**KPI:** Cross-Product Isolation

---

## EPIC 5 — Autonomous Build-Test-Deploy Loop

### Issue 5.1 — Deterministic Build Graphs
**Ziel:** Reproduzierbare Builds.

**Beschreibung:**
Builds dürfen keinen impliziten State nutzen.

**Akzeptanzkriterien:**
- Identische Inputs → identischer Output

**Priorität:** P0  
**KPI:** Build Determinism

---

## EPIC 6 — Prompt & Action Canon

### Issue 6.1 — Canonical Prompt Library
**Ziel:** Explizite Factory-Intelligenz.

**Beschreibung:**
Versionierte Prompt-Sammlung mit Breaking-Change-Regeln.

**Akzeptanzkriterien:**
- Jeder Prompt versioniert
- Rückverfolgbar im Run

**Priorität:** P1  
**KPI:** Prompt Stability

---

## EPIC 7 — Security & Blast Radius

### Issue 7.1 — Least Privilege MCP Policies
**Ziel:** Minimale Angriffsfläche.

**Beschreibung:**
Jeder MCP-Server erhält minimal notwendige Rechte.

**Akzeptanzkriterien:**
- IAM Policies geprüft
- Kein Wildcard-Zugriff

**Priorität:** P0  
**KPI:** Security Incidents

---

## EPIC 8 — Factory UI (Read-only)

### Issue 8.1 — Factory Observability UI
**Ziel:** Transparenz ohne Steuerungsmacht.

**Beschreibung:**
UI zeigt Runs, Verdicts, KPIs read-only.

**Akzeptanzkriterien:**
- Keine Mutationspfade
- Echtzeit-Updates

**Priorität:** P1  
**KPI:** Operator Insight

---

## EPIC 9 — Cost & Efficiency Engine

### Issue 9.1 — Cost Attribution per Run
**Ziel:** Wirtschaftliche Steuerung.

**Beschreibung:**
Jeder Run weist Kosten verursachungsgerecht zu.

**Akzeptanzkriterien:**
- AWS-Kosten zuordenbar
- Exportierbar

**Priorität:** P0  
**KPI:** Cost per Outcome

---

_Ende der kanonischen AFU‑9 v0.3 Issue-Datei_
