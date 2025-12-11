# AFU-9 Control Center v0.1

Web-Interface für das AFU-9 (Autonomous Fabrication Unit – Ninefold Architecture) System.

## Features

- **Feature-Erstellung**: Eingabe von Feature-Briefings über ein Web-Formular
- **Automatische Spezifikation**: LLM-basierte Generierung technischer Spezifikationen
- **GitHub-Integration**: Automatische Erstellung von Issues im Zielrepository
- **Status-Tracking**: Übersicht aller erstellten Features

## Setup

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

### Neues Feature erstellen

1. Navigiere zu `/new-feature`
2. Gib einen Feature-Titel ein
3. Schreibe ein detailliertes Briefing in das Textfeld
4. Klicke auf "Feature erstellen"
5. Das System generiert automatisch:
   - Eine technische Spezifikation via LLM
   - Ein GitHub-Issue im konfigurierten Repository
   - Gibt die Issue-URL zurück

### Features anzeigen

Navigiere zu `/features` um eine Liste aller durch AFU-9 erstellten Features zu sehen (v0.1: Platzhalter).

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
- `/new-feature` - Formular für neue Features
- `/features` - Liste aller Features (Platzhalter)
- `/api/features` (POST) - API-Endpoint für Feature-Erstellung

### API Route: `/api/features`

**POST** Request Body:
```json
{
  "title": "Feature-Titel",
  "briefing": "Detailliertes Feature-Briefing..."
}
```

**Response** (Success):
```json
{
  "success": true,
  "url": "https://github.com/org/repo/issues/123",
  "issueNumber": 123,
  "specification": "Generierte Spezifikation..."
}
```

**Response** (Error):
```json
{
  "error": "Fehlermeldung"
}
```

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

## Nächste Schritte (Post v0.1)

- [ ] Feature-Liste aus GitHub-Issues abrufen (Label: `source:afu-9`)
- [ ] Status-Tracking für erstellte Issues
- [ ] Erweiterte Filtering und Suche
- [ ] Integration mit AWS Bedrock als LLM-Alternative
- [ ] Verbindung zum AFU-9 State Machine Pipeline
