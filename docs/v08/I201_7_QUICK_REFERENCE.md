# I201.7 Quick Reference

## Verdict Endpoint

**Endpoint**: `POST /api/afu9/issues/:issueId/verdict`

**Purpose**: Apply a verdict (GREEN, RED, HOLD) to drive the self-propelling state machine.

## Request Format

```json
POST /api/afu9/issues/{issueId}/verdict
Content-Type: application/json

{
  "verdict": "GREEN" | "RED" | "HOLD"
}
```

## Response Format

```json
{
  "issueId": "uuid",
  "verdict": "GREEN",
  "oldStatus": "IMPLEMENTING",
  "newStatus": "VERIFIED",
  "stateChanged": true
}
```

## State Mapping Rules

| Verdict | Current State | New State |
|---------|---------------|-----------|
| GREEN   | IMPLEMENTING  | VERIFIED  |
| GREEN   | VERIFIED      | DONE      |
| GREEN   | Other         | (no change) |
| RED     | Any           | HOLD      |
| HOLD    | Any           | HOLD      |

## Timeline Events

Every verdict call logs **VERDICT_SET** event with:
- `verdict`: The verdict applied
- `oldStatus`: State before verdict
- `newStatus`: State after verdict
- `stateChanged`: Whether state changed

If state changes, also logs **STATE_CHANGED** event with:
- `oldStatus`: Previous state
- `newStatus`: New state
- `reason`: `"verdict:{GREEN|RED|HOLD}"`

## Idempotency

Applying the same verdict multiple times:
- **VERDICT_SET** event is logged each time (auditable)
- **STATE_CHANGED** event is only logged when state actually changes
- No duplicate state transitions

Example: Applying HOLD to an already-HOLD issue
- ✓ VERDICT_SET logged
- ✗ STATE_CHANGED not logged
- ✗ Database not updated

## Usage Examples

### 1. Mark implementation complete (GREEN)

```bash
curl -X POST http://localhost:3000/api/afu9/issues/{issueId}/verdict \
  -H "Content-Type: application/json" \
  -d '{"verdict": "GREEN"}'
```

**Effect**: IMPLEMENTING → VERIFIED

### 2. Mark verification complete (GREEN)

```bash
curl -X POST http://localhost:3000/api/afu9/issues/{issueId}/verdict \
  -H "Content-Type: application/json" \
  -d '{"verdict": "GREEN"}'
```

**Effect**: VERIFIED → DONE

### 3. Block an issue (RED)

```bash
curl -X POST http://localhost:3000/api/afu9/issues/{issueId}/verdict \
  -H "Content-Type: application/json" \
  -d '{"verdict": "RED"}'
```

**Effect**: Any state → HOLD

### 4. Explicitly hold an issue (HOLD)

```bash
curl -X POST http://localhost:3000/api/afu9/issues/{issueId}/verdict \
  -H "Content-Type: application/json" \
  -d '{"verdict": "HOLD"}'
```

**Effect**: Any state → HOLD

## Error Codes

| Code | Condition | Example |
|------|-----------|---------|
| 200  | Success   | Verdict applied |
| 400  | Invalid verdict | `{"verdict": "INVALID"}` |
| 400  | Missing verdict | `{}` |
| 400  | Invalid JSON | Malformed body |
| 404  | Issue not found | Non-existent issueId |
| 500  | Server error | Database failure |

## Testing

Run automated verification:

```powershell
.\I201_7_VERIFICATION.ps1 -BaseUrl http://localhost:3000
```

## Integration with AFU-9 Factory

The verdict endpoint enables the self-propelling state machine:

1. **Run starts** → Issue transitions to IMPLEMENTING
2. **Run completes** → Automated verdict (GREEN or RED)
3. **GREEN verdict** → Issue advances (IMPLEMENTING → VERIFIED)
4. **Verification run** → Another GREEN verdict
5. **Final GREEN** → Issue completes (VERIFIED → DONE)

If any step fails:
- **RED verdict** → Issue goes to HOLD
- Manual intervention required
- Resume with another run + GREEN verdict

## Files

- **Contract**: `control-center/src/lib/contracts/verdict.ts`
- **Service**: `control-center/src/lib/services/verdictService.ts`
- **Endpoint**: `control-center/app/api/afu9/issues/[id]/verdict/route.ts`
- **Tests**: `control-center/__tests__/api/afu9-verdict.test.ts`
- **Verification**: `I201_7_VERIFICATION.ps1`
