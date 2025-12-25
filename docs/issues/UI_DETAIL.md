# AFU9 Issues UI - Detail View

This document describes the Issue Detail View UI, including fields, actions, and error handling UX.

## Overview

The Issue Detail View (`/issues/[id]`) provides a comprehensive interface for viewing and editing individual AFU9 issues. It implements a GitHub-like experience with inline editing, status management, label management, and integration with GitHub through the Feature Bridge.

## Page URL

```
/issues/[id]
```

Where `[id]` is the UUID of the AFU9 issue.

## Fields Displayed

### Core Information

#### 1. Title
- **Display**: Large, bold, purple-colored heading
- **Edit**: Click "Edit Title" button to enable inline editing
- **Behavior**: 
  - When editing, shows input field with Save/Cancel buttons
  - Saves via PATCH `/api/issues/:id`
  - Updates immediately upon save

#### 2. Body (Description)
- **Display**: Markdown-formatted text area
- **Edit**: Direct textarea editing with optional preview toggle
- **Preview Mode**: 
  - Toggle between "Edit" and "Preview" modes
  - Preview shows formatted text (whitespace-preserved)
  - Edit mode shows textarea with syntax highlighting
- **Behavior**: Saves via PATCH on "Save Changes" button

#### 3. Status
- **Display**: Dropdown selector with 4 options
- **Options**: 
  - `CREATED` - Gray badge (newly created)
  - `ACTIVE` - Green badge (currently being worked on)
  - `BLOCKED` - Red badge (blocked)
  - `DONE` - Blue badge (completed)
- **Edit**: Direct dropdown selection
- **Behavior**: 
  - Changes saved via PATCH on "Save Changes"
  - Note: Using "Activate" button is preferred for setting ACTIVE status

#### 4. Labels
- **Display**: Chips/badges with blue styling
- **Edit**: 
  - Add new labels via text input + "Add" button
  - Remove labels by clicking "×" on each chip
  - Enter key adds label
- **Behavior**: 
  - Saves via PATCH on "Save Changes"
  - Prevents duplicate labels
  - Case-sensitive

#### 5. Priority
- **Display**: Read-only field showing P0, P1, P2, or "No priority set"
- **Edit**: Not editable in this MVP (future enhancement)
- **Values**: `P0` (highest), `P1`, `P2`, or `null`

#### 6. Handoff State
- **Display**: Badge with color-coded state
- **States**:
  - `NOT_SENT` - Gray badge (not handed off yet)
  - `SENT` - Yellow badge (handoff in progress)
  - `SYNCED` - Green badge (successfully synced to GitHub)
  - `FAILED` - Red badge with warning icon (⚠️)
- **Behavior**: 
  - Read-only (managed by system)
  - Shows warning icon with tooltip on FAILED state

#### 7. GitHub Link
- **Display**: Shows GitHub issue number and link when available
- **Behavior**: 
  - Clickable link opens GitHub issue in new tab
  - Shows "Not handed off" when `github_url` is null
  - Link format: `#<issue_number> ↗`

#### 8. Created/Updated Timestamps
- **Display**: Read-only formatted dates
- **Format**: German locale (de-DE) format
  - Example: `23. Dez. 2023, 14:30`

### Error Information

#### Last Error
- **Display**: Only shown when `handoff_state === "FAILED"`
- **Styling**: Red background with border, displayed prominently in a dedicated error panel
- **Content**: Full error message from `last_error` field
- **Purpose**: Help users understand why handoff failed
- **Actions**: Includes a "Retry Handoff" button to attempt handoff again
- **Location**: Displayed within the metadata section, immediately visible when an error occurs

## Actions

### 1. Save Changes
- **Button**: Primary purple button in action bar
- **Behavior**:
  - Saves all edited fields (title, body, status, labels)
  - Only sends changed fields via PATCH
  - Shows success message on completion
  - Shows error message on failure
- **States**:
  - Normal: "Save Changes"
  - Saving: "Saving..." (disabled)
  - Error: Shows error in red banner

### 2. Activate
- **Button**: Green button in action bar
- **Behavior**:
  - Calls POST `/api/issues/:id/activate`
  - Sets issue to ACTIVE status
  - Automatically deactivates any other ACTIVE issue
  - Enforces Single-ACTIVE constraint
  - Shows message about previously active issue if deactivated
