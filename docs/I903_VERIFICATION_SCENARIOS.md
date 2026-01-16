# I903: Manual Verification Scenarios

## Overview
This document outlines manual verification scenarios for the three-stage steering modes (DISCUSS/DRAFTING/ACT).

## Prerequisites
- INTENT Console accessible at `/intent`
- AFU9_INTENT_ENABLED=true
- Database migration 077 applied
- User authenticated

## Scenario 1: Free Planning in DISCUSS Mode

**Setup:**
1. Create a new INTENT session
2. Verify mode indicator shows "DISCUSS" (green)

**Test Steps:**
1. Enter message: "Wir wollen eine neue Feature für automatische Code-Reviews. Welche Optionen haben wir?"
2. Observe agent response

**Expected Behavior:**
- Agent responds with planning/brainstorming suggestions
- NO draft creation attempted
- NO schema validation enforced
- Agent discusses options, alternatives, considerations
- Mode remains DISCUSS

**Pass Criteria:**
- Response is conversational and exploratory
- No "you must provide X/Y/Z" messages
- No draft created in Issue Draft panel

---

## Scenario 2: Transition from DISCUSS → DRAFTING → ACT

**Setup:**
1. Continue from Scenario 1 or create new session in DISCUSS mode

**Test Steps:**
1. Click mode button to switch to DRAFTING (blue)
2. Enter: "Erstelle einen Draft für das Code-Review Feature"
3. Observe response and Issue Draft panel
4. Click mode button to switch to ACT (purple)
5. Enter: "/commit"

**Expected Behavior:**
- **DRAFTING mode:**
  - Agent creates draft with incomplete/placeholder fields
  - Draft is visible in Issue Draft panel
  - Schema guidance provided but not strictly enforced
  - prodBlocked=true allowed
  
- **ACT mode:**
  - Agent validates draft against schema
  - If missing required fields: ONE clarification request
  - After clarification (or using defaults): draft saved
  - Commit creates version

**Pass Criteria:**
- Mode transitions work correctly
- UI shows correct color for each mode (green/blue/purple)
- Draft creation behavior matches mode expectations
- Activity log shows mode transition events

---

## Scenario 3: Explicit Commands Override Mode

**Setup:**
1. Create new session (defaults to DISCUSS)
2. Verify mode is DISCUSS

**Test Steps:**
1. Enter: "/draft Implementiere OAuth2 Login"
2. Observe response

**Expected Behavior:**
- Even in DISCUSS mode, explicit `/draft` command triggers draft creation
- Agent recognizes USER_EXPLICIT trigger type
- Tool gating allows draft-mutating operation
- Draft appears in Issue Draft panel

**Pass Criteria:**
- Draft created despite being in DISCUSS mode
- No error about mode restrictions
- Activity log shows USER_EXPLICIT trigger

---

## Scenario 4: Missing Fields Handling in ACT Mode

**Setup:**
1. Create new session in ACT mode
2. Have no existing draft

**Test Steps:**
1. Enter: "Create issue for database migration feature"
2. Note any clarification requests
3. Provide minimal answers or skip
4. Observe final draft

**Expected Behavior:**
- Agent asks for missing required fields (MAX 1 round)
- After 1 round, agent uses sensible defaults for still-missing fields
- NO endless loop of clarification requests
- Draft is created with prodBlocked=true

**Pass Criteria:**
- At most 1 clarification request
- Draft created even if user doesn't provide all fields
- No loop/hang
- Activity log shows act_started, act_succeeded events

---

## Scenario 5: Audit Trail Verification

**Setup:**
1. Complete Scenario 2 (mode transitions)

**Test Steps:**
1. Query tool_execution_audit table for the session
2. Verify mode transition events logged

**Expected SQL:**
```sql
SELECT 
  tool_name, 
  trigger_type, 
  conversation_mode, 
  success, 
  executed_at
FROM tool_execution_audit
WHERE session_id = '<session_id>'
ORDER BY executed_at DESC;
```

**Expected Results:**
- `mode_transition:DRAFTING_to_ACT` with UI_ACTION trigger
- `mode_transition:DISCUSS_to_DRAFTING` with UI_ACTION trigger
- All transitions show success=true

**Pass Criteria:**
- All mode transitions are audited
- Timestamps are correct
- trigger_type is UI_ACTION for manual transitions
- conversation_mode reflects the NEW mode after transition

---

## Scenario 6: Backward Compatibility (FREE → DISCUSS)

**Setup:**
1. Manually insert session with conversation_mode='FREE' (if migration didn't run)
   OR
2. Test with old API client sending mode='FREE'

**Test Steps:**
1. GET /api/intent/sessions/{id}/mode
2. PUT /api/intent/sessions/{id}/mode with { mode: 'FREE' }

**Expected Behavior:**
- GET returns mode='FREE' if DB has FREE
- PUT with FREE is accepted (backward compat)
- Application layer normalizes FREE → DISCUSS
- Agent treats as DISCUSS mode

**Pass Criteria:**
- No errors when using FREE
- Agent behavior matches DISCUSS mode
- Migration eventually converts FREE → DISCUSS

---

## Verification Commands

### Check Current Mode
```bash
curl -H "x-afu9-sub: test-user" \
  http://localhost:3000/api/intent/sessions/{session_id}/mode
```

### Update Mode
```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "x-afu9-sub: test-user" \
  -d '{"mode": "ACT"}' \
  http://localhost:3000/api/intent/sessions/{session_id}/mode
```

### Check Audit Trail
```sql
SELECT * FROM tool_execution_audit 
WHERE session_id = '<session_id>' 
ORDER BY executed_at DESC;
```

---

## Success Criteria Summary

- [ ] DISCUSS mode allows free planning without draft pressure
- [ ] DRAFTING mode creates drafts with schema guidance
- [ ] ACT mode enforces validation with max 1 clarification round
- [ ] Mode transitions are audited in tool_execution_audit
- [ ] Explicit commands work in any mode
- [ ] UI correctly shows mode indicator colors
- [ ] No endless clarification loops
- [ ] Backward compatibility with FREE mode maintained
