#!/bin/bash
# AFU-9 v0.5 Epic & Issue Import Script
# Requires: gh CLI (authenticated)

REPO="adaefler-art/codefactory-control"

echo "🚀 Creating AFU-9 v0.5 Epics & Issues..."

# ========================================
# EPICS
# ========================================

echo "📋 Creating Epic E5-1..."
EPIC_E5_1=$(gh issue create \
  --repo "$REPO" \
  --title "E5-1: AFU-9 Issue E2E Workflow (CORE)" \
  --body "**Purpose:** Funktionsfähiger, stabiler Issue-Durchstich. 
**Outcome:** AFU-9 kann Issues Create/Read/Update robust, als Basis für Activation/Handoff. 

## Technischer Kontext
- Existierender Code:  \`control-center/app/api/issues/route.ts\`
- DB Schema: \`database/migrations/014_*\`
- Contracts: \`control-center/src/lib/contracts/afu9Issue.ts\`
- UI: \`control-center/app/issues/\`" \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-1 (#$EPIC_E5_1)"

echo "📋 Creating Epic E5-2..."
EPIC_E5_2=$(gh issue create \
  --repo "$REPO" \
  --title "E5-2: Activation & Execution Semantics" \
  --body "**Purpose:** Deterministische Aktivierung (kein Parallelismus).
**Outcome:** Exactly one active issue; Status Mapping konsistent.

## Technischer Kontext
- Single-Active Enforcement: \`control-center/src/lib/db/afu9Issues.ts\`
- DB Constraint: Migration 014 \`trigger enforce_single_active_issue\`
- Docs: \`docs/issues/SINGLE_ISSUE_MODE.md\`" \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-2 (#$EPIC_E5_2)"

echo "📋 Creating Epic E5-3..."
EPIC_E5_3=$(gh issue create \
  --repo "$REPO" \
  --title "E5-3: GitHub Handoff Contract" \
  --body "**Purpose:** Saubere Übergabe an GitHub als Execution-Backend.
**Outcome:** AFU-9 Issue → genau ein GitHub Issue, Backlink und Handoff-State.

## Technischer Kontext
- Handoff API: \`control-center/app/api/issues/[id]/handoff/route.ts\`
- GitHub Client: \`control-center/src/lib/clients/github.ts\`
- Idempotenz via \`AFU9-ISSUE: <uuid>\` Marker" \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-3 (#$EPIC_E5_3)"

echo "📋 Creating Epic E5-4..."
EPIC_E5_4=$(gh issue create \
  --repo "$REPO" \
  --title "E5-4: Execution Feedback (Minimal)" \
  --body "**Purpose:** AFU-9 ist nicht „blind". 
**Outcome:** Minimaler Execution-Status am Issue sichtbar.

## Technischer Kontext
- NEU: DB-Schema erweitern (Migration 015)
- Felder: \`execution_state\`, \`execution_started_at\`, \`execution_completed_at\`
- UI Component:  Execution Badge mit Timestamps" \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-4 (#$EPIC_E5_4)"

echo "📋 Creating Epic E5-5..."
EPIC_E5_5=$(gh issue create \
  --repo "$REPO" \
  --title "E5-5: UI & API Robustness" \
  --body "**Purpose:** Keine stillen Fehler mehr.
**Outcome:** Einheitliche JSON-Contracts + UI-Error Surfacing.

## Technischer Kontext
- API Normalization: \`control-center/src/lib/api/normalize-output.ts\`
- Docs: \`docs/architecture/API_BOUNDARY_NORMALIZATION.md\`
- Pattern aus Issue #312" \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-5 (#$EPIC_E5_5)"

echo "📋 Creating Epic E5-6..."
EPIC_E5_6=$(gh issue create \
  --repo "$REPO" \
  --title "E5-6: AFU-9 v0.5 Testlauf" \
  --body "**Purpose:** Nachweis der Funktionsfähigkeit.
**Outcome:** Ein dokumentierter E2E-Testlauf gemäß AFU-9 Testlauf-Template." \
  --label "v0.5,epic" \
  | grep -oP '(?<=issues/)\d+')

echo "✅ Created Epic E5-6 (#$EPIC_E5_6)"

# ========================================
# CHILD ISSUES - Epic E5-1
# ========================================

echo ""
echo "🎯 Creating Child Issues for Epic E5-1..."

gh issue create \
  --repo "$REPO" \
  --title "I5-1.1: Fix Create/Save Flow for Issues" \
  --body "**Epic:** #$EPIC_E5_1

## Scope
- PATCH /api/issues/new implementiert (Create aus Draft)
- JSON-Response immer vorhanden
- createdAt/updatedAt ISO, camelCase

## Acceptance
- Save Changes erzeugt Issue ohne Fehler
- Keine 204/empty responses
- Dates korrekt gerendert

## Technischer Kontext
\`\`\`typescript
// Aktuell: control-center/app/api/issues/route.ts
// POST /api/issues → existiert
// Fehlt:  PATCH /api/issues/new (Draft → Issue)

// Verwende existierende Normalisierung: 
import { normalizeOutput } from '@/lib/api/normalize-output';

const normalized = normalizeOutput(rows);
return NextResponse.json({ issue: normalized });
\`\`\`

## Referenzen
- API Boundary Normalization: \`docs/architecture/API_BOUNDARY_NORMALIZATION.md\`
- Existierende PATCH:  \`control-center/app/api/issues/[id]/route.ts\`" \
  --label "v0.5,issue-system,robustness,epic: E5-1"

gh issue create \
  --repo "$REPO" \
  --title "I5-1.2: Issue Update & Statuswechsel" \
  --body "**Epic:** #$EPIC_E5_1

## Scope
- PATCH /api/issues/{id} stabil
- Statuswechsel CREATED → SPEC_READY → IMPLEMENTING → DONE

## Acceptance
- Edit + Save funktioniert
- Reload zeigt konsistente Daten
- Liste & Detail synchron

## Technischer Kontext
\`\`\`typescript
// Aktueller Status-Enum:
export enum Afu9IssueStatus {
  CREATED = 'CREATED',
  ACTIVE = 'ACTIVE',
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
}

// ERWEITERN auf: 
export enum Afu9IssueStatus {
  CREATED = 'CREATED',
  SPEC_READY = 'SPEC_READY',     // NEU
  IMPLEMENTING = 'IMPLEMENTING',  // NEU
  DONE = 'DONE',
  FAILED = 'FAILED',              // NEU
}
\`\`\`

## Migration nötig
- DB-Enum erweitern:  \`ALTER TYPE afu9_issue_status ADD VALUE 'SPEC_READY'\`
- Existierende ACTIVE → IMPLEMENTING migrieren

## Referenzen
- Issue Model: \`docs/issues/AFU9_ISSUE_MODEL.md\`
- DB Contracts: Issue #297" \
  --label "v0.5,issue-system,epic:E5-1"

gh issue create \
  --repo "$REPO" \
  --title "I5-1.3: Issue Listing & Navigation Robustness" \
  --body "**Epic:** #$EPIC_E5_1

## Scope
- Liste zeigt alle Issues korrekt
- Navigation Liste ↔ Detail stabil

## Acceptance
- Kein Routing-Fallback (new ≠ [id])
- Kein UI-Crash bei Reload

## Technischer Kontext
\`\`\`typescript
// Existierende Liste:  control-center/app/issues/page.tsx
// Routing-Problem beheben:
// app/issues/[id]/page. tsx vs app/issues/new/page.tsx

import { isValidUUID } from '@/lib/utils/uuid-validator';

if (!isValidUUID(id)) {
  notFound(); // Next.js 404
}
\`\`\`

## Referenzen
- UUID Validator: \`control-center/src/lib/utils/uuid-validator.ts\`
- UI Tests: \`__tests__/app/issues/page.test.tsx\`" \
  --label "v0.5,issue-system,robustness,epic:E5-1"

# ========================================
# CHILD ISSUES - Epic E5-2
# ========================================

echo ""
echo "🎯 Creating Child Issues for Epic E5-2..."

gh issue create \
  --repo "$REPO" \
  --title "I5-2.1: Enforce Single Active Issue" \
  --body "**Epic:** #$EPIC_E5_2

## Scope
- Genau ein aktives Issue erlaubt
- Zweite Aktivierung wird blockiert

## Acceptance
- Aktivierung #2 → klare Fehlermeldung
- Zustand bleibt konsistent

## Technischer Kontext
\`\`\`typescript
// BEREITS IMPLEMENTIERT (Issue #307)
// control-center/src/lib/db/afu9Issues.ts

export async function canSetIssueActive(
  pool: pg.Pool,
  issueId?:  string
): Promise<{ success: boolean; error?: string }> {
  const activeIssue = await getActiveIssue(pool);
  if (activeIssue && activeIssue.id !== issueId) {
    return {
      success: false,
      error: \`Issue \${activeIssue.id} is already ACTIVE\`,
    };
  }
  return { success: true };
}
\`\`\`

## Aufgabe:  UI-Ebene absichern
\`\`\`typescript
const handleActivate = async () => {
  const check = await fetch('/api/issues/active-check');
  const { hasActive, activeIssue } = await check. json();
  
  if (hasActive && activeIssue. id !== issue.id) {
    setShowActivationWarning(true); // Modal
    return;
  }
};
\`\`\`

## Referenzen
- Single-Issue Mode: \`docs/issues/SINGLE_ISSUE_MODE.md\`
- Activity Log: \`docs/issues/ACTIVITY_LOG.md\`" \
  --label "v0.5,activation,epic:E5-2"

gh issue create \
  --repo "$REPO" \
  --title "I5-2.2: Activation Status Mapping" \
  --body "**Epic:** #$EPIC_E5_2

## Scope
- Activation setzt Status → IMPLEMENTING
- Deactivation/Completion → DONE / FAILED

## Acceptance
- Statusänderung sichtbar
- Timestamps korrekt

## Technischer Kontext
\`\`\`typescript
// control-center/app/api/issues/[id]/activate/route.ts

export async function POST(request, { params }) {
  // 1. Check Single-Active
  const canActivate = await canSetIssueActive(pool, params.id);
  if (!canActivate.success) {
    return NextResponse.json({ error: canActivate.error }, { status: 409 });
  }
  
  // 2. Auto-Status-Transition
  await updateAfu9Issue(pool, params.id, {
    status:  Afu9IssueStatus. IMPLEMENTING, // NEU! 
    activated_at: new Date().toISOString(),
  });
  
  // 3. Deactivate previous ACTIVE
  if (previousActive) {
    await updateAfu9Issue(pool, previousActive. id, {
      status:  Afu9IssueStatus. DONE,
    });
  }
}
\`\`\`

## Referenzen
- Activation API: \`control-center/app/api/issues/[id]/activate/route.ts\`
- Status-Enum: siehe I5-1.2" \
  --label "v0.5,activation,epic:E5-2"

# ========================================
# CHILD ISSUES - Epic E5-3
# ========================================

echo ""
echo "🎯 Creating Child Issues for Epic E5-3..."

gh issue create \
  --repo "$REPO" \
  --title "I5-3.1: Create GitHub Issue from AFU-9 Issue" \
  --body "**Epic:** #$EPIC_E5_3

## Scope
- AFU-9 Issue → genau ein GitHub Issue
- Titel/Body enthalten AFU-9-Referenz

## Acceptance
- GitHub Issue wird erzeugt
- Backlink gespeichert (URL/ID)

## Technischer Kontext
\`\`\`typescript
// BEREITS IMPLEMENTIERT (Issue #304)
// control-center/app/api/issues/[id]/handoff/route.ts

export async function POST(request, { params }) {
  const issue = await getAfu9Issue(pool, params. id);
  
  // Idempotenz-Check
  if (issue. github_issue_number) {
    return NextResponse.json({
      message: 'Already handed off',
      github_url: issue.github_issue_url,
    });
  }
  
  const githubIssue = await github.createIssue({
    title: issue.title,
    body: \`\${issue.body}\\n\\n---\\n**AFU9-ISSUE:** \${issue. id}\`,
    labels: issue.labels,
  });
  
  await updateAfu9Issue(pool, params.id, {
    handoff_state: 'SYNCED',
    github_issue_number: githubIssue.number,
    github_issue_url: githubIssue.html_url,
  });
}
\`\`\`

## Referenzen
- Handoff API: \`control-center/app/api/issues/[id]/handoff/route. ts\`
- GitHub Client: \`control-center/src/lib/clients/github.ts\`" \
  --label "v0.5,github-handoff,epic:E5-3"

gh issue create \
  --repo "$REPO" \
  --title "I5-3.2: Handoff State Tracking" \
  --body "**Epic:** #$EPIC_E5_3

## Scope
- handoffState:  NONE → SENT → CONFIRMED / FAILED
- Fehler sichtbar im UI

## Acceptance
- Zustand klar erkennbar
- Keine Silent Fails

## Technischer Kontext
\`\`\`typescript
// DB Schema: 
export enum Afu9HandoffState {
  NOT_SENT = 'NOT_SENT',
  SENT = 'SENT',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
}

// UI Error Display:
{issue.handoff_state === 'FAILED' && issue.last_error && (
  <div className=\"bg-red-900/20 border border-red-700\">
    <label>Handoff Error</label>
    <div>{issue.last_error}</div>
    <button onClick={retryHandoff}>Retry Handoff</button>
  </div>
)}
\`\`\`

## Error Handling: 
\`\`\`typescript
try {
  await github.createIssue(... );
  await updateAfu9Issue(pool, id, { handoff_state: 'SYNCED' });
} catch (error) {
  await updateAfu9Issue(pool, id, {
    handoff_state: 'FAILED',
    last_error: error.message,
  });
}
\`\`\`

## Referenzen
- UI Detail: \`docs/issues/UI_DETAIL.md\`" \
  --label "v0.5,github-handoff,robustness,epic:E5-3"

# ========================================
# CHILD ISSUES - Epic E5-4
# ========================================

echo ""
echo "🎯 Creating Child Issues for Epic E5-4..."

gh issue create \
  --repo "$REPO" \
  --title "I5-4.1: Execution State Visibility" \
  --body "**Epic:** #$EPIC_E5_4

## Scope
- Anzeige:  RUNNING / DONE / FAILED
- Letzte Änderung + Timestamp

## Acceptance
- Nutzer sieht Fortschritt
- Reload stabil

## Technischer Kontext
\`\`\`sql
-- NEU: Migration 015_add_execution_state. sql
ALTER TABLE afu9_issues ADD COLUMN execution_state TEXT DEFAULT 'IDLE';
ALTER TABLE afu9_issues ADD COLUMN execution_started_at TIMESTAMPTZ;
ALTER TABLE afu9_issues ADD COLUMN execution_completed_at TIMESTAMPTZ;
ALTER TABLE afu9_issues ADD COLUMN execution_output JSONB;

CREATE TYPE execution_state_enum AS ENUM (
  'IDLE', 'RUNNING', 'DONE', 'FAILED'
);
\`\`\`

## API Update: 
\`\`\`typescript
// control-center/app/api/issues/[id]/execution/route.ts
export async function POST(request, { params }) {
  const { action } = await request.json();
  
  if (action === 'start') {
    await updateAfu9Issue(pool, params.id, {
      execution_state: 'RUNNING',
      execution_started_at: new Date().toISOString(),
    });
  }
}
\`\`\`

## UI Display:
\`\`\`tsx
<ExecutionBadge state={issue.execution_state} />
{issue.execution_state === 'RUNNING' && (
  <div>Started: {formatTimestamp(issue.execution_started_at)}</div>
)}
\`\`\`

## Referenzen
- Issue Model: \`docs/issues/AFU9_ISSUE_MODEL. md\`" \
  --label "v0.5,issue-system,epic:E5-4"

# ========================================
# CHILD ISSUES - Epic E5-5
# ========================================

echo ""
echo "🎯 Creating Child Issues for Epic E5-5..."

gh issue create \
  --repo "$REPO" \
  --title "I5-5.1: API Contracts Hardened" \
  --body "**Epic:** #$EPIC_E5_5

## Scope
- Keine 204 für UI-Endpoints
- Einheitliche JSON-Contracts

## Acceptance
- UI parst jede Response
- Fehler werden angezeigt

## Technischer Kontext
\`\`\`typescript
// PATTERN BEREITS IMPLEMENTIERT (Issue #312)
// control-center/src/lib/api/normalize-output.ts

export function normalizeOutput(data: unknown): unknown {
  if (data instanceof Date) return data. toISOString();
  if (Array.isArray(data)) return data.map(normalizeOutput);
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, normalizeOutput(v)])
    );
  }
  return data;
}

// Contract Validation:
if (! isAfu9IssueOutput(normalized)) {
  throw new Error('Output contract validation failed');
}

return NextResponse.json({ issue: normalized });
\`\`\`

## Aufgabe
Auf ALLE Issue-Routes anwenden

## Referenzen
- API Boundary: \`docs/architecture/API_BOUNDARY_NORMALIZATION.md\`
- Read Contracts: \`docs/db/READ_CONTRACTS.md\`" \
  --label "v0.5,robustness,epic:E5-5"

gh issue create \
  --repo "$REPO" \
  --title "I5-5.2: Error Surface in UI" \
  --body "**Epic:** #$EPIC_E5_5

## Scope
- API-Fehler sichtbar & erklärend
- Kein „Unexpected JSON end"

## Acceptance
- Nutzer versteht Fehlerursache

## Technischer Kontext
\`\`\`typescript
const [error, setError] = useState<string | null>(null);

const handleSave = async () => {
  try {
    const response = await fetch(\`/api/issues/\${id}\`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || \`HTTP \${response.status}\`);
    }
    
    setSuccessMessage('Issue updated successfully');
  } catch (err) {
    setError(err instanceof Error ?  err.message : 'Unknown error');
  }
};
\`\`\`

## Error Display:
\`\`\`tsx
{error && (
  <div className=\"bg-red-900/20 border border-red-700 p-4\">
    <span>⚠️ Error</span>
    <p>{error}</p>
    <button onClick={() => setError(null)}>Dismiss</button>
  </div>
)}
\`\`\`

## Konsistente API-Fehler: 
\`\`\`typescript
return NextResponse.json(
  { 
    error: 'Clear, actionable message',
    code: 'INVALID_INPUT',
    field: 'title',
  },
  { status: 400 }
);
\`\`\`

## Referenzen
- UI Visual: \`docs/issues/UI_VISUAL_DESCRIPTION.md\`" \
  --label "v0.5,robustness,epic:E5-5"

echo ""
echo "✅ All AFU-9 v0.5 Epics & Issues created successfully!"
echo ""
echo "📊 Summary:"
echo "  - 6 Epics:  E5-1 to E5-6"
echo "  - 16 Child Issues"
echo ""
echo "🔗 View all issues: https://github.com/$REPO/issues? q=is%3Aissue+label%3Av0.5"