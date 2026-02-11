# Clinical Intake Rules vs Checks Matrix

**Issue #10: Clinical Intake Synthesis (CRE-konform)**

This document maps validation rules to their automated checks, ensuring every rule has an enforcement mechanism.

## Matrix Structure

| Rule Code | Rule Description | Check Location | Check Type | Status |
|-----------|------------------|----------------|------------|--------|

## Schema Validation (R-001 to R-099)

| Rule Code | Rule Description | Check Location | Check Type | Status |
|-----------|------------------|----------------|------------|--------|
| R-001 | Schema validation failed | `validators/clinicalIntakeValidator.ts:validateClinicalIntakeWithRules()` | Zod schema validation | ✅ Implemented |
| R-002 | Required field is missing | `validators/clinicalIntakeValidator.ts:validateClinicalIntakeWithRules()` | Zod schema validation | ✅ Implemented |
| R-003 | Field has invalid type | `validators/clinicalIntakeValidator.ts:validateClinicalIntakeWithRules()` | Zod schema validation | ✅ Implemented |
| R-004 | Field exceeds maximum length | `validators/clinicalIntakeValidator.ts:validateClinicalIntakeWithRules()` | Zod schema validation | ✅ Implemented |
| R-005 | Invalid enum value | `validators/clinicalIntakeValidator.ts:validateClinicalIntakeWithRules()` | Zod schema validation | ✅ Implemented |

## Content Quality (R-100 to R-199)

| Rule Code | Rule Description | Check Location | Check Type | Status |
|-----------|------------------|----------------|------------|--------|
| R-100 | Clinical summary contains chat-like language | `validators/clinicalIntakeValidator.ts:validateClinicalSummaryQuality()` | Pattern matching (`CHAT_LANGUAGE_PATTERNS`) | ✅ Implemented |
| R-101 | Clinical summary is too short | `validators/clinicalIntakeValidator.ts:validateClinicalSummaryQuality()` | Length validation (min 50 chars) | ✅ Implemented |
| R-102 | Clinical summary missing key information | TBD | Semantic analysis (future) | ⏳ Deferred |
| R-103 | Clinical summary has colloquialisms | `validators/clinicalIntakeValidator.ts:validateClinicalSummaryQuality()` | Pattern matching (`COLLOQUIAL_PATTERNS`) | ✅ Implemented |
| R-104 | Clinical summary lacks medical terminology | TBD | Medical term analysis (future) | ⏳ Deferred |
| R-105 | Clinical summary replays conversation chronologically | `validators/clinicalIntakeValidator.ts:validateClinicalSummaryQuality()` | Pattern matching (`CHRONOLOGICAL_MARKERS`) | ✅ Implemented |
| R-106 | Clinical summary has incomplete sentences | `validators/clinicalIntakeValidator.ts:validateClinicalSummaryQuality()` | Sentence fragment detection | ✅ Implemented |

## Structural Integrity (R-200 to R-299)

| Rule Code | Rule Description | Check Location | Check Type | Status |
|-----------|------------------|----------------|------------|--------|
| R-200 | Draft intake missing chief complaint | `validators/clinicalIntakeValidator.ts:validateStructuralIntegrity()` | Field presence check | ✅ Implemented |
| R-201 | Intake status is inconsistent with data | `validators/clinicalIntakeValidator.ts:validateStructuralIntegrity()` | Cross-field validation | ✅ Implemented |
| R-202 | Invalid version chain | `validators/clinicalIntakeValidator.ts:validateStructuralIntegrity()` | Version reference check | ✅ Implemented |
| R-203 | Missing source message references | `validators/clinicalIntakeValidator.ts:validateStructuralIntegrity()` | Array length check | ✅ Implemented |

## Security/Safety (R-300 to R-399)

| Rule Code | Rule Description | Check Location | Check Type | Status |
|-----------|------------------|----------------|------------|--------|
| R-300 | Contains potentially identifiable information | `validators/clinicalIntakeValidator.ts:validateSecuritySafety()` | PII pattern matching | ✅ Implemented |
| R-301 | Contains unsafe content | TBD | Content safety filter (future) | ⏳ Deferred |
| R-302 | High-severity red flags not documented in summary | `validators/clinicalIntakeValidator.ts:validateSecuritySafety()` | Cross-reference check | ✅ Implemented |

---

## Check Execution Points

### API Layer
- **Location**: `app/api/clinical/intake/route.ts`, `app/api/clinical/intake/[id]/route.ts`
- **When**: Before creating/updating intake records
- **Rules Enforced**: All (R-001 to R-399)
- **Action**: Return 422 error if validation fails

### Database Layer
- **Location**: `database/migrations/092_clinical_intakes.sql`
- **When**: On INSERT/UPDATE
- **Rules Enforced**: R-004 (via CHECK constraints)
- **Action**: Reject transaction

### CI/CD Pipeline
- **Location**: `.github/workflows/clinical-intake-validation.yml` (to be created)
- **When**: On pull request, pre-commit
- **Rules Enforced**: All (R-001 to R-399)
- **Action**: Block merge if validation fails

### Manual Validation
- **Location**: `scripts/validate-clinical-intake.ts`
- **When**: Developer runs validation script
- **Rules Enforced**: All (R-001 to R-399)
- **Action**: Exit code 1 if validation fails

---

## Coverage Report

### Implemented Rules
- **Schema Validation**: 5/5 (100%)
- **Content Quality**: 4/7 (57%) - 3 deferred to future iterations
- **Structural Integrity**: 4/4 (100%)
- **Security/Safety**: 2/3 (67%) - 1 deferred to future iteration

**Total Coverage**: 15/19 (79%)

### Missing Checks (To Be Implemented)
1. **R-102**: Semantic analysis for missing key information (requires medical knowledge base)
2. **R-104**: Medical terminology detection (requires medical dictionary)
3. **R-301**: Content safety filter (requires moderation API)

---

## Rule Code Format

All rule codes follow the format `R-XXX` where:
- `R-` prefix identifies this as a clinical intake rule
- `XXX` is a 3-digit number indicating the category:
  - `001-099`: Schema validation
  - `100-199`: Content quality
  - `200-299`: Structural integrity
  - `300-399`: Security/safety

---

## Validation Output Format

All validation errors must include:
```json
{
  "code": "R-XXX",
  "message": "Human-readable error message",
  "path": "/field/path",
  "severity": "error" | "warning",
  "details": { /* optional */ }
}
```

Example output:
```
❌ ERRORS (2):
  ✗ violates R-100
    Clinical summary contains chat-like language. Use medical terminology instead.
    Path: /clinical_summary
    
  ✗ violates R-300
    Clinical summary may contain identifiable information.
    Path: /clinical_summary
```

---

## Maintenance

**Last Updated**: 2025-02-11  
**Next Review**: When adding new rules or checks  
**Owner**: AFU-9 Team

### Change Log
- 2025-02-11: Initial matrix created for Issue #10
- Future: Add semantic and medical terminology checks

---

## References

- **Validator Implementation**: `control-center/src/lib/validators/clinicalIntakeValidator.ts`
- **Schema Definition**: `control-center/src/lib/schemas/clinicalIntake.ts`
- **Validation Script**: `scripts/validate-clinical-intake.ts`
- **Issue**: #10 - Clinical Intake Synthesis (CRE-konform)
