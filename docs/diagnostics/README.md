# Diagnostics & Verification Tools

This directory contains diagnostic and verification tools for AFU-9 systems.

## Tools

### 1. Issue Run Slice Verification (I201.10)

**Script**: `verify_issue_run_slice.ps1`

**Purpose**: End-to-end deterministic verification of the I201.x issue run slice workflow. Prevents falling back into microdebug by providing clear PASS/FAIL results.

**Usage**:

```powershell
# Run on staging
.\docs\diagnostics\verify_issue_run_slice.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -Cookie "session=your-session-cookie"

# Run on local development
.\docs\diagnostics\verify_issue_run_slice.ps1 `
  -BaseUrl "http://localhost:3000" `
  -Cookie "session=your-session-cookie"
```

**Workflow Steps**:

1. **Ensure Draft** - Create draft/session (simplified: uses CREATED issue status)
2. **Create Issue** - POST `/api/issues`
3. **Read by canonicalId** - GET `/api/issues/:id` (assert count = 1)
4. **Start Run** - POST `/api/afu9/issues/:id/runs/start`
5. **Refresh/Link Evidence** - POST `/api/afu9/runs/:runId/evidence/refresh`
6. **Set Verdict** - POST `/api/afu9/issues/:id/verdict`
7. **Read Timeline** - GET `/api/afu9/timeline` (assert required events)

**Output**:

- PASS/FAIL for each step
- On FAIL: requestId, endpoint, status code, response snippet
- Clear summary at the end

**Exit Codes**:

- `0` - PASS (all steps succeeded)
- `1` - FAIL (one or more steps failed)

**Example Output**:

```
╔═══════════════════════════════════════════════════════════╗
║   I201.10 - Release Gate: End-to-End Verification        ║
╚═══════════════════════════════════════════════════════════╝
  Base URL: https://stage.afu-9.com

═══════════════════════════════════════════════════════════
[1] Create Issue
───────────────────────────────────────────────────────────
  Method:   POST
  Endpoint: /api/issues
  ✓ PASS
  RequestID: req_abc123

...

╔═══════════════════════════════════════════════════════════╗
║                    VERIFICATION PASSED                    ║
╚═══════════════════════════════════════════════════════════╝

  All steps completed successfully!
```

### 2. INTENT Incident Diagnostics

This diagnostic system provides a **deterministic, systemized pipeline** for debugging INTENT authoring incidents. It transforms symptoms (e.g., "Issue Draft stuck on NO DRAFT") into actionable diagnostics without ad-hoc probing.

### Pipeline Flow

```
Evidence Pack → Classifier → Proofs → Playbook → Verification
```

1. **Evidence Pack**: Versioned JSON schema capturing incident data
2. **Classifier**: Rules-based (deterministic) classification into 7 codes
3. **Proofs**: Deterministic proof checks based on evidence
4. **Playbook**: Mapped remediation plan with patch details and Copilot prompt
5. **Verification**: Automated checks to confirm fix

## Quick Start

### Run Diagnosis

```bash
# From repo root
cd /path/to/codefactory-control

# Run diagnosis on example incident
node scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json

# Or with ts-node
ts-node scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json
```

### Expected Output

