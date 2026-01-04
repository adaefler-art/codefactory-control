-- Migration 039: Issue Sync Snapshots & Sync Runs
-- AFU-9 Issue Status Sync MVP (Polling-first)
-- 
-- Creates tables for:
-- 1. issue_snapshots: GitHub issue state snapshots (SOT for Issue Sync)
-- 2. issue_sync_runs: Ledger of sync operations for observability

-- ========================================
-- Issue Snapshots Table
-- ========================================

CREATE TABLE issue_snapshots (
  -- GitHub identifiers (composite key via unique constraint)
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  issue_number INTEGER NOT NULL,
  
  -- Canonical ID (e.g., E64.1, I751) if extractable from title/labels
  canonical_id VARCHAR(50),
  
  -- Core GitHub issue state
  state VARCHAR(20) NOT NULL CHECK (state IN ('open', 'closed')),
  title VARCHAR(500) NOT NULL,
  labels JSONB DEFAULT '[]'::jsonb,
  assignees JSONB DEFAULT '[]'::jsonb,
  
  -- GitHub timestamps (from GitHub API)
  updated_at TIMESTAMPTZ NOT NULL,
  
  -- GitHub node ID (stable identifier)
  gh_node_id VARCHAR(255),
  
  -- Evidence: raw GitHub issue payload (for debugging/audit)
  payload_json JSONB DEFAULT '{}'::jsonb,
  
  -- Sync tracking
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT uk_issue_snapshot_repo_issue UNIQUE (repo_owner, repo_name, issue_number)
);

-- ========================================
-- Indexes for Issue Snapshots
-- ========================================

-- Primary lookup by canonical_id (if available)
CREATE INDEX idx_issue_snapshots_canonical_id ON issue_snapshots(canonical_id) 
  WHERE canonical_id IS NOT NULL;

-- Lookup by update time (drift detection)
CREATE INDEX idx_issue_snapshots_updated_at ON issue_snapshots(updated_at DESC);

-- Lookup by synced time (staleness check)
CREATE INDEX idx_issue_snapshots_synced_at ON issue_snapshots(synced_at DESC);

-- Lookup by state
CREATE INDEX idx_issue_snapshots_state ON issue_snapshots(state);

-- Composite index for repo queries with ordering
CREATE INDEX idx_issue_snapshots_repo ON issue_snapshots(repo_owner, repo_name);
CREATE INDEX idx_issue_snapshots_repo_updated ON issue_snapshots(repo_owner, repo_name, updated_at DESC);

-- ========================================
-- Issue Sync Runs Table
-- ========================================

CREATE TABLE issue_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Sync execution metadata
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  
  -- Query used for sync (for reproducibility)
  query TEXT NOT NULL,
  
  -- Results
  total_count INTEGER DEFAULT 0,
  upserted_count INTEGER DEFAULT 0,
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED')),
  
  -- Error tracking
  error TEXT,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- Indexes for Issue Sync Runs
-- ========================================

-- Lookup by status
CREATE INDEX idx_issue_sync_runs_status ON issue_sync_runs(status);

-- Lookup by started_at (recent runs)
CREATE INDEX idx_issue_sync_runs_started_at ON issue_sync_runs(started_at DESC);

-- Lookup by finished_at (completed runs)
CREATE INDEX idx_issue_sync_runs_finished_at ON issue_sync_runs(finished_at DESC) 
  WHERE finished_at IS NOT NULL;

-- ========================================
-- Helper Function: Upsert Issue Snapshot
-- ========================================

-- Function to safely upsert issue snapshots (idempotent)
CREATE OR REPLACE FUNCTION upsert_issue_snapshot(
  p_repo_owner VARCHAR,
  p_repo_name VARCHAR,
  p_issue_number INTEGER,
  p_canonical_id VARCHAR,
  p_state VARCHAR,
  p_title VARCHAR,
  p_labels JSONB,
  p_assignees JSONB,
  p_updated_at TIMESTAMPTZ,
  p_gh_node_id VARCHAR,
  p_payload_json JSONB
) RETURNS void AS $$
BEGIN
  INSERT INTO issue_snapshots (
    repo_owner,
    repo_name,
    issue_number,
    canonical_id,
    state,
    title,
    labels,
    assignees,
    updated_at,
    gh_node_id,
    payload_json,
    synced_at
  ) VALUES (
    p_repo_owner,
    p_repo_name,
    p_issue_number,
    p_canonical_id,
    p_state,
    p_title,
    p_labels,
    p_assignees,
    p_updated_at,
    p_gh_node_id,
    p_payload_json,
    NOW()
  )
  ON CONFLICT (repo_owner, repo_name, issue_number) 
  DO UPDATE SET
    canonical_id = EXCLUDED.canonical_id,
    state = EXCLUDED.state,
    title = EXCLUDED.title,
    labels = EXCLUDED.labels,
    assignees = EXCLUDED.assignees,
    updated_at = EXCLUDED.updated_at,
    gh_node_id = EXCLUDED.gh_node_id,
    payload_json = EXCLUDED.payload_json,
    synced_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Views for Monitoring
-- ========================================

-- View: Sync Staleness Check
CREATE VIEW issue_sync_staleness AS
SELECT 
  MAX(synced_at) as last_synced_at,
  EXTRACT(EPOCH FROM (NOW() - MAX(synced_at))) / 3600 as staleness_hours,
  COUNT(*) as total_snapshots
FROM issue_snapshots;

-- View: Recent Sync Runs
CREATE VIEW issue_sync_recent_runs AS
SELECT 
  id,
  started_at,
  finished_at,
  status,
  total_count,
  upserted_count,
  EXTRACT(EPOCH FROM (finished_at - started_at)) as duration_seconds,
  error
FROM issue_sync_runs
ORDER BY started_at DESC
LIMIT 20;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE issue_snapshots IS 'AFU-9 Issue Sync: GitHub issue snapshots (SOT for polling-based sync)';
COMMENT ON TABLE issue_sync_runs IS 'AFU-9 Issue Sync: Ledger of all sync operations for observability';

COMMENT ON COLUMN issue_snapshots.canonical_id IS 'Extracted canonical ID (e.g., E64.1, I751) from title/labels if available';
COMMENT ON COLUMN issue_snapshots.state IS 'GitHub issue state (open|closed)';
COMMENT ON COLUMN issue_snapshots.updated_at IS 'GitHub updated_at timestamp (from API)';
COMMENT ON COLUMN issue_snapshots.synced_at IS 'Last time this snapshot was synced from GitHub';
COMMENT ON COLUMN issue_snapshots.payload_json IS 'Raw GitHub issue payload for debugging/audit';

COMMENT ON COLUMN issue_sync_runs.query IS 'GitHub search query used for this sync run';
COMMENT ON COLUMN issue_sync_runs.total_count IS 'Total issues found in GitHub';
COMMENT ON COLUMN issue_sync_runs.upserted_count IS 'Number of snapshots created/updated';

COMMENT ON VIEW issue_sync_staleness IS 'Check how stale the issue snapshots are';
COMMENT ON VIEW issue_sync_recent_runs IS 'Recent sync runs with duration and status';
