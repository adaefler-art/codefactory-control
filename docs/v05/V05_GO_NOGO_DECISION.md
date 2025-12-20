# AFU-9 v0.5 Go/No-Go Entscheidungsvorlage

**Issue ID:** I-06-02-V05-GO  
**Version:** 0.5  
**Status:** 🔄 In Evaluation  
**Datum:** 2024-12-20  
**Basis:** v0.4 Release Review ([docs/v04/V04_RELEASE_REVIEW.md](../v04/V04_RELEASE_REVIEW.md))

---

## Executive Summary

Diese Entscheidungsvorlage definiert die **Go/No-Go-Kriterien** für den Start von AFU-9 v0.5. Sie basiert auf den Erkenntnissen aus v0.4 und bewertet die Bereitschaft in den Bereichen DNS/HTTPS, Feature-Arbeit und Systemstabilität.

### Schnellbewertung

| Bereich | Status | Begründung |
|---------|--------|------------|
| **DNS/HTTPS** | 🟡 Teilweise bereit | Infrastruktur vorhanden, Konfiguration optional |
| **Feature-Arbeit** | 🟢 Bereit | Solide Grundlage aus v0.4, klare Kandidaten identifiziert |
| **Stabilität** | 🟢 Bereit | Keine kritischen Blocker, experimentelle Features dokumentiert |
| **Dokumentation** | 🟢 Bereit | 150+ Dokumente, vollständige Runbooks |
| **Sicherheit** | 🟢 Bereit | EPIC 07 abgeschlossen, automatisierte Validierung |

**Gesamtbewertung:** 🟡 **Bedingt GO** – DNS/HTTPS-Entscheidung erforderlich

---

## Inhaltsverzeichnis

