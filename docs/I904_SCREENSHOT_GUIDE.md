# I904 UI Screenshot Guide

## Purpose
This guide helps you capture UI screenshots for the Activity Log feature documentation.

## Prerequisites
- Control-center running locally or on staging
- Admin user credentials or smoke key
- Browser dev tools (F12)

## Screenshots to Capture

### 1. Main Activity Log Page (Empty State)
**URL:** `/admin/activity`  
**Scenario:** No events in database  
**What to show:**
- Empty state message: "No events found. Try adjusting your filters."
- All filter controls visible
- Clean header and layout

**File name:** `i904_ui_empty_state.png`

---

### 2. Activity Log with Events (Default View)
**URL:** `/admin/activity`  
**Scenario:** Default view with 50 events  
**What to show:**
- Event list table with multiple rows
- All columns: Timestamp, Type, Actor, Summary, Correlation ID, Actions
- Pagination controls at bottom
- "Showing X to Y of Z" counter
- Filter section above (collapsed or minimal)

**File name:** `i904_ui_events_list.png`

---

### 3. Active Filters with Filter Chips
**URL:** `/admin/activity?sessionId=abc&issueId=123`  
**Scenario:** Multiple filters active  
**What to show:**
- Filter chips displayed: "Session: abc", "Issue: #123"
- Individual × buttons on chips
- "Clear All Filters" button
- Filtered event results

**File name:** `i904_ui_active_filters.png`

---

### 4. Filter Controls Expanded
**URL:** `/admin/activity`  
**Scenario:** All filter fields visible  
**What to show:**
- Session ID input field
- Issue Number input field
- Event Type dropdown (expanded showing options)
- Start Date and End Date inputs
- Clear All Filters button

**File name:** `i904_ui_filter_controls.png`

---

### 5. Event Detail Drawer (Open)
**URL:** `/admin/activity`  
**Scenario:** Clicked "Details" on an event  
**What to show:**
- Slide-in drawer from right side
- Event details displayed:
  - ID (UUID)
  - Timestamp (formatted)
  - Type badge
  - Actor
  - Correlation ID (full)
  - Session ID
  - Canonical ID
  - GitHub Issue Number
  - Subject type and identifier
  - Summary
  - Links section (if present)
  - Additional Details (JSON formatted)
- Close button (×) in top-right

**File name:** `i904_ui_detail_drawer.png`

---

### 6. Pagination Controls
**URL:** `/admin/activity?limit=10`  
**Scenario:** Small page size to show pagination  
**What to show:**
- "Showing X to Y of Z" text
- Previous button (disabled on page 1)
- Next button (enabled if more pages)
- After clicking Next: cursor changed, new events loaded

**File name:** `i904_ui_pagination.png`

---

### 7. Event Type Dropdown Options
**URL:** `/admin/activity`  
**Scenario:** Event Type dropdown clicked  
**What to show:**
- Dropdown menu expanded
- All 14+ event types visible:
  - Approval Submitted
  - Approval Approved
  - Approval Denied
  - Policy Allowed
  - Policy Denied
  - PR Opened
  - PR Merged
  - PR Closed
  - Checks Rerun
  - Workflow Dispatched
  - Issue Published
  - Issue Updated
  - Deploy Executed
  - Rollback Executed

**File name:** `i904_ui_event_types.png`

---

### 8. Date Range Filter Applied
**URL:** `/admin/activity?startDate=2025-12-01&endDate=2025-12-31`  
**Scenario:** Date range filter active  
**What to show:**
- Start Date and End Date fields filled
- Filter chip showing date range
- Events filtered to date range
- Event timestamps within range

**File name:** `i904_ui_date_filter.png`

---

### 9. Mobile/Responsive View
**URL:** `/admin/activity`  
**Scenario:** Browser width < 768px  
**What to show:**
- Responsive grid layout for filters (stacked)
- Table horizontally scrollable
- Detail drawer full-width
- Navigation and controls still accessible

