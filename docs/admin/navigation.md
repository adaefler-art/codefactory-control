# Navigation Management - Issue 01 Investigation

**Date:** 2026-02-06  
**Issue:** Fix Issue 01 - Navigation  
**Status:** Investigation Complete

## Problem Statement

The "Navigation verwalten" (Navigation Management) feature is expected to allow editing and persisting navigation entries per role. Currently, the system reports:

- **Error:** `PUT /api/admin/navigation/admin` returns HTTP 405 (Method Not Allowed)
- **UI:** Reordering works on the UI side
- **Persistence:** Missing - changes are not saved

## Source of Truth Investigation

### Current Implementation

**Stored in:** Hardcoded JavaScript array (no database, no configuration file)

**Location:** `/control-center/app/components/Navigation.tsx`

```typescript
const navItems = [
  { href: "/intent", label: "INTENT" },
  { href: "/timeline", label: "Timeline" },
  { href: "/issues", label: "Issues" },
  { href: "/incidents", label: "Incidents" },
  { href: "/lawbook", label: "Lawbook" },
  { href: "/operate", label: "Operate" },
  { href: "/admin/lawbook", label: "Admin" },
  { href: "/settings", label: "Settings" },
];
```

### What's Missing

#### 1. API Route (Expected but Not Found)

**Expected Path:** `control-center/app/api/admin/navigation/[role]/route.ts`

**Status:** ❌ Does NOT exist

**Current Behavior:**
- Any PUT request to `/api/admin/navigation/admin` returns 405 (Method Not Allowed)
- Next.js returns 405 when no route handler exists for the requested HTTP method

#### 2. Database Schema

**Expected:** A database table to store navigation configurations per role

**Status:** ❌ Does NOT exist

**Searched:**
- `/database/migrations/*.sql` - No navigation table found
- Database schema does NOT include navigation persistence

#### 3. UI for Navigation Management

**Expected:** Admin interface to add/edit/reorder navigation items

**Status:** ❌ Does NOT exist (or not functional)

**Note:** Issue mentions "Reorder funktioniert UI-seitig" (reordering works on UI side), but this may refer to visual reordering only without persistence.

## Architecture Analysis

### Current Navigation Flow

```
User → Navigation.tsx → Hardcoded navItems[] → Rendered in UI
```

### Required Navigation Flow (for role-based management)

```
Admin UI → PUT /api/admin/navigation/[role]
         ↓
    API Route Handler
         ↓
    Database (navigation_configs table)
         ↓
    Save role-specific navigation

User → GET /api/navigation?role=admin
     ↓
  API Route Handler
     ↓
  Database Query
     ↓
  Return role-specific navigation
     ↓
  Navigation.tsx renders dynamic items
```

## Required Implementation

To implement navigation management, the following components are needed:

### 1. Database Migration

Create a new migration file to add a navigation configurations table:

```sql
-- Example schema (to be refined)
CREATE TABLE IF NOT EXISTS navigation_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL, -- e.g., 'admin', 'user', 'viewer'
  items JSONB NOT NULL, -- Array of navigation items
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role)
);

-- Example items format:
-- [
--   { "href": "/intent", "label": "INTENT", "order": 1 },
--   { "href": "/timeline", "label": "Timeline", "order": 2 }
-- ]
```

### 2. API Routes

#### GET /api/admin/navigation/[role]/route.ts

```typescript
export async function GET(
  request: Request,
  { params }: { params: { role: string } }
) {
  // Fetch navigation config from database by role
  // Return navigation items
}
```

#### PUT /api/admin/navigation/[role]/route.ts

```typescript
export async function PUT(
  request: Request,
  { params }: { params: { role: string } }
) {
  // Validate request body (navigation items)
  // Update navigation config in database
  // Return updated config
}
```

### 3. Admin UI Component

Create an admin interface for managing navigation:

**Suggested Path:** `/control-center/app/admin/navigation/page.tsx`

**Features:**
- Select role (admin, user, etc.)
- View current navigation items
- Add/edit/delete items
- Drag-and-drop reordering
- Save changes via PUT request to API

### 4. Update Navigation Component

Modify `/control-center/app/components/Navigation.tsx` to:
- Fetch navigation items from API based on user role
- Use dynamic navigation instead of hardcoded array
- Fall back to default items if API fails

## Next Steps

1. **Decision:** Choose storage approach
   - Option A: PostgreSQL table (recommended for production)
   - Option B: Configuration file (simpler, but less flexible)

2. **Database Migration:** Create migration for navigation_configs table

3. **API Implementation:** Create route handlers for GET and PUT

4. **Admin UI:** Build interface for managing navigation items

5. **Update Navigation Component:** Make it dynamic and role-aware

6. **Testing:** Verify CRUD operations and role-based navigation

## Notes

- Current navigation visibility is partially role-aware (e.g., `showCostControl` flag for staging admins)
- Any new implementation should preserve existing role-based visibility logic
- Consider adding validation for navigation items (href format, label length, etc.)
- Consider adding audit logging for navigation configuration changes

---

**Investigation By:** GitHub Copilot Agent  
**Last Updated:** 2026-02-06
