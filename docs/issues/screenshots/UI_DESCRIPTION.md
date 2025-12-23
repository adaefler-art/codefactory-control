# AFU9 Issues List View - Visual Reference

This document describes the visual appearance of the AFU9 Issues list view.

## Layout Description

### Header Section
- **Title**: "AFU9 Issues" in large purple text (text-3xl, text-purple-400)
- **New Issue Button**: Purple button on the right (bg-purple-600)

### Filter Panel
A dark card (bg-gray-900) with 3-column grid containing:

1. **Status Dropdown**: 
   - Label: "Status"
   - Options: All Statuses, CREATED, ACTIVE, BLOCKED, DONE
   - Dark background (bg-gray-800)

2. **Label Dropdown**:
   - Label: "Label"
   - Options: All Labels + dynamically loaded labels from issues
   - Dark background (bg-gray-800)

3. **Search Input**:
   - Label: "Search"
   - Placeholder: "Search title or body..."
   - Dark background (bg-gray-800)

### Issues Table

**Table Header (bg-gray-800/50)**:
- Title
- Status
- Labels
- Handoff State
- Updated

**Table Rows (hover effect: bg-gray-800/50)**:

Each row is clickable and contains:

1. **Title Cell**:
   - Title in purple (text-purple-400)
   - Priority badge below (if present): P0, P1, or P2 in gray

2. **Status Cell**:
   - Badge with color coding:
     - ACTIVE: Green (bg-green-900/30, text-green-200, border-green-700)
     - DONE: Blue (bg-blue-900/30, text-blue-200, border-blue-700)
     - BLOCKED: Red (bg-red-900/30, text-red-200, border-red-700)
     - CREATED: Gray (bg-gray-700/30, text-gray-200, border-gray-600)

3. **Labels Cell**:
   - Multiple chip badges (bg-blue-900/30, text-blue-200, border-blue-700)
   - "No labels" text if empty

4. **Handoff State Cell**:
   - Badge with color coding:
     - SYNCED: Green (bg-green-900/30, text-green-200, border-green-700)
     - SENT: Yellow (bg-yellow-900/30, text-yellow-200, border-yellow-700)
     - FAILED: Red (bg-red-900/30, text-red-200, border-red-700) + warning icon ⚠️
     - NOT_SENT: Gray (bg-gray-700/30, text-gray-200, border-gray-600)

5. **Updated Cell**:
   - Timestamp in German format (e.g., "23. Dez. 2023, 12:00")
   - Gray text (text-gray-400)

### Empty State

When no issues match filters:
- "No issues found" message in gray
- Suggestion: "Try adjusting your filters or create a new issue"

### Loading State

- Spinning purple loader (border-purple-500)
- "Loading issues..." text below

### Error State

Red card (bg-red-900/20, border-red-700) with error message

## Color Scheme

**Background**: Dark theme (bg-gray-950)
**Primary**: Purple (#a855f7, #9333ea)
**Cards**: Gray-900
**Borders**: Gray-800
**Text**: Gray-100 (main), Gray-400 (secondary)

**Status Colors**:
- Green: Success/Active/Synced
- Blue: Done/Labels
- Red: Blocked/Failed
- Yellow: In Progress/Sent
- Gray: Neutral/Not Sent/Created

## Responsiveness

- Filters collapse to single column on mobile (md:grid-cols-3)
- Table scrolls horizontally on small screens (overflow-x-auto)
- Maximum width: 7xl (max-w-7xl)
- Padding: Responsive (px-4, sm:px-6, lg:px-8)

## Interactive Elements

1. **Filters**: Real-time filtering on change
2. **Row Click**: Navigate to `/issues/:id`
3. **New Issue Button**: Navigate to `/issues/new`
4. **Failed Handoff Icon**: Tooltip shows error message on hover
