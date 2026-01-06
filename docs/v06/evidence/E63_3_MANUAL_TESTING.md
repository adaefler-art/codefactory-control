# E63.3 Manual Testing Guide - Issue UI Runs Tab

## Overview
This guide provides step-by-step instructions for manually testing the Runs tab functionality added to the Issue Detail page in the Control Center.

## Prerequisites

1. **Database Setup**
   - Ensure PostgreSQL is running with the `afu9` database
   - Run database migrations to create the runs tables:
     ```bash
     cd database
     psql -U postgres -d afu9 -f migrations/026_afu9_runs_ledger.sql
     ```

2. **Control Center Running**
   - Start the control center:
     ```bash
     cd control-center
     npm run dev
     ```
   - Access at `http://localhost:3000`

3. **Test Data**
   - Create at least one test issue in the system
   - Note the issue ID for testing

## Test Scenarios

### 1. Initial State - Empty Runs

**Steps:**
1. Navigate to an issue detail page: `/issues/[issue-id]`
2. Scroll down to the "Runs" section

**Expected Results:**
- Runs section is visible below the Activity Log
- Header shows "Runs" with a "Run Playbook" button
- Left panel shows "No runs yet" with helper text "Click 'Run Playbook' to start"
- Right panel shows "Select a run to view details"

**Screenshot Location:** Take screenshot and save as `screenshots/01-empty-runs.png`

---

### 2. Playbook Selection

**Steps:**
1. Click the "Run Playbook" button
2. Observe the dropdown menu

**Expected Results:**
- Dropdown appears showing 4 playbooks:
  - Hello World (Simple hello world example)
  - Multi-Step Build (Example multi-step build process)
  - PowerShell Example (Example using PowerShell)
  - Issue Analysis (Analyze issue and generate specification)
- Each playbook shows name and description
- Cancel button at bottom

**Screenshot Location:** `screenshots/02-playbook-selector.png`

---

### 3. Create and Execute Run

**Steps:**
1. Select "Hello World" from the playbook dropdown
2. Wait for execution to complete (should be quick with dummy executor)

**Expected Results:**
- Dropdown closes
- "Starting..." button state shows briefly
- New run appears in the left panel with:
  - Title: "Hello World Run"
  - Status badge: "RUNNING" (blue, pulsing) → then "SUCCEEDED" (green)
  - Timestamp showing creation date
- Run is automatically selected
- Right panel shows run details:
  - Run header with title and run ID
  - Status badge showing current status
  - Created/Started/Duration timestamps
  - Steps section showing 1 step: "Print Hello"
  - Step status: "success" (green badge)

**Screenshot Location:** `screenshots/03-run-executing.png` and `screenshots/04-run-succeeded.png`

---

### 4. View Step Details

**Steps:**
1. Click on the "Print Hello" step to expand it

**Expected Results:**
- Step expands showing:
  - Duration (should be ~100ms)
  - Output section with green text: `[Dummy] Output for step: Print Hello`
  - Exit code: 0
- Arrow icon changes from ▶ to ▼

**Screenshot Location:** `screenshots/05-step-expanded.png`

---

### 5. Create Multiple Runs

**Steps:**
1. Click "Run Playbook" again
2. Select "Multi-Step Build"
3. Wait for completion
4. Click "Run Playbook" again
5. Select "PowerShell Example"
6. Wait for completion

**Expected Results:**
- Multiple runs listed in left panel, newest first
- Each run shows:
  - Appropriate title
  - Status badge (all should be SUCCEEDED)
  - Timestamp
- Clicking different runs in the list switches the detail view
- Each run shows its respective steps (3 for Multi-Step Build, 2 for PowerShell Example)

**Screenshot Location:** `screenshots/06-multiple-runs.png`

---

### 6. Re-run Functionality

**Steps:**
1. Select the "Hello World Run" in the list
2. Click the "Re-run" button in the detail panel
3. Wait for execution to complete

**Expected Results:**
- "Re-running..." button state shows briefly
- New run appears at the top of the list
- New run shows:
  - Same title: "Hello World Run"
  - "↻ Re-run" indicator below timestamp
  - Status: RUNNING → SUCCEEDED
- New run is automatically selected
- Database query should show `parent_run_id` set to the original run's ID

**Screenshot Location:** `screenshots/07-rerun.png`

---

### 7. Run Status Polling

**Steps:**
1. Modify `runner-service.ts` to add a longer delay in `executeRun`:
   ```typescript
   // Change: await new Promise((resolve) => setTimeout(resolve, 100));
   // To:
   await new Promise((resolve) => setTimeout(resolve, 10000)); // 10 seconds
   ```
