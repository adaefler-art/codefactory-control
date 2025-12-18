#!/usr/bin/env ts-node
/**
 * Import AFU-9 v0.4 Epics and Issues
 * 
 * This script creates GitHub milestones (for EPICs) and issues for the AFU-9 v0.4 project.
 * The order of creation is important and follows the specification.
 * 
 * Usage:
 *   GITHUB_TOKEN=<token> ts-node scripts/import-afu9-v04-issues.ts
 *   or
 *   GITHUB_TOKEN=<token> npm run import-v04-issues
 */

import { Octokit } from "octokit";

// Configuration
const GITHUB_OWNER = process.env.GITHUB_OWNER || "adaefler-art";
const GITHUB_REPO = process.env.GITHUB_REPO || "codefactory-control";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN environment variable is required");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Epic definitions (will be created as milestones)
interface Epic {
  id: string;
  title: string;
  description: string;
  labels: string[];
}

const epics: Epic[] = [
  {
    id: "EPIC-01-ECS-STABILITY",
    title: "EPIC 1 — ECS Deployment Stabilität (Core)",
    description: `**Epic-ID:** EPIC-01-ECS-STABILITY

**Ziel:** ECS Services deployen deterministisch ohne Circuit Breaker oder Rollbacks.

**Definition of Done:** Afu9EcsStack deployt zuverlässig, Tasks bleiben healthy.`,
    labels: ["epic", "v0.4", "ecs", "stability"]
  },
  {
    id: "EPIC-02-CONFIGURATION",
    title: "EPIC 2 — Konfigurationsklarheit & Feature Flags",
    description: `**Epic-ID:** EPIC-02-CONFIGURATION

**Ziel:** Eindeutige, konsistente Kontext-Flags ohne implizite Defaults.

**Definition of Done:** Alle Feature-Flags sind dokumentiert und werden korrekt verwendet.`,
    labels: ["epic", "v0.4", "configuration"]
  },
  {
    id: "EPIC-03-DEPLOY-SAFETY",
    title: "EPIC 3 — Deploy Safety & Diff-Gates",
    description: `**Epic-ID:** EPIC-03-DEPLOY-SAFETY

**Ziel:** Keine überraschenden Deploys, kein ungewollter ECS Replacement.

**Definition of Done:** Deploy-Gate ist etabliert und dokumentiert.`,
    labels: ["epic", "v0.4", "deploy", "safety"]
  },
  {
    id: "EPIC-04-OBSERVABILITY",
    title: "EPIC 4 — Observability & Health Signale",
    description: `**Epic-ID:** EPIC-04-OBSERVABILITY

**Ziel:** Schnelle, eindeutige Aussage über Betriebszustand.

**Definition of Done:** Health- und Ready-Endpoints sind klar getrennt und dokumentiert.`,
    labels: ["epic", "v0.4", "observability"]
  },
  {
    id: "EPIC-05-RUNBOOKS",
    title: "EPIC 5 — Runbooks & Wissenssicherung",
    description: `**Epic-ID:** EPIC-05-RUNBOOKS

**Ziel:** Wissen ist reproduzierbar, nicht personengebunden.

**Definition of Done:** Runbooks für häufige Fehler sind dokumentiert und copy/paste-ready.`,
    labels: ["epic", "v0.4", "documentation", "runbooks"]
  },
  {
    id: "EPIC-06-RELEASE-CLOSE",
    title: "EPIC 6 — Release-Abschluss & Qualitätssicherung",
    description: `**Epic-ID:** EPIC-06-RELEASE-CLOSE

**Ziel:** v0.4 ist sauber abgeschlossen und referenzierbar.

**Definition of Done:** v0.4 ist dokumentiert und v0.5 Go-Kriterien sind definiert.`,
    labels: ["epic", "v0.4", "release"]
  }
];

// Issue definitions
interface Issue {
  id: string;
  epicId: string;
  title: string;
  body: string;
  labels: string[];
}