- **States**:
  - Normal: "Activate"
  - Activating: "Activating..." (disabled)
  - Already Active: "Already Active" (disabled)
- **Success Message**: 
  - Simple: "Issue activated successfully"
  - With deactivation: "Issue activated. Previously active issue 'X' was deactivated."

### 3. Handoff to GitHub
- **Button**: Blue button in action bar
- **Behavior**:
  - Calls POST `/api/issues/:id/handoff`
  - Creates GitHub issue via Feature Bridge
  - Updates `handoff_state`, `github_url`, and `github_issue_number`
  - Idempotent: Returns existing GitHub issue if already handed off
  - Refreshes activity log after successful handoff
  - Refreshes issue state after failed handoff to display error
- **States**:
  - Normal: "Handoff to GitHub"
  - Handing off: "Handing off..." (disabled)
  - Already Synced: "Already Synced" (disabled)
  - In Progress: "Handoff in Progress" (disabled when SENT state)
- **Success Message**: "Issue handed off to GitHub successfully! GitHub Issue #X"
- **Error Handling**: 
  - Shows error message in red banner
  - Updates `handoff_state` to FAILED
  - Sets `last_error` field with error details
  - Displays dedicated error panel with retry button

### 3.1. Retry Handoff
- **Button**: Red button in error panel (only shown when `handoff_state === "FAILED"`)
- **Behavior**:
  - Uses the same handoff logic as the main "Handoff to GitHub" button
  - Clears previous error state before attempting retry
  - Updates issue state on success or failure
- **States**:
  - Normal: "Retry Handoff"
  - Retrying: "Retrying..." (disabled)
- **Location**: Displayed within the error panel in the metadata section

### 4. Open GitHub Issue
- **Button**: Gray button in action bar (only shown when `github_url` exists)
- **Behavior**: Opens GitHub issue in new browser tab
- **Icon**: Arrow (↗) indicates external link

## Error UX

### Error Message Display

All errors are displayed in prominent, color-coded banners at the top of the page:

#### Success Messages (Green)
- Background: `bg-green-900/20`
- Border: `border-green-700`
- Text: `text-green-300`
- Auto-dismiss: 3 seconds
- Examples:
  - "Issue updated successfully"
  - "Issue activated successfully"
  - "Issue handed off to GitHub successfully! GitHub Issue #42"

#### Error Messages (Red)
- Background: `bg-red-900/20`
- Border: `border-red-700`
- Text: `text-red-300`
- Persistent: Stays until next action
- Examples:
  - "Failed to save changes"
  - "Single-Active constraint violation"
  - "Failed to handoff issue to GitHub"

### Specific Error Scenarios

#### 1. Single-Active Constraint Violation
- **Trigger**: Editing status to ACTIVE when another issue is already ACTIVE
- **Response**: 409 Conflict
- **Message**: "Single-Active constraint violation"
- **User Action**: Use "Activate" button instead, which handles deactivation

#### 2. Handoff Failed
- **Trigger**: GitHub API error, network error, configuration issue
- **Response**: Updates `handoff_state` to FAILED, sets `last_error`
- **Display**: 
  - Red banner with error message at the top of the page
  - Warning icon (⚠️) in Handoff State badge
  - Full error details in dedicated "Handoff Error" panel in metadata section
  - Red-styled "Retry Handoff" button in the error panel
- **User Action**: 
  - Review error message in the error panel
  - Fix underlying issue (e.g., check GitHub token, network connectivity)
  - Click "Retry Handoff" button to attempt handoff again
  - On retry, the system clears previous error and attempts fresh handoff

#### 3. Issue Not Found
- **Trigger**: Invalid or non-existent issue ID
- **Response**: 404 Not Found
- **Display**: Red error banner with "Back to Issues" link
- **User Action**: Return to issues list

#### 4. Network/Server Error
- **Trigger**: Network failure, server error
- **Display**: Red error banner with generic message
- **User Action**: Retry or contact support

## User Flow

### Complete Workflow: Create → Edit → Activate → Handoff

