# E78.3 Implementation Summary: Tuning Suggestions Generator

## Issue: I783 - Tuning Suggestions Generator (E78.3)

**Goal**: Implement a deterministic tuning suggestions generator that proposes improvements to playbooks/rules/guardrails based on outcomes and KPI trends. Suggestions only, no auto-apply.

---

## Implementation Overview

### 1. Contract Schema (TypeScript + Zod)

**File**: `control-center/src/lib/contracts/tuning-suggestions.ts`

- **Version**: 0.7.0
- **Schema Structure**:
  - `suggestionId`: Stable hash (first 16 chars of SHA-256)
  - `type`: PLAYBOOK_TUNING | CLASSIFIER_RULE | EVIDENCE_GAP | GUARDRAIL
  - `title`: Human-readable suggestion title
  - `rationale`: Evidence-based justification
  - `proposedChange`: Text or structured change proposal
  - `expectedImpact`: Predicted outcome (e.g., "Reduce MTTR by 15%")
  - `confidence`: low | medium | high
  - `references`: Links to outcomeIds, incidentIds, kpiWindowRefs, evidenceHashes
  - `status`: PROPOSED (future: accepted/rejected)

**Key Functions**:
- `computeSuggestionHash()`: Deterministic SHA-256 hash (excludes generatedAt/suggestionId)
- `computeSuggestionId()`: Stable 16-char identifier
- `validateTuningSuggestion()`: Zod-based validation

---

### 2. Database Migration

**File**: `database/migrations/046_tuning_suggestions.sql`

**Table**: `tuning_suggestions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `window` | TEXT | Aggregation window (daily/weekly/release/custom) |
| `window_start` | TIMESTAMPTZ | Window start (inclusive) |
| `window_end` | TIMESTAMPTZ | Window end (exclusive) |
| `suggestion_hash` | TEXT | SHA-256 of suggestion content |
| `suggestion_json` | JSONB | Version-controlled suggestion artifact |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Indexes**:
- Unique: `(window, window_start, window_end, suggestion_hash)` - idempotency
- `window, window_start DESC` - window queries
- `created_at DESC` - time-based queries
- `suggestion_hash` - hash lookups
- GIN on `suggestion_json` - JSONB queries

---

### 3. Generator Service

**File**: `control-center/src/lib/tuning-suggestions-service.ts`

**Rule Engine (6 rules)**:

1. **ruleHighUnknownRate**: UNKNOWN classification > 20% → suggest classifier rules
2. **ruleVerificationRerunSuccess**: Verification rerun success > 60% → promote playbook I772
3. **ruleLkgRedeployFailures**: LKG redeploy failure > 30% → tighten LKG criteria
4. **ruleHighMttrCategory**: MTTR > 2hrs for ALB incidents → add pre-check evidence
5. **ruleMissingLogPointers**: Missing log pointers > 40% → improve evidence ingestion
6. **ruleLowAutoFixRate**: Auto-fix < 30% → review guardrails/evidence requirements

**Data Inputs**:
- `outcome_records`: Postmortem data, metrics, remediation attempts
- `incidents`: Classification, severity, status
- `kpi_aggregates`: Window-based KPI metrics (MTTR, auto-fix rate, etc.)

**Key Functions**:
- `generateTuningSuggestions()`: Main generator (deterministic, idempotent)
- `getTuningSuggestions()`: Retrieve suggestions by window/date range
- `collectDataInputs()`: Gather evidence from DB

**Deterministic Properties**:
- Rules applied in fixed order
- Suggestions sorted by confidence (high → medium → low), then by type
- Same inputs → same suggestion_hash → idempotent DB insert

**Conservative Approach**:
- Minimum data thresholds (e.g., 3+ outcomes for verification rule)
- Returns empty when data insufficient (< 3 total data points)
- Confidence scoring based on evidence strength

---

### 4. API Routes

#### GET `/api/tuning`
**File**: `control-center/app/api/tuning/route.ts`

Retrieve tuning suggestions for a time range.

**Query Parameters**:
- `window`: daily | weekly | release | custom (optional)
- `from`: ISO 8601 timestamp (optional)
- `to`: ISO 8601 timestamp (optional)
- `limit`: Max results (default: 50, max: 200)

**Response**:
```json
{
  "success": true,
  "suggestions": [...],
  "count": 5,
  "hasMore": false,
  "filters": { "window": "daily", "from": "...", "to": "...", "limit": 50 }
}
```

#### POST `/api/tuning/generate`
**File**: `control-center/app/api/tuning/generate/route.ts`

Generate tuning suggestions for a specified window.

**Request Body**:
```json
{
  "window": "daily",
  "windowStart": "2025-01-01T00:00:00Z",
  "windowEnd": "2025-01-02T00:00:00Z"
}
```

**Response**:
```json
{
  "success": true,
  "suggestions": [...],
  "count": 3,
  "isNew": true,
  "metadata": {
    "window": "daily",
    "windowStart": "2025-01-01T00:00:00Z",
    "windowEnd": "2025-01-02T00:00:00Z",
    "rulesApplied": ["ruleHighUnknownRate", "ruleMissingLogPointers"],
    "dataPoints": {
      "outcomeCount": 15,
      "incidentCount": 8,
      "kpiAggregateCount": 4
    }
  }
}
```

**Authentication**: Both routes require `x-afu9-sub` header (JWT-verified by proxy)

---

### 5. Tests

**File**: `control-center/__tests__/lib/tuning-suggestions.test.ts`

**Test Coverage**:
1. ✅ Returns empty suggestions with insufficient data
2. ✅ Generates deterministic suggestion hash
3. ✅ Generates stable suggestion ID
4. ✅ Generates suggestions for high UNKNOWN rate
5. ✅ Idempotent generation (same inputs → same results)
6. ✅ Validates suggestion references exist (no dangling IDs)
7. ✅ Retrieves suggestions by window and date range
8. ✅ Suggestion schema includes all required fields

**Test Strategy**:
- Uses real PostgreSQL connection (skip if DATABASE_URL not set)
- Creates/cleans up test data (incidents, outcomes, suggestions)
- Validates deterministic properties
- Checks reference integrity

---

## Files Changed

### New Files (9)

1. **Contract Schema**:
   - `control-center/src/lib/contracts/tuning-suggestions.ts`

2. **Database Migration**:
   - `database/migrations/046_tuning_suggestions.sql`

3. **Service Layer**:
   - `control-center/src/lib/tuning-suggestions-service.ts`

4. **API Routes**:
   - `control-center/app/api/tuning/route.ts`
   - `control-center/app/api/tuning/generate/route.ts`

5. **Tests**:
   - `control-center/__tests__/lib/tuning-suggestions.test.ts`

6. **Documentation**:
   - `docs/E78_3_EXAMPLE_SUGGESTION.json` (example suggestion)
   - `E78_3_IMPLEMENTATION_SUMMARY.md` (this file)
   - `E78_3_VERIFICATION_COMMANDS.md` (PowerShell commands)

### Modified Files (0)

No existing files modified - all changes are additive.

---

## Example Suggestion JSON

See `docs/E78_3_EXAMPLE_SUGGESTION.json` for a complete example of a generated suggestion.

**Summary**:
- Type: CLASSIFIER_RULE
- Title: "Add classifier rules for UNKNOWN incidents"
- Confidence: high
- Expected Impact: "Reduce UNKNOWN classifications by 30%"
- References: 3 incident IDs

---

## PowerShell Verification Commands

See `E78_3_VERIFICATION_COMMANDS.md` for detailed commands.

**Quick verification**:
```powershell
# Run database migration
bash scripts/db-migrate.sh

