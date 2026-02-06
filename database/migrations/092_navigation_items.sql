-- Migration: 092_navigation_items.sql
-- V09-I01: Navigation Management
--
-- Creates tables for role-based navigation items management.
-- Enables operators to configure navigation menus per role (admin, user, etc.)
--
-- Tables:
--   navigation_items: Stores navigation menu items with role-based visibility
--
-- Security:
--   - No PII
--   - Role-based access control
--   - Admin-only mutations

-- ============================================================================
-- Table: navigation_items
-- ============================================================================
-- Stores navigation menu items with role-based configuration
CREATE TABLE IF NOT EXISTS navigation_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role             TEXT NOT NULL,              -- 'admin' | 'user' | 'guest' | '*' (all roles)
  href             TEXT NOT NULL,              -- Route path (e.g., "/intent", "/issues")
  label            TEXT NOT NULL,              -- Display label (e.g., "INTENT", "Issues")
  position         INTEGER NOT NULL,           -- Display order (0-based)
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,  -- Is this item visible?
  icon             TEXT,                       -- Optional icon name
  
  -- Audit fields
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_role CHECK (role IN ('admin', 'user', 'guest', '*')),
  CONSTRAINT unique_role_position UNIQUE (role, position),
  CONSTRAINT unique_role_href UNIQUE (role, href)
);

-- Index for querying by role
CREATE INDEX idx_navigation_items_role 
  ON navigation_items (role, position);

-- Index for enabled items
CREATE INDEX idx_navigation_items_enabled 
  ON navigation_items (role, enabled, position);

-- Add comment for documentation
COMMENT ON TABLE navigation_items IS 
  'V09-I01: Role-based navigation menu items. Configurable via admin UI.';

-- ============================================================================
-- Seed default navigation items
-- ============================================================================
-- Insert default navigation items for all roles
INSERT INTO navigation_items (role, href, label, position, enabled) VALUES
  ('*', '/intent', 'INTENT', 0, true),
  ('*', '/timeline', 'Timeline', 1, true),
  ('*', '/issues', 'Issues', 2, true),
  ('*', '/incidents', 'Incidents', 3, true),
  ('*', '/lawbook', 'Lawbook', 4, true),
  ('*', '/operate', 'Operate', 5, true),
  ('*', '/settings', 'Settings', 6, true)
ON CONFLICT DO NOTHING;

-- Admin-specific navigation items
INSERT INTO navigation_items (role, href, label, position, enabled) VALUES
  ('admin', '/intent', 'INTENT', 0, true),
  ('admin', '/timeline', 'Timeline', 1, true),
  ('admin', '/issues', 'Issues', 2, true),
  ('admin', '/incidents', 'Incidents', 3, true),
  ('admin', '/lawbook', 'Lawbook', 4, true),
  ('admin', '/operate', 'Operate', 5, true),
  ('admin', '/admin/lawbook', 'Admin', 6, true),
  ('admin', '/settings', 'Settings', 7, true)
ON CONFLICT DO NOTHING;