const issues: Issue[] = [
  // EPIC 1 Issues
  {
    id: "I-01-01-DB-SECRET-MAPPING",
    epicId: "EPIC-01-ECS-STABILITY",
    title: "Issue 1.1 — Fix: DB Secret-Key Mapping korrigieren",
    body: `**Issue-ID:** I-01-01-DB-SECRET-MAPPING

**Beschreibung:**
Korrigiere das ECS TaskDefinition Secret-Mapping für DATABASE_NAME von \`database\` auf \`dbname\`, passend zur tatsächlichen Struktur des RDS Secrets.

**Akzeptanzkriterien:**
- [ ] Keine ResourceInitializationError mehr
- [ ] Keine STOPPED Tasks wegen Secret-Errors
- [ ] \`cdk diff\` zeigt nur die erwartete Änderung`,
    labels: ["v0.4", "ecs", "secrets", "bugfix"]
  },
  {
    id: "I-01-02-SECRET-PREFLIGHT",
    epicId: "EPIC-01-ECS-STABILITY",
    title: "Issue 1.2 — Guardrail: Secret-Key-Preflight vor Deploy",
    body: `**Issue-ID:** I-01-02-SECRET-PREFLIGHT

**Beschreibung:**
Implementiere einen Preflight-Check (Script oder CDK-Assertion), der sicherstellt, dass alle im Task referenzierten Secret-Keys existieren.

**Akzeptanzkriterien:**
- [ ] Build/Synth schlägt fehl, wenn ein Key fehlt
- [ ] Fehlermeldung nennt Secret + fehlenden Key explizit
- [ ] Lokal + CI nutzbar`,
    labels: ["v0.4", "ecs", "secrets", "validation"]
  },
  {
    id: "I-01-03-ECS-CIRCUIT-DIAG",
    epicId: "EPIC-01-ECS-STABILITY",
    title: "Issue 1.3 — ECS Circuit Breaker Diagnose standardisieren",
    body: `**Issue-ID:** I-01-03-ECS-CIRCUIT-DIAG

**Beschreibung:**
Standardisiere die Diagnose bei ECS Circuit Breaker Events (Service Events, STOPPED Tasks, Logs).

**Akzeptanzkriterien:**
- [ ] Klare Abfolge von Commands dokumentiert
- [ ] Root-Cause innerhalb <10 Minuten identifizierbar
- [ ] Keine Trial-and-Error-Fixes nötig`,
    labels: ["v0.4", "ecs", "documentation", "troubleshooting"]
  },
  // EPIC 2 Issues
  {
    id: "I-02-01-DB-OFF-MODE",
    epicId: "EPIC-02-CONFIGURATION",
    title: "Issue 2.1 — DB-Off Mode vollständig durchziehen",
    body: `**Issue-ID:** I-02-01-DB-OFF-MODE

**Beschreibung:**
\`afu9-enable-database=false\` muss garantieren, dass keine DB-Ressourcen, Secrets oder Env-Mappings in der TaskDefinition landen.

**Akzeptanzkriterien:**
- [ ] \`cdk diff\` zeigt bei DB-off keine DB-Referenzen
- [ ] ECS Tasks starten ohne DB-Abhängigkeit
- [ ] Dokumentation aktualisiert`,
    labels: ["v0.4", "configuration", "database"]
  },
  {
    id: "I-02-02-CONTEXT-NAMES",
    epicId: "EPIC-02-CONFIGURATION",
    title: "Issue 2.2 — Kontext-Namen vereinheitlichen / absichern",
    body: `**Issue-ID:** I-02-02-CONTEXT-NAMES

**Beschreibung:**
Sicherstellen, dass nur kanonische Kontextnamen verwendet werden (afu9-enable-database, afu9-enable-https).
Optional: Warnung/Fail bei falschen Aliases (enableDatabase).

**Akzeptanzkriterien:**
- [ ] Falsche Keys führen zu klarer Fehlermeldung
- [ ] Dokumentierte Liste erlaubter Kontexte`,
    labels: ["v0.4", "configuration", "validation"]
  },
  // EPIC 3 Issues
  {
    id: "I-03-01-DIFF-GATE",
    epicId: "EPIC-03-DEPLOY-SAFETY",
    title: "Issue 3.1 — Verbindlicher Diff-Gate vor Deploy",
    body: `**Issue-ID:** I-03-01-DIFF-GATE

**Beschreibung:**
Definiere einen verbindlichen Diff-Gate: Deploy darf nur erfolgen, wenn der Diff keine unerwarteten Änderungen (ECS Replacement, DNS/ACM) enthält.

**Akzeptanzkriterien:**
- [ ] Klare Kriterien: was blockiert Deploy
- [ ] Dokumentiert im Deploy-Runbook
- [ ] Copilot-/CI-tauglich`,
    labels: ["v0.4", "deploy", "safety", "documentation"]
  },
  {
    id: "I-03-02-DEPLOY-PROMPT",
    epicId: "EPIC-03-DEPLOY-SAFETY",
    title: "Issue 3.2 — Reproduzierbarer Deploy-Prompt (kanonisch)",
    body: `**Issue-ID:** I-03-02-DEPLOY-PROMPT

**Beschreibung:**
Kanonischen VS-Copilot Deploy-Prompt dokumentieren (Build → Synth → Diff → Deploy → Verify).

**Akzeptanzkriterien:**
- [ ] Prompt ist copy/paste-ready
- [ ] Entspricht dem dokumentierten Stand
- [ ] Wird als Referenz genutzt`,
    labels: ["v0.4", "deploy", "documentation"]
  },
  // EPIC 4 Issues
  {
    id: "I-04-01-HEALTH-READY",
    epicId: "EPIC-04-OBSERVABILITY",
    title: "Issue 4.1 — Health vs Ready sauber trennen",
    body: `**Issue-ID:** I-04-01-HEALTH-READY

**Beschreibung:**
Sicherstellen, dass \`/api/health\` und \`/api/ready\` klar getrennte Semantik haben (liveness vs readiness).

**Akzeptanzkriterien:**
- [ ] Health blockiert keine Deploys
- [ ] Ready spiegelt echte Abhängigkeiten
- [ ] Dokumentierte Bedeutung`,
    labels: ["v0.4", "observability", "health-checks"]
  },
  {
    id: "I-04-02-STATUS-SIGNALS",
    epicId: "EPIC-04-OBSERVABILITY",
    title: "Issue 4.2 — ECS + ALB Status als Entscheidungssignale",
    body: `**Issue-ID:** I-04-02-STATUS-SIGNALS

**Beschreibung:**
Definiere die relevanten Status-Signale (ECS Events, Target Health, Probes) als verbindliche Entscheidungsgrundlage.

**Akzeptanzkriterien:**
- [ ] Klare "Go / No-Go"-Kriterien
- [ ] Copy/paste-Commands dokumentiert`,
    labels: ["v0.4", "observability", "documentation"]
  },
  // EPIC 5 Issues
  {
    id: "I-05-01-RUNBOOK-ROLLBACK",
    epicId: "EPIC-05-RUNBOOKS",
    title: "Issue 5.1 — Runbook: UPDATE_ROLLBACK_COMPLETE",
    body: `**Issue-ID:** I-05-01-RUNBOOK-ROLLBACK

**Beschreibung:**
Erstelle ein Runbook für den häufigsten Fehlerfall: UPDATE_ROLLBACK_COMPLETE.

**Akzeptanzkriterien:**
- [ ] Schrittfolge: CFN → ECS → Logs → Fix
- [ ] Typische Fehlerbilder enthalten
- [ ] Copy/paste-ready`,
    labels: ["v0.4", "documentation", "runbooks", "troubleshooting"]
  },
  {
    id: "I-05-02-RUNBOOK-SECRETS",
    epicId: "EPIC-05-RUNBOOKS",
    title: "Issue 5.2 — Runbook: ECS Secret Injection Failures",
    body: `**Issue-ID:** I-05-02-RUNBOOK-SECRETS

**Beschreibung:**
Runbook speziell für Secret-Injection-Fehler (fehlende Keys, falsches Mapping).

**Akzeptanzkriterien:**
- [ ] Verweist auf Preflight-Checks
- [ ] Vermeidet Wiederholungsfehler`,
    labels: ["v0.4", "documentation", "runbooks", "secrets"]
  },
  // EPIC 6 Issues
  {
    id: "I-06-01-RELEASE-REVIEW",
    epicId: "EPIC-06-RELEASE-CLOSE",
    title: "Issue 6.1 — v0.4 Abschluss-Review & Referenzstand",
    body: `**Issue-ID:** I-06-01-RELEASE-REVIEW

**Beschreibung:**
Dokumentiere den finalen v0.4 Stand als Referenz (Was ist stabil? Was bewusst nicht?).

**Akzeptanzkriterien:**
- [ ] Klarer Scope
- [ ] Verweis auf Deploy-Prompt & Runbooks
- [ ] Grundlage für v0.5`,
    labels: ["v0.4", "release", "documentation"]
  },
  {
    id: "I-06-02-V05-GO",
    epicId: "EPIC-06-RELEASE-CLOSE",
    title: "Issue 6.2 — Entscheidungsvorlage für v0.5",
    body: `**Issue-ID:** I-06-02-V05-GO

**Beschreibung:**
Kurze Entscheidungsvorlage: Was ist erfüllt, um v0.5 zu starten (DNS/HTTPS, Feature-Arbeit)?

**Akzeptanzkriterien:**
- [ ] Klare Go/No-Go-Kriterien
- [ ] Keine offenen Stabilitätsblocker`,
    labels: ["v0.4", "release", "planning"]
  }
];

