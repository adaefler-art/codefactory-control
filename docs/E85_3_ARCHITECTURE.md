# E85.3: State Flow Viewer - Architecture Diagram

This document shows the architecture and data flow of the State Flow Viewer implementation.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Client)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Issue Detail Page (/issues/[id]/page.tsx)              │  │
│  │                                                          │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │  StateFlowViewer Component                         │ │  │
│  │  │  (StateFlowViewer.tsx)                             │ │  │
│  │  │                                                    │ │  │
│  │  │  - Current State Display                          │ │  │
│  │  │  - Blockers for DONE                              │ │  │
│  │  │  - Valid Next States                              │ │  │
│  │  │  - Next Action Button                             │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                 │                                │
│                                 │ GET /api/issues/[id]/state-flow│
│                                 ▼                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Next.js API Layer (Server)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  API Route Handler                                       │  │
│  │  (/api/issues/[id]/state-flow/route.ts)                 │  │
│  │                                                          │  │
│  │  1. Fetch issue data from database                      │  │
│  │  2. Extract evidence (tests pass, review approved, etc) │  │
│  │  3. Call computeStateFlow()                             │  │
│  │  4. Call getBlockersForDone()                           │  │
│  │  5. Return JSON response                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                      │                      │                    │
│                      │                      │                    │
│                      ▼                      ▼                    │
│            ┌─────────────────┐    ┌──────────────────┐          │
│            │   Database      │    │  State Flow      │          │
│            │   (PostgreSQL)  │    │  Library         │          │
│            │                 │    │  (state-flow.ts) │          │
│            │  - afu9_issues  │    └──────────────────┘          │
│            │  - sync_audit   │             │                    │
│            └─────────────────┘             │                    │
│                                            ▼                    │
│                                  ┌──────────────────┐          │
│                                  │  State Machine   │          │
│                                  │  Loader          │          │
│                                  │  (loader.ts)     │          │
│                                  └──────────────────┘          │
│                                            │                    │
└────────────────────────────────────────────┼────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   File System (State Machine Spec)               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /docs/state-machine/v1/                                        │
│  ├── state-machine.yaml      (State definitions)                │
│  ├── transitions.yaml        (Transition rules)                 │
│  └── github-mapping.yaml     (GitHub integration)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Component Mount

```
User navigates to /issues/[id]
    │
    ├─→ Issue Detail Page renders
    │       │
    │       └─→ StateFlowViewer component mounts
    │               │
    │               └─→ useEffect fires
    │                       │
    │                       └─→ fetchStateFlow()
    │                               │
    │                               └─→ GET /api/issues/[id]/state-flow
```

### 2. API Request Processing

```
GET /api/issues/[id]/state-flow
    │
    ├─→ Parse issue ID from URL
    │
    ├─→ Fetch issue from database
    │       │
    │       └─→ SELECT * FROM afu9_issues WHERE id = $1
    │
    ├─→ Extract evidence from issue data
    │       │
    │       └─→ {
    │             hasCode: execution_state === 'DONE',
    │             testsPass: execution_state === 'DONE',
    │             ... (TODO: GitHub integration)
    │           }
    │
    ├─→ Call computeStateFlow(status, evidence)
    │       │
    │       └─→ loadStateMachineSpec()
    │               │
    │               ├─→ Load state-machine.yaml
    │               ├─→ Load transitions.yaml
    │               └─→ Load github-mapping.yaml
    │
    ├─→ Call getBlockersForDone(status, evidence)
    │
    └─→ Return JSON response
```

### 3. State Flow Computation

```
computeStateFlow(currentStatus, evidence)
    │
    ├─→ Load state machine spec
    │       │
    │       └─→ Get state definition for currentStatus
    │
    ├─→ Get successor states
    │       │
    │       └─→ currentState.successors
    │
    ├─→ For each successor:
    │       │
    │       ├─→ Get transition definition
    │       │       │
    │       │       └─→ getTransition(from, to)
    │       │
    │       ├─→ Check preconditions
    │       │       │
    │       │       └─→ checkPreconditions(transition, evidence)
    │       │
    │       └─→ Build NextState object
    │               │
    │               └─→ {
    │                     state, enabled, transitionType,
    │                     description, blockingReasons
    │                   }
    │
    └─→ Return StateFlowData
```

### 4. Component Rendering

```
StateFlowViewer receives data
    │
    ├─→ Render Current State
    │       │
    │       └─→ Display status badge with color
    │
    ├─→ Render "What's missing for DONE?"
    │       │
    │       └─→ Map blockersForDone to UI elements
    │               │
    │               └─→ Icon + Description for each blocker
    │
    ├─→ Render Valid Next States
    │       │
    │       └─→ For each nextState:
    │               │
    │               ├─→ Radio button (enabled/disabled)
    │               ├─→ State name + transition type
    │               ├─→ Description
    │               └─→ Blocking reasons (if disabled)
    │
    └─→ Render Next Action Button (if enabled state selected)
```

---

## Component Structure

