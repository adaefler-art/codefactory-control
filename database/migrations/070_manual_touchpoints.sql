-- Migration 070: Manual Touchpoints Tracking (E88.1)
-- 
-- Tracks explicit human interventions in AFU-9 cycles to measure "Human-in-the-Loop" activity.
-- Supports analysis of automation effectiveness and reduction of manual steering hours.
-- 
-- Touchpoint Types:
-- - ASSIGN: Assigning issue to Copilot
-- - REVIEW: Requesting or providing review feedback
-- - MERGE_APPROVAL: Explicit merge approval (YES MERGE)
-- - DEBUG_INTERVENTION: Manual debugging or rerun action
-- 
-- Design Principles:
-- - Append-only (no updates/deletes)
-- - Idempotent (deduplicated by idempotency_key)
-- - Zero impact on existing automation paths
-- - Deterministic aggregation

-- ========================================
-- Manual Touchpoints Table
-- ========================================

CREATE TABLE IF NOT EXISTS manual_touchpoints (
  -- Identity
  id SERIAL PRIMARY KEY,
  
  -- Idempotency (prevent double-counts)
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  
  -- Context identifiers (nullable to support various scenarios)
  cycle_id VARCHAR(255), -- Release cycle identifier (e.g., "v0.5.0", "2026-01-15")
  issue_id UUID REFERENCES afu9_issues(id) ON DELETE SET NULL, -- AFU-9 issue reference
  gh_issue_number INTEGER, -- GitHub issue number for correlation
  pr_number INTEGER, -- GitHub PR number for correlation
  session_id VARCHAR(255), -- INTENT session ID for correlation
  
  -- Touchpoint classification
  type VARCHAR(50) NOT NULL CHECK (type IN (
    'ASSIGN',
    'REVIEW',
    'MERGE_APPROVAL',
    'DEBUG_INTERVENTION'
  )),
  
  -- Source of the touchpoint
  source VARCHAR(50) NOT NULL CHECK (source IN (
    'UI',         -- Manual action via Control Center UI
    'INTENT',     -- Action via INTENT session
    'GH',         -- Direct GitHub action
    'API'         -- Direct API call
  )),
  
  -- Actor information
  actor VARCHAR(255) NOT NULL, -- User ID or system identifier
  
  -- Request tracking
  request_id VARCHAR(255) NOT NULL, -- Request ID for correlation with other events
  
  -- Metadata (bounded JSONB for additional context)
  metadata JSONB NOT NULL DEFAULT '{}' CHECK (pg_column_size(metadata) <= 4096), -- Max ~4KB
  
  -- Timestamps (append-only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- Indexes for Efficient Queries
-- ========================================

-- Query by cycle
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_cycle_id
  ON manual_touchpoints(cycle_id, created_at DESC)
  WHERE cycle_id IS NOT NULL;

-- Query by issue
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_issue_id
  ON manual_touchpoints(issue_id, created_at DESC)
  WHERE issue_id IS NOT NULL;

-- Query by GitHub issue number
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_gh_issue_number
  ON manual_touchpoints(gh_issue_number, created_at DESC)
  WHERE gh_issue_number IS NOT NULL;

-- Query by PR number
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_pr_number
  ON manual_touchpoints(pr_number, created_at DESC)
  WHERE pr_number IS NOT NULL;

-- Query by session
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_session_id
  ON manual_touchpoints(session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

-- Query by type
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_type
  ON manual_touchpoints(type, created_at DESC);

-- Query by source
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_source
  ON manual_touchpoints(source, created_at DESC);

-- Query by actor
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_actor
  ON manual_touchpoints(actor, created_at DESC);

-- Query by request ID (for deduplication/correlation)
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_request_id
  ON manual_touchpoints(request_id, created_at DESC);

-- Global timeline (all touchpoints sorted by time)
CREATE INDEX IF NOT EXISTS idx_manual_touchpoints_created_at
  ON manual_touchpoints(created_at DESC);

-- ========================================
-- Helper Views
-- ========================================

-- Recent touchpoints (last 100)
CREATE OR REPLACE VIEW recent_touchpoints AS
SELECT 
  id,
  type,
  source,
  actor,
  cycle_id,
  issue_id,
  gh_issue_number,
  pr_number,
  created_at
FROM manual_touchpoints
ORDER BY created_at DESC
LIMIT 100;

-- Touchpoints by cycle with counts
CREATE OR REPLACE VIEW touchpoints_by_cycle AS
SELECT 
  cycle_id,
  COUNT(*) as total_touchpoints,
  COUNT(*) FILTER (WHERE type = 'ASSIGN') as assign_count,
  COUNT(*) FILTER (WHERE type = 'REVIEW') as review_count,
  COUNT(*) FILTER (WHERE type = 'MERGE_APPROVAL') as merge_approval_count,
  COUNT(*) FILTER (WHERE type = 'DEBUG_INTERVENTION') as debug_intervention_count,
  MIN(created_at) as first_touchpoint_at,
  MAX(created_at) as last_touchpoint_at
FROM manual_touchpoints
WHERE cycle_id IS NOT NULL
GROUP BY cycle_id
ORDER BY last_touchpoint_at DESC;

-- Touchpoints by issue with counts
CREATE OR REPLACE VIEW touchpoints_by_issue AS
SELECT 
  issue_id,
  gh_issue_number,
  COUNT(*) as total_touchpoints,
  COUNT(*) FILTER (WHERE type = 'ASSIGN') as assign_count,
  COUNT(*) FILTER (WHERE type = 'REVIEW') as review_count,
  COUNT(*) FILTER (WHERE type = 'MERGE_APPROVAL') as merge_approval_count,
  COUNT(*) FILTER (WHERE type = 'DEBUG_INTERVENTION') as debug_intervention_count,
  MIN(created_at) as first_touchpoint_at,
  MAX(created_at) as last_touchpoint_at
FROM manual_touchpoints
WHERE issue_id IS NOT NULL
GROUP BY issue_id, gh_issue_number
ORDER BY last_touchpoint_at DESC;

-- Touchpoints by type (summary statistics)
CREATE OR REPLACE VIEW touchpoints_by_type AS
SELECT 
  type,
  COUNT(*) as total_count,
  COUNT(DISTINCT actor) as unique_actors,
  COUNT(DISTINCT cycle_id) as unique_cycles,
  COUNT(DISTINCT issue_id) as unique_issues,
  MIN(created_at) as first_seen,
  MAX(created_at) as last_seen
FROM manual_touchpoints
GROUP BY type
ORDER BY total_count DESC;

-- ========================================
-- Comments for Documentation
-- ========================================

COMMENT ON TABLE manual_touchpoints IS 
  'E88.1: Append-only audit trail for manual human touchpoints (assign/review/merge/debug) per cycle and issue';

COMMENT ON COLUMN manual_touchpoints.idempotency_key IS 
  'Unique key to prevent double-counting: hash of (type, actor, context identifiers, timestamp window)';

COMMENT ON COLUMN manual_touchpoints.type IS 
  'Type of manual intervention: ASSIGN, REVIEW, MERGE_APPROVAL, DEBUG_INTERVENTION';

COMMENT ON COLUMN manual_touchpoints.source IS 
  'Origin of the touchpoint: UI (Control Center), INTENT (session), GH (GitHub), API (direct call)';

COMMENT ON COLUMN manual_touchpoints.cycle_id IS 
  'Release cycle identifier for aggregation and analysis';

COMMENT ON COLUMN manual_touchpoints.metadata IS 
  'Bounded JSONB payload (max ~4KB) for additional context - no secrets';
