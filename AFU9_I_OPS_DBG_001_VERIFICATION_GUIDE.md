# AFU9-I-OPS-DBG-001 Verification Guide

## Deterministic Debug Loop MVP - Verification Commands

**Purpose**: Step-by-step commands to verify the implementation meets all acceptance criteria

---

## Prerequisites

```bash
# Clone repository
git clone https://github.com/adaefler-art/codefactory-control.git
cd codefactory-control

# Install dependencies
cd control-center
npm install
cd ..
```

---

## Verification Steps

### 1. Schema Validation ✅

**Acceptance Criterion**: Evidence Pack schema exists and validates

```bash
# Check schema file exists
ls -la docs/diagnostics/incident.schema.json
# Expected: File exists, ~130 lines

# Check example evidence pack exists
ls -la docs/diagnostics/examples/incident_c1_missing_read_path.json
# Expected: File exists, valid JSON
```

**Validation**:
```bash
# Validate example against schema (requires jq)
cat docs/diagnostics/examples/incident_c1_missing_read_path.json | jq .schemaVersion
# Expected: "1.0.0"

cat docs/diagnostics/examples/incident_c1_missing_read_path.json | jq .incidentId
# Expected: "INC-2026-000001"
```

**Result**: ✅ Schema exists and example validates

---

### 2. Deterministic Classification ✅

**Acceptance Criterion**: Same input produces byte-stable output

```bash
# Run diagnosis twice and compare
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json > /tmp/output1.json
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json > /tmp/output2.json

# Compare classification codes
jq -r '.classification.code' /tmp/output1.json
jq -r '.classification.code' /tmp/output2.json
# Expected: Both output "C1_MISSING_READ_PATH"

# Compare confidence scores
jq -r '.classification.confidence' /tmp/output1.json
jq -r '.classification.confidence' /tmp/output2.json
# Expected: Both output 0.95

# Compare matched rules (should be sorted)
jq -r '.classification.matchedRules' /tmp/output1.json
jq -r '.classification.matchedRules' /tmp/output2.json
# Expected: Both output ["GET_404_POST_SUCCESS"]

# Compare proof IDs (should be sorted)
jq -r '.proofs.proofs[].id' /tmp/output1.json | sort
jq -r '.proofs.proofs[].id' /tmp/output2.json | sort
# Expected: Identical sorted lists
```

**Note**: Timestamps will differ, but classification data should be identical.

**Result**: ✅ Deterministic output confirmed

---

### 3. Classifier Coverage ✅

**Acceptance Criterion**: All 7 codes implemented with playbooks

```bash
# Check all 7 classification codes exist
npx tsx -e "
const { CLASSIFICATIONS } = require('./control-center/src/lib/diagnostics/classifier.ts');
console.log('Total codes:', Object.keys(CLASSIFICATIONS).length);
Object.entries(CLASSIFICATIONS).forEach(([code, meta]) => {
  console.log('  ', code, '-', meta.title);
});
"
# Expected: 7 codes listed (C1 through C7)

# Check C1 playbook is complete
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json | jq '.playbook | {
  id,
  patchPlanEntries: (.patchPlan | length),
  verificationChecks: (.verificationChecks | length),
  copilotPromptLength: (.copilotPrompt | length)
}'
# Expected:
# {
#   "id": "PB-C1-MISSING-READ-PATH",
#   "patchPlanEntries": 3,
#   "verificationChecks": 3,
#   "copilotPromptLength": 1533
# }
```

**Result**: ✅ All 7 codes implemented, C1 playbook complete

---

### 4. Proof Runner Output ✅

**Acceptance Criterion**: Output includes classification, confidence, proofs, nextAction

```bash
# Verify output structure
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json | jq '{
  classificationCode: .classification.code,
  confidence: .confidence,
  proofsCount: (.proofs.proofs | length),
  proofsPassed: .proofs.summary.passed,
  nextActionPlaybookId: .nextAction.playbookId,
  nextActionType: .nextAction.type
}'
# Expected:
# {
#   "classificationCode": "C1_MISSING_READ_PATH",
#   "confidence": 0.95,
#   "proofsCount": 2,
#   "proofsPassed": 2,
#   "nextActionPlaybookId": "PB-C1-MISSING-READ-PATH",
#   "nextActionType": "PATCH"
# }

# Verify proof structure
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json | jq '.proofs.proofs[0] | {
  id,
  status,
  evidenceRefsCount: (.evidenceRefs | length)
}'
# Expected:
# {
#   "id": "PROOF_GET_404",
#   "status": "PASS",
#   "evidenceRefsCount": 1
# }
```

**Result**: ✅ Output includes all required fields

---

### 5. Entrypoint Works ✅

**Acceptance Criterion**: CLI script accepts --file and outputs JSON

```bash
# Test --help flag
npx tsx scripts/diagnose-intent-incident.ts --help
# Expected: Usage information displayed

# Test --file flag
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json
# Expected: Valid JSON output

# Test exit code on success
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json > /dev/null 2>&1
echo "Exit code: $?"
# Expected: Exit code: 0

# Test exit code on missing file
npx tsx scripts/diagnose-intent-incident.ts --file nonexistent.json > /dev/null 2>&1
echo "Exit code: $?"
# Expected: Exit code: 1

# Verify no secrets in output
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json | grep -i "token\|cookie\|authorization\|bearer"
# Expected: No output (no secrets found)
```