#### Step 1: Create Issue
1. Navigate to `/issues`
2. Click "New Issue" button
3. Fill in title, body, labels
4. Submit to create issue with `status=CREATED`

#### Step 2: Edit Issue
1. Click on issue in list to open detail view
2. Edit fields as needed:
   - Click "Edit Title" for inline title editing
   - Edit body in textarea
   - Change status via dropdown
   - Add/remove labels
3. Click "Save Changes"
4. Verify success message appears

#### Step 3: Activate Issue
1. Click "Activate" button
2. System automatically:
   - Deactivates any other ACTIVE issue
   - Sets this issue to ACTIVE status
   - Enforces Single-ACTIVE constraint
3. Success message shows which issue was deactivated (if any)
4. Status badge updates to green "ACTIVE"

#### Step 4: Handoff to GitHub
1. Click "Handoff to GitHub" button
2. System creates GitHub issue via Feature Bridge
3. On success:
   - `handoff_state` changes to SYNCED
   - `github_url` and `github_issue_number` are set
   - Success message shows GitHub issue number
   - "Open GitHub Issue" button appears
4. On failure:
   - `handoff_state` changes to FAILED
   - Error details shown in red banner and "Handoff Error" section
   - User can review error and retry

#### Step 5: Open in GitHub (Optional)
1. Click "Open GitHub Issue" button
2. GitHub issue opens in new tab
3. User can interact with issue on GitHub
4. Note: Changes on GitHub do NOT sync back to AFU9 (unidirectional)

## Technical Implementation

### API Endpoints Used

- **GET** `/api/issues/:id` - Fetch issue details
- **PATCH** `/api/issues/:id` - Update issue fields
- **POST** `/api/issues/:id/activate` - Activate issue (Single-ACTIVE)
- **POST** `/api/issues/:id/handoff` - Handoff to GitHub

### State Management

- React hooks (`useState`, `useEffect`)
- Separate state for:
  - Issue data
  - Edit fields (title, body, status, labels)
  - Loading states (saving, activating, handing off)
  - Error/success messages

### Validation

- Title: Non-empty string required
- Body: Optional, null allowed
- Status: Must be valid enum value
- Labels: Array of strings, no duplicates

### Single-ACTIVE Enforcement

- **Preferred Method**: Use "Activate" button
  - Automatically handles deactivation of other ACTIVE issues
  - Safe and idempotent
- **Alternative**: Edit status dropdown + Save
  - Will fail with 409 Conflict if another issue is ACTIVE
  - Less user-friendly

## Design Patterns

### GitHub-like UI
- Clean, card-based layout
- Inline editing for title
- Textarea with preview for body
- Badge-based status indicators
- Action buttons in footer
- Consistent color scheme (dark theme with purple accents)

### Responsive Design
- Mobile-friendly grid layout
- Stacked columns on small screens
- Touch-friendly buttons and inputs
- Accessible form controls

### User Feedback
- Loading spinners during async operations
- Disabled buttons during operations
- Clear success/error messages
- Auto-dismissing success messages
- Persistent error messages

## Accessibility

- Semantic HTML elements
- Clear labels for all form fields
- Keyboard navigation support
- Focus states on interactive elements
- ARIA attributes where appropriate
- Error messages associated with fields

## Future Enhancements

Potential improvements for future iterations:

1. **Priority Editing**: Allow editing priority field
2. **Assignee Management**: Add assignee picker/selector
3. **Markdown Rendering**: Full markdown preview with formatting
4. **Comment Thread**: Add comments/discussion on issues
5. **Activity Log**: Show history of changes
6. **Attachments**: Upload files/images to issues
7. **Linked Issues**: Reference and link related issues
8. **Shortcuts**: Keyboard shortcuts for common actions
9. **Auto-save**: Auto-save drafts as user types
10. **Bidirectional Sync**: Sync changes from GitHub back to AFU9

## Related Documentation

- [AFU9 Issues UI Overview](./UI_OVERVIEW.md) - List view documentation
- [AFU9 Issues API](../AFU9-ISSUES-API.md) - API endpoints
- [AFU9 Issue Model](./AFU9_ISSUE_MODEL.md) - Data model specification
- [Issue State Machine](../v04/ISSUE_STATE_MACHINE.md) - Status lifecycle
