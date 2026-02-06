# Navigation Management

## V09-I01: Fix Navigation Feature

### Source of Truth

**Stored in:** PostgreSQL Database  
**Table:** `navigation_items`  
**Migration:** `database/migrations/092_navigation_items.sql`

### Architecture

The navigation system is role-based and stored in a PostgreSQL database table. This allows dynamic configuration of navigation menus per user role without requiring code deployments.

#### Data Model

```sql
CREATE TABLE navigation_items (
  id               UUID PRIMARY KEY,
  role             TEXT NOT NULL,          -- 'admin' | 'user' | 'guest' | '*'
  href             TEXT NOT NULL,          -- Route path
  label            TEXT NOT NULL,          -- Display label
  position         INTEGER NOT NULL,       -- Display order
  enabled          BOOLEAN NOT NULL,       -- Visibility flag
  icon             TEXT,                   -- Optional icon name
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ
);
```

#### Constraints

- **Role validation**: Only `'admin'`, `'user'`, `'guest'`, or `'*'` (all roles)
- **Unique constraint**: `(role, position)` - prevents duplicate positions within a role
- **Unique constraint**: `(role, href)` - prevents duplicate links within a role

### API Endpoints

#### GET /api/admin/navigation/[role]

Fetches navigation items for a specific role.

**Request:**
```http
GET /api/admin/navigation/admin
Authorization: Required (admin only)
```

**Response:**
```json
{
  "ok": true,
  "role": "admin",
  "items": [
    {
      "id": "uuid",
      "href": "/intent",
      "label": "INTENT",
      "position": 0,
      "enabled": true,
      "icon": null
    }
  ]
}
```

#### PUT /api/admin/navigation/[role]

Updates all navigation items for a specific role (replaces existing items).

**Request:**
```http
PUT /api/admin/navigation/admin
Content-Type: application/json
Authorization: Required (admin only)

{
  "items": [
    {
      "href": "/intent",
      "label": "INTENT",
      "position": 0,
      "enabled": true
    }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "role": "admin",
  "items": [
    {
      "id": "uuid",
      "href": "/intent",
      "label": "INTENT",
      "position": 0,
      "enabled": true,
      "icon": null
    }
  ]
}
```

### Database Access Layer

**File:** `control-center/src/lib/db/navigationItems.ts`

**Functions:**
- `getNavigationItems(role)` - Get items for a role (includes wildcard `*` items)
- `getNavigationItemsByRole(role)` - Get items for exact role match
- `updateNavigationItems(role, items)` - Replace all items for a role
- `createNavigationItem(role, item)` - Create single item
- `deleteNavigationItem(id)` - Delete single item

### API Routes Registry

**File:** `control-center/src/lib/api-routes.ts`

```typescript
admin: {
  navigation: {
    get: (role: string) => `/api/admin/navigation/${role}`,
    update: (role: string) => `/api/admin/navigation/${role}`,
  },
}
```

### Default Navigation Items

The migration seeds default navigation items for:

**All roles (`*`):**
- INTENT, Timeline, Issues, Incidents, Lawbook, Operate, Settings

**Admin role:**
- All items from `*` + Admin (Lawbook admin panel)

### Security

- **Authentication**: Required (x-afu9-sub header)
- **Authorization**: Admin-only (AFU9_ADMIN_SUBS environment variable)
- **Input validation**: Zod-like validation for all fields
- **SQL injection protection**: Parameterized queries
- **RBAC**: Role-based access control enforced at DB level

### Related Files

- Migration: `database/migrations/092_navigation_items.sql`
- DB Layer: `control-center/src/lib/db/navigationItems.ts`
- API Route: `control-center/app/api/admin/navigation/[role]/route.ts`
- API Registry: `control-center/src/lib/api-routes.ts`

---

**Last Updated:** 2026-02-06  
**Issue:** V09-I01 - Fix Navigation Management Feature  
**Status:** API implementation complete