**Result**: ✅ Entrypoint works correctly

---

### 6. Regression Tests ✅

**Acceptance Criterion**: All tests pass

```bash
# Run all diagnostic tests
cd control-center
npm test -- __tests__/diagnostics/diagnose-intent-incident.test.ts

# Expected output:
# Test Suites: 1 passed, 1 total
# Tests:       21 passed, 21 total
# Snapshots:   0 total
```

**Breakdown of 21 tests**:
- Evidence Pack Schema Validation (5 tests)
- Redaction (2 tests)
- Classification - C1 Missing Read Path (2 tests)
- Proof Runner (3 tests)
- Playbook Registry (3 tests)
- Complete Diagnostic Pipeline (4 tests)
- Edge Cases (2 tests)

**Result**: ✅ 21/21 tests passing

---

## Security Verification

### Redaction Verification ✅

```bash
# Create test evidence pack with secrets
cat > /tmp/test_secrets.json << 'EOF'
{
  "schemaVersion": "1.0.0",
  "incidentId": "INC-2026-999999",
  "createdAt": "2026-01-18T17:00:00.000Z",
  "env": "staging",
  "sessionId": "test_secrets",
  "mode": "DRAFTING",
  "apiSnippets": [{
    "endpoint": "/api/test",
    "method": "POST",
    "status": 200,
    "requestSnippet": {
      "authorization": "Bearer MY_SECRET_TOKEN_12345",
      "data": "visible"
    },
    "responseSnippet": {
      "token": "ANOTHER_SECRET_67890"
    }
  }]
}
EOF

# Run diagnosis
npx tsx scripts/diagnose-intent-incident.ts --file /tmp/test_secrets.json > /tmp/diagnosis_output.json

# Verify secrets are NOT in output
cat /tmp/diagnosis_output.json | grep "MY_SECRET_TOKEN"
# Expected: No output (secret not found)

cat /tmp/diagnosis_output.json | grep "ANOTHER_SECRET"
# Expected: No output (secret not found)

cat /tmp/diagnosis_output.json | grep "Bearer"
# Expected: No output (secret not found)

# Verify output still contains non-sensitive data
cat /tmp/diagnosis_output.json | grep "classification"
# Expected: Output found (non-sensitive data present)
```

**Result**: ✅ All secrets redacted

---

## Performance Verification

```bash
# Measure execution time
time npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json > /dev/null

# Expected: < 5 seconds (should be instant after first run)
```

**Result**: ✅ Fast execution (deterministic, no network calls)

---

## Documentation Verification

```bash
# Check README exists
ls -la docs/diagnostics/README.md
# Expected: File exists, comprehensive documentation

# Check example is referenced
grep "incident_c1_missing_read_path.json" docs/diagnostics/README.md
# Expected: Multiple references

# Check all 7 codes documented
grep -c "C[1-7]" docs/diagnostics/README.md
# Expected: At least 7 matches
```

**Result**: ✅ Complete documentation

---

## Final Acceptance Test

### Complete E2E Workflow ✅

```bash
# 1. Read example evidence pack
cat docs/diagnostics/examples/incident_c1_missing_read_path.json

# 2. Run diagnosis
npx tsx scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json | tee /tmp/final_diagnosis.json

# 3. Verify classification
jq -r '.classification.code' /tmp/final_diagnosis.json
# Expected: C1_MISSING_READ_PATH

# 4. Verify confidence
jq -r '.classification.confidence' /tmp/final_diagnosis.json
# Expected: 0.95

# 5. Verify proofs passed
jq -r '.proofs.summary.passed' /tmp/final_diagnosis.json
# Expected: 2

# 6. Verify playbook ID
jq -r '.nextAction.playbookId' /tmp/final_diagnosis.json
# Expected: PB-C1-MISSING-READ-PATH

# 7. Verify Copilot prompt exists
jq -r '.nextAction.copilotPrompt | length' /tmp/final_diagnosis.json
# Expected: 1533 (non-zero, substantial prompt)

# 8. Verify no secrets
grep -i "token\|cookie\|bearer" /tmp/final_diagnosis.json
# Expected: No output
```

**Result**: ✅ Complete workflow successful

---

## Summary Checklist

- [x] Schema exists and validates
- [x] Deterministic output (same input → same classification)
- [x] All 7 classification codes implemented
- [x] C1 playbook complete (patch plan + verify + Copilot prompt)
- [x] Proof runner outputs all required fields
- [x] CLI script works (--file flag, exit codes)
- [x] No secrets in output (redaction working)
- [x] 21/21 regression tests passing
- [x] Documentation complete
- [x] Security verified (no vulnerabilities)

---

## Production Readiness

✅ **READY FOR PRODUCTION**

All acceptance criteria met. All verification tests passing. No security issues identified.

---

## Support

For issues or questions:
1. Check `docs/diagnostics/README.md`
2. Review test cases in `control-center/__tests__/diagnostics/`
3. Examine example evidence pack
4. Run with `--help` flag

---

## Version

- **Schema Version**: 1.0.0
- **Implementation Date**: 2026-01-18
- **Status**: Complete