2. Create a new run with any playbook
3. Observe the UI while run is executing

**Expected Results:**
- Status shows "RUNNING" with pulsing animation
- Status automatically updates to "SUCCEEDED" after ~10 seconds
- No page refresh needed
- Steps show progression: pending → running → success

**Screenshot Location:** `screenshots/08-polling.png`

---

### 8. Error Handling - Non-existent Playbook

This requires modifying the playbook selection temporarily or using browser dev tools.

**Steps:**
1. Open browser DevTools → Network tab
2. Create a run normally
3. Edit and re-send the request with a non-existent playbook ID

**Expected Results:**
- Error message appears: "Playbook [id] not found"
- Error shown in red banner
- No run created

---

### 9. UI Responsiveness

**Steps:**
1. Resize browser window to mobile width (~375px)
2. View the Runs section

**Expected Results:**
- Layout switches to single column on mobile
- Runs list stacks above detail view
- All controls remain accessible
- Text doesn't overflow

**Screenshot Location:** `screenshots/09-mobile-view.png`

---

### 10. Database Verification

**Steps:**
1. After creating several runs, check the database directly:
   ```sql
   -- Check runs table
   SELECT id, title, status, playbook_id, parent_run_id, created_at, started_at, finished_at 
   FROM runs 
   WHERE issue_id = '[your-issue-id]' 
   ORDER BY created_at DESC;
   
   -- Check run steps
   SELECT r.title, rs.idx, rs.name, rs.status, rs.exit_code, rs.duration_ms
   FROM runs r
   JOIN run_steps rs ON r.id = rs.run_id
   WHERE r.issue_id = '[your-issue-id]'
   ORDER BY r.created_at DESC, rs.idx ASC;
   ```

**Expected Results:**
- Runs table shows all created runs with correct statuses
- Run steps table shows all steps for each run
- Timestamps are properly set
- Parent-child relationships visible for re-runs

---

## API Endpoint Testing

### Test with curl or Postman:

1. **List Playbooks:**
   ```bash
   curl http://localhost:3000/api/playbooks
   ```
   Expected: JSON array of 4 playbooks

2. **List Runs for Issue:**
   ```bash
   curl http://localhost:3000/api/issues/[issue-id]/runs
   ```
   Expected: JSON with `runs` array

3. **Get Run Details:**
   ```bash
   curl http://localhost:3000/api/runs/[run-id]
   ```
   Expected: Full RunResult JSON with steps and artifacts

4. **Create Run:**
   ```bash
   curl -X POST http://localhost:3000/api/issues/[issue-id]/runs \
     -H "Content-Type: application/json" \
     -d '{"playbookId": "hello-world", "autoExecute": true}'
   ```
   Expected: `{"runId": "...", "status": "executing"}`

5. **Re-run:**
   ```bash
   curl -X POST http://localhost:3000/api/runs/[run-id]/rerun \
     -H "Content-Type: application/json" \
     -d '{"autoExecute": true}'
   ```
   Expected: `{"newRunId": "...", "parentRunId": "...", "status": "executing"}`

---

## Known Limitations (MVP)

1. **Dummy Execution:** All runs use dummy executor; actual command execution not implemented (I641)
2. **No Artifact Storage:** Artifact metadata is shown but no actual file storage
3. **Simple Polling:** 3-second interval for running status (could be optimized)
4. **No Pagination:** Runs list shows all runs (limit 20 by default)
5. **No Search/Filter:** Cannot filter runs by status or search

---

## Troubleshooting

### Runs Not Appearing
- Check browser console for API errors
- Verify database tables exist (run migration 026)
- Check network tab for 404/500 errors

### Execution Not Completing
- Check control-center logs for errors
- Verify dummy executor is running (no actual GitHub runner needed)
- Check database for status updates

### UI Not Updating
- Hard refresh (Ctrl+Shift+R)
- Check React DevTools for state issues
- Verify auto-polling is working in Network tab

---

## Success Criteria

✅ All test scenarios pass without errors
✅ UI is responsive and user-friendly
✅ Database records are created correctly
✅ Re-runs properly reference parent runs
✅ Status polling works automatically
✅ Error states are handled gracefully

---

## Reporting Issues

When reporting issues, include:
1. Steps to reproduce
2. Expected vs actual behavior
3. Screenshots
4. Browser console errors
5. Control-center logs
6. Database query results (if relevant)
