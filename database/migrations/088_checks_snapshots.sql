-- E9.3-CTRL-02: Checks Mirror (PR/Commit Checks Snapshot)
-- 
-- Creates infrastructure for deterministic, stable view of GitHub check status
-- for PR/commit refs. Used by S4 (Review Gate) and S5 (Merge Gate) for
-- fail-closed decision making.
--
-- Migration: 088
-- Date: 2026-02-04
-- Epic: E9.3

-- ========================================
-- Checks Snapshots Table
-- ========================================

CREATE TABLE IF NOT EXISTS checks_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Linkage
  run_id VARCHAR(255) NULL,                    -- Optional loop run ID
  issue_id UUID NULL,                          -- Optional AFU-9 issue ID
  
  -- Repository and ref information
  repo_owner VARCHAR(255) NOT NULL,
  repo_name VARCHAR(255) NOT NULL,
  ref VARCHAR(500) NOT NULL,                   -- Commit SHA or PR ref (e.g., 'refs/pull/123/head')
  
  -- Snapshot metadata
  captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Check data (JSONB array)
  -- Each entry contains: { name, status, conclusion, details_url, run_id, job_id, step_name }
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Summary metadata
  total_checks INTEGER NOT NULL DEFAULT 0,
  failed_checks INTEGER NOT NULL DEFAULT 0,
  pending_checks INTEGER NOT NULL DEFAULT 0,
  
  -- Idempotency and audit
  snapshot_hash VARCHAR(64) NOT NULL,          -- SHA-256 hash of (repo_owner + repo_name + ref + checks data)
  request_id VARCHAR(255) NULL,                -- Optional request ID for tracing
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_repo_owner_not_empty CHECK (LENGTH(repo_owner) > 0),
  CONSTRAINT chk_repo_name_not_empty CHECK (LENGTH(repo_name) > 0),
  CONSTRAINT chk_ref_not_empty CHECK (LENGTH(ref) > 0),
  CONSTRAINT chk_total_checks_non_negative CHECK (total_checks >= 0),
  CONSTRAINT chk_failed_checks_non_negative CHECK (failed_checks >= 0),
  CONSTRAINT chk_pending_checks_non_negative CHECK (pending_checks >= 0)
);

-- ========================================
-- Indexes
-- ========================================

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_run_id ON checks_snapshots(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_issue_id ON checks_snapshots(issue_id) WHERE issue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_ref ON checks_snapshots(repo_owner, repo_name, ref);
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_snapshot_hash ON checks_snapshots(snapshot_hash);

-- Temporal queries
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_captured_at ON checks_snapshots(captured_at DESC);

-- Composite index for latest snapshot query
CREATE INDEX IF NOT EXISTS idx_checks_snapshots_ref_captured 
  ON checks_snapshots(repo_owner, repo_name, ref, captured_at DESC);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE checks_snapshots IS 'E9.3-CTRL-02: Persistent snapshots of GitHub PR/commit check status for deterministic gate decisions';
COMMENT ON COLUMN checks_snapshots.ref IS 'Commit SHA or PR ref (e.g., refs/pull/123/head)';
COMMENT ON COLUMN checks_snapshots.checks IS 'JSONB array of check run details: [{ name, status, conclusion, details_url, run_id?, job_id?, step_name? }]';
COMMENT ON COLUMN checks_snapshots.snapshot_hash IS 'SHA-256 hash for idempotency: hash(repo_owner + repo_name + ref + normalized checks)';
COMMENT ON COLUMN checks_snapshots.total_checks IS 'Total number of checks in snapshot';
COMMENT ON COLUMN checks_snapshots.failed_checks IS 'Number of checks with non-success conclusion';
COMMENT ON COLUMN checks_snapshots.pending_checks IS 'Number of checks not yet completed';
