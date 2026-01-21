# AFU-9 Control Center

Web-Interface für das AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture) System.

## Features

- **Workflow Management**: Workflow-Definitionen verwalten und Workflows auslösen
- **Agent Monitoring**: LLM-basierte Agent Runs und Token-Statistiken überwachen
- **Repository Management**: Verbundene GitHub-Repositories verwalten
- **Dashboard**: Übersicht über Workflows, Agents, Repositories und System-Status
- **GitHub-Integration**: Webhook-basierte Integration mit GitHub

## Setup

### Voraussetzungen

- **Node.js**: Version 20.x oder höher
- **npm**: Version 10.x oder höher (wird mit Node.js installiert)

Um die installierte Version zu überprüfen:
```bash
node --version  # sollte v20.x.x oder höher anzeigen
npm --version   # sollte 10.x.x oder höher anzeigen
```

### 1. Dependencies installieren

```bash
npm install
```

### 2. Umgebungsvariablen konfigurieren

Kopiere `.env.local.template` zu `.env.local` und fülle die Werte aus:

```bash
cp .env.local.template .env.local
```

Erforderliche Variablen:

- `GITHUB_TOKEN`: GitHub Personal Access Token (PAT)
  - **Erstellen**: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
  - **Erforderliche Berechtigung**: `repo:issues` (read/write)
  - **Format**: `ghp_...` (klassisch) oder `github_pat_...` (fine-grained)
- `GITHUB_OWNER`: GitHub-Organisation oder User (default: `adaefler-art`)
- `GITHUB_REPO`: Zielrepository für Issues (default: `rhythmologicum-connect`)
- `OPENAI_API_KEY`: OpenAI API-Schlüssel für GPT-4o-mini
  - **Erstellen**: [OpenAI Platform](https://platform.openai.com/api-keys)
  - **Format**: `sk-...`

### 3. Development-Server starten

```bash
npm run dev
```

Die Anwendung läuft dann auf [http://localhost:3000](http://localhost:3000)

## Verwendung

### Workflows verwalten

1. Navigiere zu `/workflows`
2. Zeige alle verfügbaren Workflow-Definitionen an
3. Führe Workflows manuell aus oder überwache laufende Executions

### Dashboard

Navigiere zum Dashboard um eine Übersicht über Workflows, Agents, Repositories und System-Status zu sehen.

## Architektur

### Technologie-Stack

- **Framework**: Next.js 16 (App Router)
- **Runtime**: React 19
- **Sprache**: TypeScript
- **Styling**: Tailwind CSS 4
- **LLM**: OpenAI GPT-4o-mini
- **GitHub API**: Octokit

### Routen

- `/` - Startseite mit Navigation
- `/dashboard` - Dashboard mit System-Übersicht
- `/workflows` - Workflow-Management
- `/workflows/[id]` - Workflow-Details
- `/workflows/executions/[id]` - Execution-Details
- `/agents` - Agent Monitoring
- `/repositories` - Repository Management

### API Routes

Alle API-Routen sind dokumentiert in [`docs/API_ROUTES.md`](../docs/API_ROUTES.md).

**Wichtige API-Kategorien:**
- `/api/auth/*` - Authentifizierung
- `/api/issues/*` - AFU-9 Issue-Management
- `/api/workflows/*` - Workflow-Management (persistent)
- `/api/workflow/*` - Workflow-Execution (ad-hoc)
- `/api/webhooks/*` - Webhook-Handler
- `/api/v1/*` - Versionierte APIs (KPIs, Costs, Factory Status)

**Hinweis:** Verwende immer die kanonischen Routen aus der Dokumentation. Deprecated Aliases werden in zukünftigen Versionen entfernt.

## Sicherheit

- **`.env.local`** wird automatisch durch `.gitignore` ausgeschlossen und niemals committed
- **`.env*`** Pattern in `.gitignore` schützt alle Environment-Dateien
- API-Keys werden niemals im Frontend exponiert
- Alle API-Calls laufen über Next.js Server-Side Routes
- **Niemals** Tokens oder API-Keys im Code oder in Commits einchecken

## Deployment

### Production Build

```bash
npm run build
npm start
```

### Umgebungsvariablen im Production

Stelle sicher, dass alle Environment-Variablen in deiner Deployment-Umgebung gesetzt sind (z.B. Vercel, AWS, etc.).

## Entwicklung

### Linting

```bash
npm run lint
```

### TypeScript Check

```bash
npx tsc --noEmit
```

## Zukünftige Erweiterungen (Post v0.1)

Das Control Center wird kontinuierlich ausgebaut. Geplante Erweiterungen umfassen:

### LLM-Provider-Flexibilität
- [ ] **AWS Bedrock Integration**: Alternative zu OpenAI für LLM-basierte Spezifikationsgenerierung
  - Ermöglicht Nutzung von Amazon Titan, Anthropic Claude, und anderen Modellen
  - Verbesserte Datensouveränität und Compliance
  - Kostenoptimierung durch Modellauswahl

### Multi-Repository-Unterstützung
- [ ] **Dynamische Repository-Auswahl**: Auswahl des Ziel-Repositories zur Feature-Erstellungszeit
  - UI-Dropdown für Repository-Auswahl im Feature-Formular
  - Verwaltung mehrerer Repository-Konfigurationen
  - Unterstützung für verschiedene GitHub-Organisationen

### Mandantenfähigkeit (Multi-Tenancy)
- [ ] **Mehrere Kunden/Teams**: Isolierte Workspaces für verschiedene Organisationen
  - Separate Konfigurationen pro Mandant (GitHub-Token, Repositories, LLM-Keys)
  - Rollenbasierte Zugriffskontrolle (RBAC)
  - Mandanten-spezifische Feature-Listen und Dashboards

### Weitere Funktionen
- [ ] Feature-Liste aus GitHub-Issues abrufen (Label: `source:afu-9`)
- [ ] Status-Tracking für erstellte Issues
- [ ] Erweiterte Filtering und Suche
- [ ] Vollständige Integration mit AFU-9 State Machine Pipeline (Lambda/Step Functions)
