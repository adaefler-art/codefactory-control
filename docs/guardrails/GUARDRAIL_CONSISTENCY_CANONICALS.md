# AFU-9 Guardrail – Consistency Canonicals (v1)

**Date:** 2025-12-25  
**Status:** ACTIVE  
**Source:** Consistency Audit Phase 1  
**Applies to:** AFU-9 Control Center (repo-wide unless stated otherwise)

---

## G-00 Guardrail Precedence

### Rule
Guardrails take precedence over local fixes, Copilot suggestions, expedient solutions, and ad-hoc refactors.

### Implication
If a change violates an existing guardrail, the change **MUST** be reverted or escalated via a guardrail update.

### Scope
- Applies to: all contributors, all automated agents (Copilot, AFU-9 agents)

### Exemptions
- None

### Enforcement
- PR review requirement
- Hygiene consistency issues

---

## G-01 API Handler Wrapping

### Rule
All API route handlers **MUST** be exported via the `withApi` wrapper.

### Scope
- Applies to: `control-center/app/api/**`

### Exemptions
- None

### Rationale
Ensures consistent error shaping, logging, and request-ID propagation.

---

## G-02 API Error Envelope Shape

### Rule
All API error responses **MUST** follow the shape:

```json
{
  "error": "...",
  "requestId": "...",
  "timestamp": "...",
  "details": "optional"
}
```

A top-level success flag **MUST NOT** be used.

### Scope
- Applies to: all JSON API routes

### Exemptions
- Browser redirects in auth routes

---

## G-03 API Success Payload Shape

### Rule
Detail endpoints **MUST** return the resource as the top-level JSON object.

List endpoints **MUST** return `{ items, total, ... }`.

Wrapper objects (e.g. `{ issue: { ... } }`) **MUST NOT** be used.

### Scope
- Applies to: all REST-style API endpoints

### Exemptions
- None

---

## G-04 API Request Type Usage

### Rule
Route handlers **SHOULD** use `NextRequest` when accessing query parameters or Next.js helpers.

### Scope
- Applies to: routes reading query parameters

### Exemptions
- Routes not accessing request metadata

---

## G-05 Request-ID Propagation

### Rule
Mutating routes (POST, PATCH, DELETE) **MUST** set `x-request-id`.

Read-only routes (GET) **SHOULD** set `x-request-id`.

### Scope
- Applies to: all API routes

### Exemptions
- None

---

## G-06 Auth Route Response Negotiation

### Rule
Auth routes **MAY** branch behavior based on `Accept` headers (redirect vs JSON).

Non-auth API routes **MUST** return JSON only.

### Scope
- Applies to: `control-center/app/api/auth/**`

### Exemptions
- None outside auth

---

## G-07 DB Pool Acquisition & Injection

### Rule
Service classes **SHOULD** receive a Pool via constructor injection.

API routes **MAY** call `getPool()` directly when no service layer exists.

### Scope
- Applies to: DB-accessing code

### Exemptions
- Small one-off utilities

---

## G-08 DB Transaction Handling

### Rule
Multi-step write operations **MUST** use explicit transactions (BEGIN / COMMIT / ROLLBACK).

### Scope
Applies to: writes spanning multiple statements or tables

Exemptions: single-statement writes

---

## G-09 Ops Scripts (Bash)

### Rule
Operational Bash scripts **MUST** use strict mode:

```bash
set -euo pipefail
```

And `--flag value` style arguments.

### Scope
- Applies to: `scripts/*.sh`

### Exemptions
- None

---

## G-10 Ops Scripts (PowerShell)

### Rule
PowerShell scripts **SHOULD** use comment-based help and structured output helpers.

### Scope
- Applies to: `scripts/*.ps1`

### Exemptions
- Throwaway or local debug scripts

---

## G-11 Client Routing Params Handling

### Rule
Client pages **MUST** use a single, consistent params strategy per runtime:

- Server Components: object-based params
- Client Components: Promise-based params with `use(params)`

Mixing strategies is not allowed.

### Scope
- Applies to: `app/**/page.tsx`

### Exemptions
- None

---

## G-12 Client Data Fetching & Error Surfacing

### Rule
Client pages **SHOULD** use:

- Explicit loading state
- Explicit error state
- Best-effort parsing of JSON error responses

### Scope
- Applies to: client-side data fetching

### Exemptions
- Trivial read-only pages

---

## G-13 UI Styling Tokens (Page Shell)

### Rule
Page shells **SHOULD** use a single styling-token strategy (palette-based or hex-based) per UI surface.

### Scope
- Applies to: page-level layout shells

### Exemptions
- Leaf components

---

## Status
This document is binding for:

- Hygiene / cleanup epics
- New feature development
- Automated agent output