# Run tests
npm --prefix control-center test tuning-suggestions.test.ts

# Build control-center
npm --prefix control-center run build

# Verify repository
npm run repo:verify
```

---

## Acceptance Criteria

✅ **Suggestions can be generated and retrieved**
- POST `/api/tuning/generate` generates suggestions
- GET `/api/tuning` retrieves suggestions by window/date

✅ **Evidence-linked and deterministic**
- All suggestions reference supporting outcomeIds/incidentIds/kpiWindowRefs
- Same inputs → same suggestion_hash
- Suggestions sorted deterministically

✅ **Tests/build green**
- 8 comprehensive tests covering determinism, references, insufficient data
- No build errors
- No lint errors (via repo:verify)

✅ **No auto-apply**
- Suggestions have `status: PROPOSED`
- No automatic lawbook modification logic
- Conservative: returns empty when data insufficient

---

## Non-Negotiables Compliance

✅ **Deterministic**: Same inputs → same suggestion list (verified by tests)
✅ **Transparent**: Each suggestion references evidence (outcomeIds, incidentIds, KPIs)
✅ **No automatic lawbook edits**: Suggestions only, status: PROPOSED
✅ **Conservative**: Prefer "collect more evidence" (insufficient data → empty result)

---

## Security Summary

**No security vulnerabilities introduced**:
- Authentication required (x-afu9-sub header)
- Input validation via Zod schemas
- SQL injection prevented via parameterized queries
- No secrets in code
- References validated (prevent dangling IDs)

---

## Future Enhancements

1. **Status transitions**: Support `accepted`, `rejected`, `implemented` statuses
2. **Suggestion ranking**: Machine learning to prioritize high-impact suggestions
3. **A/B testing**: Track suggestion implementation outcomes
4. **Auto-approval**: Low-risk suggestions with high confidence could auto-apply (requires human-in-loop override)
5. **Feedback loop**: Track suggestion acceptance rate, adjust rule thresholds

---

## Summary

E78.3 (I783) successfully implements a **deterministic, evidence-based tuning suggestions generator**:

- ✅ 6 rule-based generators (conservative, transparent)
- ✅ Deterministic hashing and idempotent storage
- ✅ Evidence references (no dangling IDs)
- ✅ API routes for generation and retrieval
- ✅ Comprehensive tests (8 test cases)
- ✅ **Suggestions only** - no auto-apply

**Impact**: Enables data-driven lawbook improvements while maintaining human oversight and safety.
