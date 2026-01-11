-- Migration 057: Workflow Action Audit Trail and GitHub Status Sync
-- 
-- Supports E84: Post-Publish Workflow Automation
-- 
-- Creates tables for:
-- 1. Workflow action audit log (all user actions on PRs/Issues)
-- 2. GitHub PR/Issue status cache (checks, CI, mergeability)

-- ========================================
-- Workflow Action Audit Log
-- ========================================

CREATE TABLE IF NOT EXISTS workflow_action_audit (
  id SERIAL PRIMARY KEY,
  
  -- Action metadata
  action_type VARCHAR(50) NOT NULL, -- 'open_pr', 'rerun_checks', 'merge_pr', 'assign_issue', etc.
  action_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  
  -- Target resource
  resource_type VARCHAR(20) NOT NULL, -- 'issue', 'pull_request'
  resource_owner VARCHAR(255) NOT NULL,
  resource_repo VARCHAR(255) NOT NULL,
  resource_number INTEGER NOT NULL,
  
  -- Context
  initiated_by VARCHAR(255), -- User or system that initiated action
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  
  -- Action details (JSON)
  action_params JSONB, -- Input parameters for the action
  action_result JSONB, -- Result or output from the action
  
  -- Error tracking
  error_message TEXT,
  error_details JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_workflow_action_audit_resource 
  ON workflow_action_audit(resource_type, resource_owner, resource_repo, resource_number);
CREATE INDEX IF NOT EXISTS idx_workflow_action_audit_status 
  ON workflow_action_audit(action_status, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_action_audit_type 
  ON workflow_action_audit(action_type, initiated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_action_audit_initiated_by 
  ON workflow_action_audit(initiated_by, initiated_at DESC);

-- ========================================
-- GitHub Status Sync Cache
-- ========================================

CREATE TABLE IF NOT EXISTS github_status_cache (
  id SERIAL PRIMARY KEY,
  
  -- Resource identifier
  resource_type VARCHAR(20) NOT NULL, -- 'issue', 'pull_request'
  owner VARCHAR(255) NOT NULL,
  repo VARCHAR(255) NOT NULL,
  number INTEGER NOT NULL,
  
  -- PR-specific fields
  pr_state VARCHAR(20), -- 'open', 'closed', 'merged'
  pr_mergeable BOOLEAN,
  pr_mergeable_state VARCHAR(50), -- 'clean', 'dirty', 'unstable', 'blocked', 'behind', 'draft'
  pr_draft BOOLEAN,
  pr_head_sha VARCHAR(40),
  pr_base_ref VARCHAR(255),
  pr_head_ref VARCHAR(255),
  
  -- Check suite status
  checks_status VARCHAR(20), -- 'pending', 'success', 'failure', 'error', null
  checks_total INTEGER DEFAULT 0,
  checks_passed INTEGER DEFAULT 0,
  checks_failed INTEGER DEFAULT 0,
  checks_pending INTEGER DEFAULT 0,
  
  -- CI/CD status (from status API)
  ci_status VARCHAR(20), -- 'pending', 'success', 'failure', 'error', null
  ci_contexts JSONB, -- Array of status contexts with state
  
  -- Review status
  review_decision VARCHAR(20), -- 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', null
  reviews_total INTEGER DEFAULT 0,
  reviews_approved INTEGER DEFAULT 0,
  reviews_changes_requested INTEGER DEFAULT 0,
  
  -- Sync metadata
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_error TEXT,
  
  -- GitHub API rate limit info
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint on resource
  CONSTRAINT github_status_cache_unique 
    UNIQUE (resource_type, owner, repo, number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_github_status_cache_resource 
  ON github_status_cache(resource_type, owner, repo, number);
CREATE INDEX IF NOT EXISTS idx_github_status_cache_pr_mergeable 
  ON github_status_cache(pr_mergeable, checks_status, ci_status) 
  WHERE resource_type = 'pull_request';
CREATE INDEX IF NOT EXISTS idx_github_status_cache_last_synced 
  ON github_status_cache(last_synced_at DESC);

-- ========================================
-- Functions for automatic timestamp updates
-- ========================================

CREATE OR REPLACE FUNCTION update_workflow_action_audit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_action_audit_update_timestamp
  BEFORE UPDATE ON workflow_action_audit
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_action_audit_timestamp();

CREATE OR REPLACE FUNCTION update_github_status_cache_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER github_status_cache_update_timestamp
  BEFORE UPDATE ON github_status_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_github_status_cache_timestamp();

-- ========================================
-- Helper views
-- ========================================

-- View for recent workflow actions
CREATE OR REPLACE VIEW recent_workflow_actions AS
SELECT 
  id,
  action_type,
  action_status,
  resource_type,
  resource_owner || '/' || resource_repo AS repository,
  resource_number,
  initiated_by,
  initiated_at,
  completed_at,
  error_message
FROM workflow_action_audit
ORDER BY initiated_at DESC
LIMIT 100;

-- View for mergeable PRs with green checks
CREATE OR REPLACE VIEW mergeable_prs AS
SELECT 
  owner || '/' || repo AS repository,
  number,
  pr_state,
  pr_mergeable,
  pr_mergeable_state,
  checks_status,
  ci_status,
  review_decision,
  last_synced_at
FROM github_status_cache
WHERE resource_type = 'pull_request'
  AND pr_state = 'open'
  AND pr_mergeable = true
  AND pr_draft = false
  AND COALESCE(checks_status, 'success') = 'success'
  AND COALESCE(ci_status, 'success') = 'success'
ORDER BY last_synced_at DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE workflow_action_audit IS 
  'E84: Audit log for all workflow actions (open PR, merge, rerun checks, etc.)';

COMMENT ON TABLE github_status_cache IS 
  'E84: Cached GitHub PR/Issue status for workflow automation UI';

COMMENT ON VIEW mergeable_prs IS 
  'E84: PRs ready to merge (green checks, approved, mergeable)';