```json
{
  "incidentId": "INC-2026-000001",
  "timestamp": "2026-01-18T17:30:00.000Z",
  "classification": {
    "code": "C1_MISSING_READ_PATH",
    "title": "Missing GET Endpoint for Issue Draft",
    "description": "POST/PUT operations succeed but GET endpoint returns 404...",
    "confidence": 0.95,
    "matchedRules": ["GET_404_POST_SUCCESS"],
    "requiredProofs": ["PROOF_GET_404", "PROOF_POST_SUCCESS"]
  },
  "confidence": 0.95,
  "proofs": {
    "proofs": [
      {
        "id": "PROOF_GET_404",
        "name": "GET request returns 404",
        "status": "PASS",
        "evidenceRefs": ["apiSnippets[/api/intent/sessions/sess_test_c1_001/issue-draft]"],
        "details": "Found 1 GET requests with 404 status"
      },
      ...
    ],
    "summary": {
      "total": 2,
      "passed": 2,
      "failed": 0,
      "insufficient": 0
    }
  },
  "nextAction": {
    "playbookId": "PB-C1-MISSING-READ-PATH",
    "type": "PATCH",
    "description": "High confidence diagnosis. Apply patch from playbook...",
    "copilotPrompt": "Implement the missing GET endpoint for INTENT issue drafts..."
  },
  "playbook": {
    "id": "PB-C1-MISSING-READ-PATH",
    "classificationCode": "C1_MISSING_READ_PATH",
    "title": "Add Missing GET Endpoint for Issue Draft",
    "patchPlan": [...],
    "verificationChecks": [...],
    "copilotPrompt": "..."
  }
}
```

## Classification Codes

The system implements **7 deterministic classification codes**:

### C1: Missing GET Endpoint (MISSING_READ_PATH)

**Symptom**: INTENT UI shows "NO DRAFT" even though POST/PUT succeed

**Root Cause**: GET endpoint returns 404

**Required Proofs**: PROOF_GET_404, PROOF_POST_SUCCESS

**Playbook**: Fully implemented with complete patch plan

### C2: Read Route Missing (READ_ROUTE_MISSING_404)

**Symptom**: GET endpoint not implemented

**Root Cause**: Route configuration missing

**Required Proofs**: PROOF_GET_404

### C3: Authentication Mismatch (AUTH_MISMATCH)

**Symptom**: 401/403 errors on API calls

**Root Cause**: Auth headers missing or invalid

**Required Proofs**: PROOF_AUTH_ERROR, PROOF_401_403

### C4: Agent Text-Only Response (AGENT_TEXT_ONLY)

**Symptom**: INTENT agent returns text without tool calls

**Root Cause**: Tool registration or prompting issue

**Required Proofs**: PROOF_TOOL_CALL_MISSING, PROOF_TEXT_RESPONSE

### C5: Tool Execution Failed (TOOL_EXEC_FAILED)

**Symptom**: INTENT tool errors in logs

**Root Cause**: Tool implementation bug or invalid input

**Required Proofs**: PROOF_TOOL_ERROR

### C6: Schema Validation Mismatch (SCHEMA_MISMATCH)

**Symptom**: 400 errors or validation failures

**Root Cause**: Request/response schema incompatibility

**Required Proofs**: PROOF_VALIDATION_ERROR

### C7: Refresh Wiring Missing (REFRESH_WIRING_MISSING)

**Symptom**: UI shows stale data

**Root Cause**: No polling/refresh mechanism

**Required Proofs**: PROOF_STALE_DATA, PROOF_NO_REFRESH

## Evidence Pack Schema

### Schema Location

- **Schema**: `docs/diagnostics/incident.schema.json`
- **Version**: 1.0.0
- **Format**: JSON Schema (Draft 07)

### Required Fields

```json
{
  "schemaVersion": "1.0.0",
  "incidentId": "INC-YYYY-NNNNNN",
  "createdAt": "ISO 8601 timestamp",
  "env": "development | staging | production",
  "sessionId": "INTENT session ID",
  "mode": "DRAFTING | DISCUSS"
}
```

### Optional Fields

- `deployedVersion`: Build SHA or version tag
- `requestIds[]`: Request IDs involved in incident
- `networkTraceSummary`: Endpoint patterns with status counts
- `apiSnippets[]`: Sanitized request/response snippets (max 10)
- `serverLogRefs[]`: Server log excerpts (sanitized)
- `notes`: Operator notes (max 1000 chars)

### Security

**Redaction**: All sensitive data is automatically stripped:
- Authorization headers
- Cookies
- Tokens
- API keys

### Example Evidence Pack

