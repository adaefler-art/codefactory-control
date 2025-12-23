# AFU9 Issues UI - Overview

This document provides an overview of the AFU9 Issues UI, focusing on the list view functionality.

## Purpose

The Issues UI provides a GitHub-like interface for managing AFU9 issues within the Control Center. It allows users to view, filter, search, and navigate issues in a streamlined manner.

## Features

### 1. Issues List View

The main issues page (`/issues`) displays all AFU9 issues in a table format with the following features:

#### Columns
- **Title**: Issue title with priority indicator (clickable to navigate to detail view)
- **Status**: Current status badge (CREATED, ACTIVE, BLOCKED, DONE)
- **Labels**: Label chips for categorization
- **Handoff State**: GitHub handoff status (NOT_SENT, SENT, SYNCED, FAILED)
- **Updated**: Last update timestamp

#### Filtering & Search
The UI supports multiple filtering options:
- **Status Filter**: Filter by issue status (CREATED, ACTIVE, BLOCKED, DONE)
- **Label Filter**: Filter by specific label
- **Search**: Full-text search across issue title and body

All filters work together and update the list in real-time.

#### Visual Indicators

**Status Badges:**
- `ACTIVE`: Green badge (currently being worked on)
- `DONE`: Blue badge (completed)
- `BLOCKED`: Red badge (blocked)
- `CREATED`: Gray badge (newly created)

**Handoff State Badges:**
- `SYNCED`: Green badge (successfully synced to GitHub)
- `SENT`: Yellow badge (handoff in progress)
- `FAILED`: Red badge with warning icon (handoff failed)
- `NOT_SENT`: Gray badge (not yet handed off)

**Failed Handoff Indicator:**
When an issue has `handoff_state=FAILED`, a warning icon (⚠️) is displayed next to the state badge with a tooltip showing the error details.

### 2. Navigation

- **New Issue Button**: Top-right button to create a new issue (navigates to `/issues/new`)
- **Row Click**: Clicking any issue row navigates to the detail view (`/issues/:id`)
- **Navigation Bar**: "Issues" link in the main navigation for easy access

### 3. Responsive Design

The UI is fully responsive and follows the AFU9 Control Center design system:
- Dark theme with purple accents
- Tailwind CSS for styling
- Mobile-friendly layout with responsive grid for filters
- Smooth hover transitions and visual feedback

## User Workflow

1. **Access Issues**: Click "Issues" in the navigation bar
2. **Filter/Search**: Use the filter controls to find specific issues
3. **View Details**: Click on any issue row to see full details
4. **Create New**: Click "New Issue" button to create a new issue

## Technical Details

### API Integration

The UI consumes the following API endpoint:
- `GET /api/issues` - List issues with optional query parameters:
  - `status`: Status filter
  - `label`: Label filter
  - `q`: Search query

### State Management

The component uses React hooks for state management:
- `useState` for local state (filters, loading, error)
- `useEffect` for data fetching on filter changes
- `useRouter` for navigation

### Type Safety

TypeScript interfaces ensure type safety for issue data:
```typescript
interface Issue {
  id: string;
  title: string;
  status: "CREATED" | "ACTIVE" | "BLOCKED" | "DONE";
  labels: string[];
  handoff_state: "NOT_SENT" | "SENT" | "SYNCED" | "FAILED";
  // ... additional fields
}
```

## Future Enhancements

Potential improvements for future iterations:
- Pagination for large issue lists
- Bulk actions (activate, delete multiple issues)
- Sortable columns
- Advanced search with operators
- Issue templates
- Inline status updates

## Screenshots

![AFU9 Issues List View](./screenshots/issues-list-view.png)
*AFU9 Issues list view showing filtering, status badges, and handoff state indicators*

**Note**: For a detailed visual description of the UI layout and styling, see [UI Visual Description](./screenshots/UI_DESCRIPTION.md).

## Related Documentation

- [AFU9 Issues API](../AFU9-ISSUES-API.md) - API documentation
- [AFU9 Issue Model](./AFU9_ISSUE_MODEL.md) - Data model specification
