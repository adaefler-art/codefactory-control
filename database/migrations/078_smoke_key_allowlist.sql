-- Migration: Smoke Key Allowlist (I906)
-- Purpose: Runtime-configurable allowlist for smoke-key authenticated endpoints
-- Security: Fail-closed, admin-only modifications, full audit trail

-- ========================================
-- smoke_key_allowlist table
-- ========================================
-- Stores allowed route patterns for smoke-key bypass authentication
-- Hard limits enforced: max 100 active routes
CREATE TABLE IF NOT EXISTS smoke_key_allowlist (
  id SERIAL PRIMARY KEY,
  
  -- Route pattern (exact or regex)
  route_pattern TEXT NOT NULL,
  
  -- HTTP method (GET, POST, etc.) or * for all methods
  method VARCHAR(10) NOT NULL DEFAULT '*',
  
  -- Whether route_pattern is a regex (true) or exact match (false)
  is_regex BOOLEAN NOT NULL DEFAULT false,
  
  -- Description/purpose of this allowlist entry
  description TEXT,
  
  -- Audit trail
  added_by VARCHAR(255) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by VARCHAR(255),
  removed_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_method CHECK (
    method IN ('*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS')
  ),
  CONSTRAINT route_pattern_not_empty CHECK (LENGTH(TRIM(route_pattern)) > 0)
);

-- ========================================
-- Indexes
-- ========================================
-- Fast lookup of active routes
CREATE INDEX idx_smoke_key_allowlist_active 
  ON smoke_key_allowlist(removed_at) 
  WHERE removed_at IS NULL;

-- Pattern matching optimization
CREATE INDEX idx_smoke_key_allowlist_pattern 
  ON smoke_key_allowlist(route_pattern, method) 
  WHERE removed_at IS NULL;

-- Audit trail queries
CREATE INDEX idx_smoke_key_allowlist_added_at 
  ON smoke_key_allowlist(added_at DESC);

CREATE INDEX idx_smoke_key_allowlist_added_by 
  ON smoke_key_allowlist(added_by);

-- ========================================
-- Update trigger
-- ========================================
CREATE OR REPLACE FUNCTION update_smoke_key_allowlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_smoke_key_allowlist_updated_at
  BEFORE UPDATE ON smoke_key_allowlist
  FOR EACH ROW
  EXECUTE FUNCTION update_smoke_key_allowlist_updated_at();

-- ========================================
-- Comments
-- ========================================
COMMENT ON TABLE smoke_key_allowlist IS 
  'I906: Runtime-configurable allowlist for smoke-key authenticated endpoints. Enables smoke testing without redeployment.';

COMMENT ON COLUMN smoke_key_allowlist.route_pattern IS 
  'Route pattern to match. Either exact string or regex pattern if is_regex=true';

COMMENT ON COLUMN smoke_key_allowlist.method IS 
  'HTTP method filter. Use * to allow all methods for this route';

COMMENT ON COLUMN smoke_key_allowlist.is_regex IS 
  'When true, route_pattern is treated as a regex. When false, exact string match.';

COMMENT ON COLUMN smoke_key_allowlist.removed_at IS 
  'Soft delete: when set, this route is no longer in the active allowlist';

-- ========================================
-- Initial data migration from hardcoded allowlist
-- ========================================
-- Migrate existing hardcoded routes from proxy.ts to database
-- Added by: system (migration 078)

INSERT INTO smoke_key_allowlist (route_pattern, method, is_regex, description, added_by) VALUES
  ('/api/timeline/chain', 'GET', false, 'Timeline chain endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/issues', 'GET', false, 'List issues endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/issues/sync', 'POST', false, 'Sync issues endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/issues/refresh', 'POST', false, 'Refresh issues endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/ops/issues/sync', 'POST', false, 'Ops sync issues endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/ops/db/migrations', 'GET', false, 'DB migrations status endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/ops/db/migration-parity', 'GET', false, 'DB migration parity endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('/api/integrations/github/ingest/issue', 'POST', false, 'GitHub issue ingest endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/intent/sessions$', '*', true, 'Intent sessions endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/intent/sessions/[^/]+$', 'GET', true, 'Get intent session endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/intent/sessions/[^/]+/messages$', 'POST', true, 'Post intent session messages (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/intent/sessions/[^/]+/issue-draft$', '*', true, 'Intent issue draft endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/issues/\d+/assign-copilot$', 'POST', true, 'GitHub assign copilot endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/request-review-and-wait$', 'POST', true, 'GitHub PR review request endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/collect-summary$', 'POST', true, 'GitHub PR summary collection endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/merge$', 'POST', true, 'GitHub PR merge endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/checks/triage$', '*', true, 'GitHub PR checks triage endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/checks/stop-decision$', '*', true, 'GitHub PR checks stop decision endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/github/prs/\d+/checks/prompt$', '*', true, 'GitHub PR checks prompt endpoint (pre-I906 hardcoded)', 'system:migration'),
  ('^/api/issues/[^/]+/state-flow$', 'GET', true, 'Issue state flow endpoint (pre-I906 hardcoded)', 'system:migration');

-- ========================================
-- Verification
-- ========================================
-- SELECT COUNT(*) as active_routes FROM smoke_key_allowlist WHERE removed_at IS NULL;
-- Should show 20 active routes from migration