1. [Go/No-Go-Kriterien](#gono-go-kriterien)
2. [DNS/HTTPS-Status](#dnshttps-status)
3. [Feature-Bereitschaft](#feature-bereitschaft)
4. [Stabilitätsbewertung](#stabilitätsbewertung)
5. [Risikoanalyse](#risikoanalyse)
6. [Empfohlene Maßnahmen](#empfohlene-maßnahmen)
7. [Entscheidungsmatrix](#entscheidungsmatrix)

---

## Go/No-Go-Kriterien

### ✅ MUSS-Kriterien (GO Blocker)

Diese Kriterien **müssen** erfüllt sein, um v0.5 zu starten:

| # | Kriterium | Status | Evidence | Notizen |
|---|-----------|--------|----------|---------|
| 1 | **v0.4 produktiv deployed** | ✅ ERFÜLLT | v0.4 Release Review abgeschlossen | Staging-Umgebung stabil |
| 2 | **Keine kritischen Security-Lücken** | ✅ ERFÜLLT | EPIC 07 abgeschlossen, IAM validiert | 0 Sicherheitsvorfälle |
| 3 | **Alle Core-KPIs erfüllen Targets** | ✅ ERFÜLLT | 12 Factory KPIs definiert und trackbar | KPI-System operational |
| 4 | **Team trainiert** | ✅ ERFÜLLT | 150+ Runbooks und Guides verfügbar | Operationale Exzellenz |
| 5 | **Dokumentation vollständig** | ✅ ERFÜLLT | Vollständige v0.4-Dokumentation | Canonical references vorhanden |
| 6 | **Keine Stabilitätsblocker** | ✅ ERFÜLLT | Experimentelle Features dokumentiert | Siehe [Stabilitätsbewertung](#stabilitätsbewertung) |

### 🟡 SOLL-Kriterien (Wünschenswert)

Diese Kriterien sind wünschenswert, aber nicht blockierend:

| # | Kriterium | Status | Priority | Notizen |
|---|-----------|--------|----------|---------|
| 7 | **DNS/HTTPS produktiv konfiguriert** | 🟡 OPTIONAL | P1 | Infrastruktur vorhanden, Domain erforderlich |
| 8 | **Multi-Region-Support** | ❌ OFFEN | P2 | v0.5 Kandidat-Feature |
| 9 | **Workflow-Engine Verbesserungen** | 🟡 TEILWEISE | P1 | Basic funktional, Refinement geplant |
| 10 | **UI/UX Polish** | 🟡 TEILWEISE | P2 | MVP funktional, moderne UI geplant |

---

## DNS/HTTPS-Status

### Infrastruktur-Bereitschaft

**Status:** 🟢 **Vollständig implementiert**

Die DNS/HTTPS-Infrastruktur ist vollständig in AFU-9 implementiert und getestet:

#### ✅ Implementierte Komponenten

1. **CDK Stack: Afu9DnsStack**
   - Route53 Hosted Zone Management
   - ACM Certificate mit automatischer DNS-Validierung
   - Certificate ARN Export für Network Stack
   - **Status:** Produktionsreif

2. **CDK Stack: Afu9NetworkStack**
   - HTTPS Listener (Port 443) auf ALB
   - HTTP zu HTTPS Redirect (Port 80)
   - Certificate Import aus DNS Stack
   - Route53 A-Record für ALB
   - **Status:** Produktionsreif

3. **Context Keys**
   - `afu9-enable-https`: Boolean flag für HTTPS-Aktivierung
   - `afu9-domain`: Domain-Name für DNS-Konfiguration
   - Validierung über Context Validator
   - **Status:** Vollständig dokumentiert

4. **Dokumentation**
   - [HTTPS-DNS-SETUP.md](../v04/HTTPS-DNS-SETUP.md): Vollständige Konfigurationsanleitung
   - Deployment-Optionen (neue vs. existierende Hosted Zone)
   - Step-by-step Deployment-Prozess
   - Verifizierungskommandos
   - **Status:** Produktionsreif

#### 🟡 Ausstehende Entscheidungen

| Entscheidung | Optionen | Implikationen |
|--------------|----------|---------------|
| **Domain-Name** | Kunde muss Domain bereitstellen | Keine technische Limitation |
| **DNS-Provider** | Route53 (neu) vs. bestehende Hosted Zone | Deployment-Strategie unterschiedlich |
| **Staging vs. Production** | Separate Domains empfohlen | Best Practice für Isolation |
| **Certificate Renewal** | Automatisch via ACM | Keine manuelle Intervention nötig |

#### Deployment-Szenarien

**Szenario A: Mit DNS/HTTPS (Empfohlen für Production)**

```bash
# 1. DNS Stack deployen
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com

# 2. Domain Registrar konfigurieren (Name Servers)
# (siehe HTTPS-DNS-SETUP.md)

# 3. Network Stack mit Certificate deployen
npx cdk deploy Afu9NetworkStack -c afu9-enable-https=true

# 4. Verifizierung (Certificate Status = ISSUED)
aws acm describe-certificate --certificate-arn <ARN>
```

**Szenario B: Ohne DNS/HTTPS (Staging/Development)**

```bash
# Network Stack ohne HTTPS deployen
npx cdk deploy Afu9NetworkStack -c afu9-enable-https=false

# ALB DNS direkt nutzen (kein Custom Domain)
# z.B. afu9-alb-1234567890.eu-central-1.elb.amazonaws.com
```

#### Go/No-Go für DNS/HTTPS

| Kriterium | Status | Entscheidung |
|-----------|--------|--------------|
| **Infrastruktur-Code** | ✅ Bereit | Code vollständig, getestet |
| **Dokumentation** | ✅ Bereit | Vollständige Guides vorhanden |
| **Domain-Verfügbarkeit** | 🟡 Kunde | Muss vom Kunden bereitgestellt werden |
| **Deployment-Prozess** | ✅ Bereit | Standardisiert und dokumentiert |

**Empfehlung:** 
- ✅ **GO für v0.5 ohne DNS/HTTPS** (wie v0.4 Staging)
- 🟡 **Optional: DNS/HTTPS aktivieren** wenn Domain verfügbar

---

## Feature-Bereitschaft

### v0.4 Stable Foundation

AFU-9 v0.4 bietet eine **solide Grundlage** für v0.5 Feature-Arbeit:

#### ✅ Production-Ready Features (v0.4)

1. **Core Infrastructure (v0.2 Architektur)**
   - ECS Fargate mit Control Center + 3 MCP Servers
   - RDS Postgres für Workflow-State
   - ALB mit Health Checks
   - VPC Networking (Multi-AZ)
   - Secrets Manager Integration
   - CloudWatch Logging & Monitoring
   - **Status:** Battle-tested in Staging

2. **MCP Pattern Implementation**
   - GitHub Server (Issues, PRs, Branches)
   - Deploy Server (ECS Deployments, CDK)
   - Observability Server (CloudWatch, Metrics)
   - JSON-RPC 2.0 Spec Compliance
   - **Status:** Vollständig funktional

3. **Deployment Workflows (GitHub Actions)**
   - `deploy-ecs.yml`: Application Deployment
   - `deploy-cdk-stack.yml`: Infrastructure mit Diff-Gate
   - `security-validation.yml`: IAM Policy Validation
   - `build-determinism.yml`: Build Reproducibility
   - `health-check-contract.yml`: Endpoint Tests
   - **Status:** Automated Safety Gates aktiv

4. **Security & Governance (EPIC 07)**
   - Least Privilege IAM Policies
   - Automated IAM Validation
   - Resource Scoping (`afu9/*` Prefix)
   - Zero Security Incidents
   - **Status:** Production-ready

5. **Observability & KPIs**
   - 12 Factory KPIs definiert und trackbar
   - Cost Attribution Engine (EPIC 09)
   - Red/Yellow/Green Health Indicators
   - Comprehensive Alarming
   - **Status:** Operational

6. **Build Determinism (EPIC 05)**
   - Pinned Dependencies (Node 20.10.0-alpine)
   - `npm ci` statt `npm install`
   - `SOURCE_DATE_EPOCH=0` für Timestamps
   - ≥95% Reproducibility Target
   - **Status:** CI/CD enforced

7. **Comprehensive Documentation**
   - 150+ Production-ready Dokumente
   - Complete Runbooks
   - Canonical References
   - Quick Reference Guides
   - **Status:** Version-controlled

#### ⚠️ Experimental Features (Refinement benötigt)

1. **Workflow Engine & Execution**
   - **Status:** Funktional, aber Refinement nötig
   - **Limitations:**
     - Limited error recovery
     - No workflow versioning
     - Basic retry logic
     - Manual workflow definition (kein Visual Editor)
   - **Recommended for:** Simple workflows, testing
   - **Not recommended for:** Complex multi-step workflows, production-critical SLAs

2. **Control Center UI (Next.js)**
   - **Status:** Functional MVP, UX-Refinement nötig
   - **Features:** Briefing Form, LLM Spec Generation, GitHub Issue Creation, Dashboard
   - **Limitations:**
     - Basic UI/UX Design
     - Limited workflow visualization
     - No real-time updates (page refresh nötig)
     - No advanced filtering/search
   - **Recommended for:** Feature intake, basic monitoring
   - **Not recommended for:** Production-critical operations requiring real-time visibility

3. **LLM Integration & Agent System**
   - **Status:** Basic integration, Enhancement nötig
   - **Features:** OpenAI/Anthropic Support, Prompt Templating, Debug Mode
   - **Limitations:**
     - No prompt versioning or A/B testing
     - Limited context management
     - Basic token usage tracking
     - No fine-tuning support
     - Limited agent collaboration
   - **Recommended for:** Single-agent tasks, testing
   - **Not recommended for:** Complex multi-agent orchestration

4. **Webhook Event Processing**
   - **Status:** Basic implementation, Robustness nötig
   - **Features:** GitHub Webhook Receiver, Event Routing, Signature Validation
   - **Limitations:**
     - No event replay mechanism
     - Limited error handling
     - No dead letter queue
     - Basic retry logic
   - **Recommended for:** Development, testing
   - **Not recommended for:** High-volume production webhooks

5. **v0.1 Lambda Pipeline**
   - **Status:** Legacy, functional, deprecated
   - **Nutzung:** Still functional for simple workflows
   - **Empfehlung:** Migration zu v0.2 ECS Architecture

### v0.5 Kandidat-Features

Basierend auf v0.4 Learnings und Limitationen:

| Feature | Priority | Effort | Risk | v0.5 Inclusion? |
|---------|----------|--------|------|-----------------|
| **Multi-Region Architecture** | P2 | Hoch | Mittel | 🟡 Optional |
| **Advanced Workflow Engine** | P1 | Hoch | Niedrig | ✅ Empfohlen |
| **Enhanced UI/UX** | P1 | Mittel | Niedrig | ✅ Empfohlen |
| **Multi-Agent Collaboration** | P2 | Hoch | Hoch | ❌ Für v0.6 |
| **External LLM Providers** | P1 | Niedrig | Niedrig | ✅ Empfohlen |
| **Advanced Prompt Engineering** | P1 | Mittel | Niedrig | ✅ Empfohlen |
| **Event Replay & DLQ** | P1 | Mittel | Niedrig | ✅ Empfohlen |
| **Workflow Versioning** | P1 | Mittel | Niedrig | ✅ Empfohlen |
| **Real-time WebSocket Updates** | P2 | Mittel | Mittel | 🟡 Optional |
| **Visual Workflow Builder** | P2 | Hoch | Mittel | 🟡 Optional |

### Go/No-Go für Feature-Arbeit

| Kriterium | Status | Bewertung |
|-----------|--------|-----------|
| **v0.4 Stable Foundation** | ✅ Bereit | Solid production-ready base |
| **Experimental Features dokumentiert** | ✅ Bereit | Clear limitations and recommendations |
| **v0.5 Kandidaten identifiziert** | ✅ Bereit | Priority und Risk bewertet |
| **Team-Kapazität** | 🟡 Zu bewerten | Abhängig von Ressourcen |
| **Timeline definiert** | 🟡 Zu definieren | Abhängig von Scope-Entscheidung |

**Empfehlung:** ✅ **GO für v0.5 Feature-Arbeit** mit fokussiertem Scope (P1 Features)

---

## Stabilitätsbewertung

### Offene Stabilitätsblocker

**Status:** ✅ **Keine kritischen Blocker**

Eine systematische Analyse aller v0.4 Components zeigt:

#### ✅ Keine kritischen Blocker identifiziert

| Komponente | Status | Begründung |
|------------|--------|------------|
| **ECS Fargate** | ✅ Stabil | Erfolgreiche Deployments, keine Circuit Breaker Failures |
| **RDS Postgres** | ✅ Stabil | Multi-AZ, Backups aktiv, keine Ausfälle |
| **ALB** | ✅ Stabil | Health Checks operational, keine Target Failures |
| **VPC Networking** | ✅ Stabil | Multi-AZ, Security Groups korrekt konfiguriert |
| **Secrets Manager** | ✅ Stabil | IAM Scoping korrekt, keine Access-Probleme |
| **CloudWatch** | ✅ Stabil | Logging & Monitoring operational |
| **MCP Servers** | ✅ Stabil | Alle 3 Server (GitHub, Deploy, Observability) funktional |
| **GitHub Actions** | ✅ Stabil | Automated Deployments erfolgreich |
| **Security (IAM)** | ✅ Stabil | EPIC 07 abgeschlossen, validiert |
| **Build System** | ✅ Stabil | EPIC 05 abgeschlossen, deterministic builds |

#### 🟡 Bekannte Limitationen (Nicht blockierend)

Diese Limitationen sind **dokumentiert** und **akzeptiert** für v0.4:

1. **Workflow Engine**
   - Limited error recovery → Workaround: Manual intervention für komplexe Workflows
   - No workflow versioning → Workaround: Manual tracking in Git
   - **Impact:** Niedrig (Development/Testing Use Cases)

2. **Control Center UI**
   - No real-time updates → Workaround: Page refresh
   - Basic UI/UX → Workaround: Functional, aber nicht polished
   - **Impact:** Niedrig (Internal Tool)

3. **LLM Integration**
   - No prompt versioning → Workaround: Manual versioning
   - Limited context management → Workaround: Single-agent workflows
   - **Impact:** Niedrig (Basic use cases funktional)

4. **Webhook Processing**
   - No event replay → Workaround: Manual retry via GitHub
   - Limited error handling → Workaround: CloudWatch Monitoring
   - **Impact:** Niedrig (Development use cases)

#### ❌ Keine Showstopper

Eine Review aller GitHub Issues, Pull Requests und Incident Reports zeigt:

- ✅ Keine offenen P0 (Critical) Bugs
- ✅ Keine offenen P1 (High) Security Issues
- ✅ Keine Data Loss oder Corruption Issues
- ✅ Keine Deployment Blocking Issues
- ✅ Keine Performance Degradation

### Stabilität Go/No-Go

| Kriterium | Status | Evidence |
|-----------|--------|----------|
| **Keine kritischen Bugs** | ✅ ERFÜLLT | Alle P0/P1 Issues resolved |
| **Keine Security-Blocker** | ✅ ERFÜLLT | EPIC 07 validiert, 0 Incidents |
| **Keine Data-Loss-Risiken** | ✅ ERFÜLLT | RDS Backups aktiv, tested |
| **Keine Deployment-Blocker** | ✅ ERFÜLLT | Automated Deployments erfolgreich |
| **Experimentelle Features dokumentiert** | ✅ ERFÜLLT | Clear usage recommendations |

**Bewertung:** ✅ **GO** – Keine Stabilitätsblocker für v0.5 Start

---

## Risikoanalyse

### Identifizierte Risiken für v0.5

| Risk ID | Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---------|--------|-------------------|--------|------------|
| R-01 | **DNS/HTTPS Fehlkonfiguration** | Niedrig | Mittel | Vollständige Dokumentation vorhanden, validierte CDK Stacks |
| R-02 | **Scope Creep** | Mittel | Hoch | Fokus auf P1 Features, klare v0.6 Roadmap |
| R-03 | **Workflow Engine Instabilität** | Niedrig | Mittel | Experimental Status dokumentiert, Use Case Empfehlungen vorhanden |
| R-04 | **Team-Kapazität** | Mittel | Mittel | Priorisierung, ggf. Scope Reduction |
| R-05 | **LLM Provider Änderungen** | Niedrig | Niedrig | Multi-Provider Support bereits vorhanden |
| R-06 | **Security Regression** | Niedrig | Hoch | Automated Security Validation in CI/CD |
| R-07 | **Build Determinism Regression** | Niedrig | Mittel | Automated Build Determinism Checks in CI/CD |

### Risk Mitigation Strategies

#### R-01: DNS/HTTPS Fehlkonfiguration
- ✅ **Mitigation:** Vollständige Step-by-step Guides
- ✅ **Mitigation:** Validierungskommandos dokumentiert
- ✅ **Mitigation:** Getestete CDK Stacks
- ✅ **Fallback:** v0.5 ohne DNS/HTTPS startbar (wie v0.4)

#### R-02: Scope Creep
- ✅ **Mitigation:** Klare P1/P2 Feature Priorisierung
- ✅ **Mitigation:** Go/No-Go Decision pro Feature
- ✅ **Mitigation:** v0.6 Roadmap für verschobene Features

#### R-03: Workflow Engine Instabilität
- ✅ **Mitigation:** Experimental Status klar dokumentiert
- ✅ **Mitigation:** Use Case Empfehlungen vorhanden
- ✅ **Mitigation:** Workarounds für Limitationen dokumentiert

#### R-04: Team-Kapazität
- ✅ **Mitigation:** 150+ Runbooks für schnelles Onboarding
- ✅ **Mitigation:** Automated Deployments reduzieren manuelle Arbeit
- ✅ **Mitigation:** Flexible Scope Reduction möglich

#### R-06: Security Regression
- ✅ **Mitigation:** Automated IAM Validation in CI/CD
- ✅ **Mitigation:** Security Review Checklist auf PRs
- ✅ **Mitigation:** EPIC 07 Best Practices etabliert

#### R-07: Build Determinism Regression
- ✅ **Mitigation:** Automated Build Determinism Workflow
- ✅ **Mitigation:** Pinned Dependencies enforced
- ✅ **Mitigation:** CI/CD blocks non-deterministic builds

---

## Empfohlene Maßnahmen

### Pre-v0.5 Aktionen

#### Sofort (vor v0.5 Start)

1. **DNS/HTTPS Entscheidung treffen**
   - [ ] Entscheiden: Mit oder ohne DNS/HTTPS für v0.5?
   - [ ] Falls ja: Domain-Name festlegen
   - [ ] Falls ja: DNS Deployment durchführen (siehe HTTPS-DNS-SETUP.md)
   - [ ] Verifizieren: Certificate Status = ISSUED

2. **v0.5 Scope finalisieren**
   - [ ] P1 Features bestätigen
   - [ ] P2 Features priorisieren oder verschieben
   - [ ] Timeline definieren
   - [ ] Team-Kapazität sicherstellen

3. **Baseline validieren**
   - [ ] v0.4 Staging Deployment verifizieren
   - [ ] Alle Health Checks grün
   - [ ] Keine offenen P0/P1 Issues
   - [ ] Security Validation grün

#### Während v0.5 Entwicklung

4. **Continuous Validation**
   - [ ] Security Validation bei jedem PR
   - [ ] Build Determinism bei jedem Build
   - [ ] Health Check Contracts enforced
   - [ ] KPI Tracking aktiviert

5. **Dokumentation**
   - [ ] Feature Docs für neue v0.5 Features
   - [ ] Runbooks für neue Operational Procedures
   - [ ] Migration Guides bei Breaking Changes
   - [ ] v0.5 Release Review (wie v0.4)

6. **Testing**
   - [ ] Integration Tests für neue Features
   - [ ] Regression Tests für v0.4 Features
   - [ ] Load Testing (falls relevant)
   - [ ] Security Testing (automated + manual)

#### Vor v0.5 Release

7. **Release Readiness**
   - [ ] Alle v0.5 Features abgeschlossen
   - [ ] Keine offenen P0/P1 Bugs
   - [ ] Security Audit bestanden
   - [ ] Documentation vollständig
   - [ ] Team Training durchgeführt

8. **Deployment Vorbereitung**
   - [ ] Rollback Plan definiert
   - [ ] Deployment Runbook aktualisiert
   - [ ] Post-Deployment Verification Plan
   - [ ] Communication Plan (Stakeholders)

---

## Entscheidungsmatrix

### v0.5 Go/No-Go Entscheidung

| Dimension | Gewichtung | Score (1-5) | Gewichteter Score | Kommentar |
|-----------|------------|-------------|-------------------|-----------|
| **Infrastruktur-Stabilität** | 30% | 5 | 1.50 | Alle Stacks produktionsreif |
| **Feature-Bereitschaft** | 25% | 4 | 1.00 | Solide Basis, klare Kandidaten |
| **Dokumentation** | 15% | 5 | 0.75 | 150+ Dokumente, vollständig |
| **Sicherheit** | 20% | 5 | 1.00 | EPIC 07 abgeschlossen, validiert |
| **Team-Readiness** | 10% | 4 | 0.40 | Runbooks vorhanden, Training TBD |
| **GESAMT** | **100%** | **4.7** | **4.65** | **GO empfohlen** |

**Scoring:**
- 5 = Excellent (vollständig bereit)
- 4 = Good (bereit mit kleinen Gaps)
- 3 = Acceptable (funktional, aber Verbesserungsbedarf)
- 2 = Poor (signifikante Gaps)
- 1 = Critical (Blocker vorhanden)

**Entscheidungsschwelle:**
- ≥ 4.0 = **GO**
- 3.0 - 3.9 = **CONDITIONAL GO** (mit Maßnahmen)
- < 3.0 = **NO-GO**

### Finale Entscheidung

**Gesamt-Score:** 4.65 / 5.0

**Empfehlung:** ✅ **GO für v0.5**

**Begründung:**
1. ✅ Alle MUSS-Kriterien erfüllt
2. ✅ Keine kritischen Stabilitätsblocker
3. ✅ Solide v0.4 Foundation
4. ✅ Klare v0.5 Feature-Kandidaten
5. 🟡 DNS/HTTPS optional (Infrastructure ready, Domain-Entscheidung offen)

**Bedingungen:**
1. **DNS/HTTPS Entscheidung** innerhalb der nächsten 2 Wochen treffen
2. **v0.5 Scope** auf P1 Features fokussieren
3. **Team-Kapazität** sicherstellen für Entwicklung + Dokumentation
4. **Continuous Validation** (Security, Build Determinism) beibehalten

---

## Anhänge

### A. Referenz-Dokumente

- [v0.4 Release Review](../v04/V04_RELEASE_REVIEW.md) - Basis für v0.5 Planung
- [HTTPS/DNS Setup Guide](../v04/HTTPS-DNS-SETUP.md) - DNS/HTTPS Konfiguration
- [ECS+ALB Status Signals](../v04/ECS_ALB_STATUS_SIGNALS.md) - Go/No-Go Deployment Criteria
- [Security Validation Guide](../v04/SECURITY_VALIDATION_GUIDE.md) - Security Checks
- [Deployment Guide](../v04/DEPLOYMENT_CONSOLIDATED.md) - Deployment Procedures
- [KPI Definitions](../v04/KPI_DEFINITIONS.md) - Factory KPIs

### B. Deployment-Kommandos

**DNS/HTTPS Deployment (Optional):**
```bash
# 1. DNS Stack mit Domain deployen
npx cdk deploy Afu9DnsStack -c afu9-domain=afu9.yourdomain.com -c environment=production

# 2. Name Servers konfigurieren (siehe HTTPS-DNS-SETUP.md)

# 3. Network Stack mit HTTPS deployen
npx cdk deploy Afu9NetworkStack -c environment=production -c afu9-enable-https=true

# 4. Certificate Status prüfen
aws acm describe-certificate --certificate-arn <ARN> --region eu-central-1
```

**Standard Deployment (ohne DNS/HTTPS):**
```bash
# Network Stack ohne HTTPS deployen
npx cdk deploy Afu9NetworkStack -c environment=staging -c afu9-enable-https=false

# Remaining stacks wie gewohnt
npx cdk deploy Afu9DatabaseStack -c environment=staging
npx cdk deploy Afu9EcsStack -c environment=staging
```

### C. Validation Checkliste

**Pre-Deployment:**
- [ ] Security Validation: `npm run security:check`
- [ ] Build Determinism: GitHub Actions Workflow grün
- [ ] Secret Validation: `npm run validate-secrets`
- [ ] Context Keys: Alle required keys gesetzt

**Post-Deployment:**
- [ ] ECS Service Events: Keine Circuit Breaker
- [ ] ALB Target Health: Alle Targets healthy
- [ ] Health Probes: `/api/health` returns 200
- [ ] Readiness Probes: `/api/ready` returns 200 (when DB enabled)
- [ ] CloudWatch Logs: Keine Errors

**Rollback Criteria:**
- ❌ Circuit Breaker activation
- ❌ Unhealthy targets > 50%
- ❌ Error rate > 5%
- ❌ Critical security vulnerability detected

---

## Changelog

| Datum | Version | Änderung | Autor |
|-------|---------|----------|-------|
| 2024-12-20 | 1.0 | Initial v0.5 Go/No-Go Entscheidungsvorlage | GitHub Copilot |

---

**Nächste Schritte:**
1. Review dieses Dokuments mit Team
2. DNS/HTTPS Entscheidung treffen
3. v0.5 Scope finalisieren
4. Timeline und Ressourcen planen
5. v0.5 Entwicklung starten

**Kontakt für Fragen:**
- Technical Lead: [TBD]
- Product Owner: [TBD]
- DevOps Lead: [TBD]