**File name:** `i904_ui_mobile.png`

---

### 10. Error State
**URL:** `/admin/activity`  
**Scenario:** Database error (mock by disconnecting DB)  
**What to show:**
- Error banner: "Error: Failed to load activity log"
- Empty event list
- Filters still accessible
- Refresh button

**File name:** `i904_ui_error_state.png`

---

## How to Capture

### Using Browser DevTools
```javascript
// 1. Open browser console (F12)
// 2. Take screenshot
// Chrome: Ctrl+Shift+P, type "screenshot", choose "Capture full size screenshot"
// Firefox: Right-click, "Take Screenshot", "Save full page"
// Safari: Develop > Show Web Inspector > Screenshot icon
```

### Using PowerShell (Automated)
```powershell
# Install Selenium if needed
# pip install selenium

# Run screenshot script (example)
python scripts/capture-ui-screenshots.py
```

### Manual Steps
1. Navigate to `/admin/activity`
2. Set up the scenario (filters, etc.)
3. Press `F12` to open DevTools
4. Click device toolbar icon (phone/tablet icon)
5. Set viewport size: 1920x1080 (desktop) or 375x812 (mobile)
6. Take screenshot using DevTools or OS screenshot tool
7. Save with descriptive filename

## Screenshot Specifications

- **Format:** PNG (lossless)
- **Resolution:** 1920x1080 (desktop), 375x812 (mobile)
- **DPI:** 72 (web standard)
- **Color:** RGB
- **Size:** < 500KB per image (compress if needed)

## Storage Location

Save all screenshots to:
```
docs/screenshots/i904/
```

## Verification Checklist

For each screenshot, verify:
- [ ] UI elements clearly visible
- [ ] Text readable (not blurry)
- [ ] Colors match design
- [ ] No sensitive data visible (real user IDs, secrets, etc.)
- [ ] Timestamp/date shows recent date (not 1970-01-01)
- [ ] File size < 500KB
- [ ] File name follows convention

## Including in Documentation

Use screenshots in markdown like this:
```markdown
### Activity Log Main View
![Activity Log Events List](./docs/screenshots/i904/i904_ui_events_list.png)

### Event Detail Drawer
![Event Detail Drawer](./docs/screenshots/i904/i904_ui_detail_drawer.png)
```

## Sample Data Setup

To get good screenshots with realistic data:

### 1. Create sample events (SQL)
```sql
-- Run in staging database
INSERT INTO unified_timeline_events (
  event_type, timestamp, actor, subject_type, subject_identifier,
  request_id, summary, details, links
) VALUES
  ('approval_approved', NOW(), 'user-123', 'afu9_issue', 'session:abc', 
   'req-1', 'user-123 approved publish for CR-2025-12-30-001', '{}', '{}'),
  ('issue_published', NOW() - INTERVAL '1 hour', 'system', 'gh_issue', 'owner/repo#101',
   'req-2', 'published issue owner/repo#101 for CR-2025-12-30-001', '{}', 
   '{"ghIssueUrl": "https://github.com/owner/repo/issues/101"}'),
  -- Add more as needed
;
```

### 2. Or use smoke test to generate events
```powershell
# Run verification script which generates events
./scripts/verify-i904.ps1 `
  -BaseUrl "https://stage.afu-9.com" `
  -SmokeKey $env:AFU9_SMOKE_KEY
```

## Notes

- **Redact sensitive data:** Before sharing screenshots, ensure no real:
  - User emails
  - API keys/tokens
  - Session IDs (unless example data)
  - Internal URLs (unless approved)

- **Browser choice:** Use Chrome for consistency (most common)

- **Zoom level:** Set to 100% (Ctrl+0)

- **Dark mode:** Capture both light and dark mode if theme toggle exists

## Questions?

Contact the team if you need:
- Sample data setup help
- Screenshot automation
- Specific scenario guidance