See: `docs/diagnostics/examples/incident_c1_missing_read_path.json`

## Generating Evidence Packs

### Manual Creation

1. Copy the example template
2. Fill in incident details
3. Add API snippets from network traces
4. Add relevant server logs (sanitized)
5. Validate against schema

### Future: Automated Collection

(Not in MVP scope - planned for future DCU)

```bash
# Planned future command
npm run intent:capture-incident --session-id <id> --output incident.json
```

## Validation

### Validate Evidence Pack

```bash
# Using ajv-cli (if available)
npx ajv validate \
  -s docs/diagnostics/incident.schema.json \
  -d docs/diagnostics/examples/incident_c1_missing_read_path.json
```

### Validate via Script

The diagnostic script validates automatically:

```bash
node scripts/diagnose-intent-incident.ts --file <path>
# Exits with code 1 if validation fails
```

## Playbook System

### Playbook Structure

Each classification maps to a playbook containing:

1. **Patch Plan**: Files to modify + intent for each
2. **Verification Checks**: API/UI/Log checks to confirm fix
3. **Copilot Prompt**: Pre-generated prompt for GitHub Copilot
4. **Estimated Effort**: Time estimate for remediation

### Fully Implemented Playbooks

- **C1_MISSING_READ_PATH**: Complete implementation with detailed patch plan

### Minimal Playbooks

- C2-C7: Basic structure (to be expanded in future DCUs)

## Testing

### Run Regression Tests

```bash
cd control-center
npm test -- diagnostics
```

### Test Coverage

- C1 classification with mocked evidence pack
- Proof runner output format
- Playbook mapping
- Redaction logic
- Schema validation

## Verification Commands

### PowerShell (Windows)

```powershell
# From repo root
cd C:\dev\codefactory\control-center

# Run diagnosis
node .\scripts\diagnose-intent-incident.ts --file .\docs\diagnostics\examples\incident_c1_missing_read_path.json

# Expected: Exit code 0, JSON output with classification.code = "C1_MISSING_READ_PATH"
```

### Bash (Linux/macOS)

```bash
# From repo root
cd /path/to/codefactory-control

# Run diagnosis
node scripts/diagnose-intent-incident.ts --file docs/diagnostics/examples/incident_c1_missing_read_path.json

# Check exit code
echo $?  # Should be 0
```

## Architecture

### Module Structure

```
control-center/src/lib/diagnostics/
├── incidentSchema.ts   # TypeScript types + Zod validation + redaction
├── classifier.ts       # Rules-based classifier (7 codes)
├── proofs.ts          # Proof runner (deterministic checks)
├── playbooks.ts       # Playbook registry
└── diagnose.ts        # Main orchestrator

scripts/
└── diagnose-intent-incident.ts  # CLI entrypoint

docs/diagnostics/
├── incident.schema.json         # JSON Schema
├── examples/
│   └── incident_c1_missing_read_path.json
└── README.md                    # This file
```

### Key Design Principles

1. **Determinism**: No LLM dependency, rules-based classification
2. **Security**: Automatic redaction of sensitive data
3. **Modularity**: Clean separation of concerns
4. **Testability**: Each module independently testable
5. **Stability**: Byte-stable output (stable sorting, no random timestamps in classification)

## Future Enhancements

(Out of MVP scope)

- **UI Integration**: INTENT Console diagnostic panel
- **Automated Remediation**: Apply patches automatically
- **Telemetry Integration**: Auto-collect evidence from logs
- **Expanded Playbooks**: Detailed playbooks for C2-C7
- **Live Checks**: Optional live API probes (best-effort)

## References

- **Canonical ID**: AFU9-I-OPS-DBG-001
- **Related Issues**: I902 (Draft Access Reliability)
- **Schema Version**: 1.0.0

## Support

For questions or issues with the diagnostic system:

1. Check this README
2. Review example evidence pack
3. Run with `--help` flag
4. Check classification code descriptions above