/**
 * Create a milestone for an epic
 */
async function createMilestone(epic: Epic): Promise<number> {
  console.log(`📌 Creating milestone: ${epic.title}`);
  
  try {
    const { data: milestone } = await octokit.rest.issues.createMilestone({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: epic.title,
      description: epic.description,
      state: "open"
    });
    
    console.log(`✅ Created milestone #${milestone.number}: ${epic.title}`);
    return milestone.number;
  } catch (error) {
    console.error(`❌ Error creating milestone ${epic.title}:`, error);
    throw error;
  }
}

/**
 * Create an issue and assign it to a milestone
 */
async function createIssue(issue: Issue, milestoneNumber: number): Promise<void> {
  console.log(`📝 Creating issue: ${issue.title}`);
  
  try {
    const { data: createdIssue } = await octokit.rest.issues.create({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      milestone: milestoneNumber
    });
    
    console.log(`✅ Created issue #${createdIssue.number}: ${issue.title}`);
  } catch (error) {
    console.error(`❌ Error creating issue ${issue.title}:`, error);
    throw error;
  }
}

/**
 * Main function to import all epics and issues
 */
async function main() {
  console.log("🚀 Starting AFU-9 v0.4 Import");
  console.log(`📦 Target: ${GITHUB_OWNER}/${GITHUB_REPO}`);
  console.log(`📊 Will create ${epics.length} milestones and ${issues.length} issues\n`);

  // Create a mapping of epic IDs to milestone numbers
  const epicToMilestone = new Map<string, number>();

  // Step 1: Create all milestones (epics)
  console.log("=== STEP 1: Creating Milestones ===\n");
  for (const epic of epics) {
    const milestoneNumber = await createMilestone(epic);
    epicToMilestone.set(epic.id, milestoneNumber);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n=== STEP 2: Creating Issues ===\n");
  // Step 2: Create all issues and assign to milestones
  for (const issue of issues) {
    const milestoneNumber = epicToMilestone.get(issue.epicId);
    if (!milestoneNumber) {
      console.error(`❌ Milestone not found for epic ${issue.epicId}`);
      continue;
    }
    
    await createIssue(issue, milestoneNumber);
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n✨ Import completed successfully!");
  console.log(`📊 Summary: Created ${epics.length} milestones and ${issues.length} issues`);
}

// Run the import
main().catch((error) => {
  console.error("\n❌ Import failed:", error);
  process.exit(1);
});