```
StateFlowViewer
├── Props
│   ├── issueId: string
│   ├── readOnly?: boolean
│   └── onStateTransition?: (newState: string) => void
│
├── State
│   ├── stateFlow: StateFlowData | null
│   ├── blockersForDone: BlockingReason[]
│   ├── isLoading: boolean
│   ├── error: string | null
│   └── selectedNextState: string | null
│
├── Effects
│   └── useEffect(() => fetchStateFlow(), [issueId])
│
└── Render Tree
    ├── Loading State
    │   └── Spinner + "Loading state flow..."
    │
    ├── Error State
    │   └── Error message in red box
    │
    └── Loaded State
        ├── Header Section
        │   ├── Title: "State Flow"
        │   └── Subtitle: "Based on E85.1 State Machine Specification"
        │
        ├── Current State Section
        │   ├── Label: "Current State"
        │   ├── Terminal Indicator (if applicable)
        │   └── State Badge (colored, bold)
        │
        ├── Blockers Section (if blockersForDone.length > 0)
        │   ├── Title: "⚡ What's missing to reach DONE?"
        │   └── Blocker List
        │       └── For each blocker:
        │           ├── Icon (based on type)
        │           ├── Description
        │           └── Details (if any)
        │
        ├── Next States Section (if !isTerminal && hasNextStates)
        │   ├── Title: "Valid Next States"
        │   └── Next State List
        │       └── For each nextState:
        │           ├── Radio Button (enabled/disabled)
        │           ├── State Info
        │           │   ├── State Name
        │           │   ├── Transition Type
        │           │   ├── Description
        │           │   └── Enabled/Blocked Badge
        │           └── Blocking Reasons (if !enabled)
        │               └── For each reason:
        │                   ├── Icon
        │                   └── Description
        │
        ├── Action Section (if selectedNextState && enabled && !readOnly)
        │   ├── Transition Button
        │   │   └── "→ Transition to {state}"
        │   └── Info Message
        │       └── "ℹ️ This will change the issue state..."
        │
        └── Terminal State Section (if isTerminal)
            └── Success Message
                └── "✓ This issue has reached a terminal state"
```

---

## Function Call Chain

```
StateFlowViewer.fetchStateFlow()
    │
    └─→ fetch('/api/issues/[id]/state-flow')
            │
            └─→ API Route Handler
                    │
                    ├─→ getPool()
                    │
                    ├─→ pool.query('SELECT * FROM afu9_issues...')
                    │
                    ├─→ computeStateFlow(status, evidence)
                    │       │
                    │       └─→ loadStateMachineSpec()
                    │               │
                    │               ├─→ yaml.load('state-machine.yaml')
                    │               ├─→ yaml.load('transitions.yaml')
                    │               └─→ yaml.load('github-mapping.yaml')
                    │
                    └─→ getBlockersForDone(status, evidence)
```

---

## Type Hierarchy

```
StateFlowData
├── currentState: string
├── isTerminal: boolean
├── nextStates: NextState[]
└── canTransition: boolean

NextState
├── state: string
├── enabled: boolean
├── transitionType: string
├── description: string
└── blockingReasons: BlockingReason[]

BlockingReason
├── type: 'missing_check' | 'missing_review' | 'guardrail' | 'precondition'
├── description: string
└── details?: string
```

---

## Integration Points

```
┌─────────────────────────────────────────────────────────────────┐
│                     External Integration Points                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. E85.1 State Machine Spec (File System)                      │
│     └─→ /docs/state-machine/v1/*.yaml                           │
│                                                                  │
│  2. Database (PostgreSQL)                                        │
│     ├─→ afu9_issues (issue data)                                │
│     └─→ sync_audit_events (future: evidence)                    │
│                                                                  │
│  3. GitHub API (Future)                                          │
│     ├─→ PR status                                                │
│     ├─→ Review approvals                                         │
│     └─→ CI check status                                          │
│                                                                  │
│  4. Issue Detail Page                                            │
│     └─→ Parent component integration                             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security & Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                     Security Layers                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Authentication (Next.js Middleware)                          │
│     └─→ User must be logged in to access page                   │
│                                                                  │
│  2. API Route Protection                                         │
│     └─→ credentials: 'include' in fetch                          │
│                                                                  │
│  3. Read-Only Mode                                               │
│     ├─→ Props: readOnly={true}                                   │
│     └─→ Disables all interactive elements                        │
│                                                                  │
│  4. State Machine Guards (E85.1)                                 │
│     ├─→ Terminal states cannot transition                        │
│     ├─→ Preconditions must be met                                │
│     └─→ Evidence required for transitions                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│                     Error Handling Strategy                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Component Level:                                                │
│  ├─→ Loading state (spinner)                                     │
│  ├─→ Error state (red error box)                                 │
│  └─→ Fallback to minimal state flow                              │
│                                                                  │
│  API Level:                                                      │
│  ├─→ 400: Invalid issue ID                                       │
│  ├─→ 404: Issue not found                                        │
│  └─→ 500: Failed to compute state flow                           │
│                                                                  │
│  State Machine Loader:                                           │
│  ├─→ Missing YAML files: throw Error                             │
│  ├─→ Invalid YAML: throw Error                                   │
│  └─→ Fallback: Empty state machine                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

This architecture diagram provides a comprehensive view of how the State Flow Viewer component integrates with the existing system and processes state transitions based on the E85.1 specification.
