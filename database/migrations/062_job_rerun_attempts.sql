-- Migration 062: Job Rerun Attempts Tracking
-- 
-- Supports E84.3: Tool rerun_failed_jobs + bounded retry policy + audit
-- 
-- Creates append-only ledger for tracking job rerun attempts
-- Enables idempotent rerun logic with bounded retry limits

-- ========================================
-- Job Rerun Attempts Ledger (Append-Only)
-- ========================================

CREATE TABLE IF NOT EXISTS job_rerun_attempts (
  id SERIAL PRIMARY KEY,
  
  -- Idempotency key components
  resource_owner VARCHAR(255) NOT NULL,
  resource_repo VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  workflow_run_id BIGINT NOT NULL,
  job_name VARCHAR(500) NOT NULL,
  
  -- Rerun metadata
  attempt_number INTEGER NOT NULL,
  request_id VARCHAR(255) NOT NULL,
  
  -- Decision tracking
  decision VARCHAR(20) NOT NULL, -- 'RERUN_TRIGGERED', 'NOOP', 'BLOCKED'
  reason_code VARCHAR(100), -- e.g., 'flaky_probable', 'infra_transient', 'max_attempts_exceeded'
  reasons JSONB, -- Array of string reasons
  
  -- Failure classification
  prior_conclusion VARCHAR(50), -- 'failure', 'timed_out', etc.
  failure_class VARCHAR(50), -- 'flaky probable', 'infra transient', etc.
  
  -- Policy context
  lawbook_hash VARCHAR(255),
  max_attempts_limit INTEGER NOT NULL DEFAULT 2,
  
  -- GitHub API response
  github_response JSONB, -- Response from GitHub rerun API
  github_error TEXT, -- Error from GitHub if rerun failed
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for idempotency checks (find attempts for a specific job)
CREATE INDEX IF NOT EXISTS idx_job_rerun_attempts_idempotency 
  ON job_rerun_attempts(resource_owner, resource_repo, pr_number, workflow_run_id, job_name);

-- Index for PR-level queries (all rerun attempts for a PR)
CREATE INDEX IF NOT EXISTS idx_job_rerun_attempts_pr 
  ON job_rerun_attempts(resource_owner, resource_repo, pr_number, created_at DESC);

-- Index for audit queries
CREATE INDEX IF NOT EXISTS idx_job_rerun_attempts_request 
  ON job_rerun_attempts(request_id, created_at DESC);

-- Index for decision analytics
CREATE INDEX IF NOT EXISTS idx_job_rerun_attempts_decision 
  ON job_rerun_attempts(decision, created_at DESC);

-- ========================================
-- Helper Views
-- ========================================

-- View for current attempt counts per job
CREATE OR REPLACE VIEW job_rerun_attempt_counts AS
SELECT 
  resource_owner,
  resource_repo,
  pr_number,
  workflow_run_id,
  job_name,
  COUNT(*) AS total_attempts,
  MAX(attempt_number) AS max_attempt_number,
  MAX(created_at) AS last_attempt_at,
  ARRAY_AGG(decision ORDER BY created_at) AS decision_history
FROM job_rerun_attempts
GROUP BY resource_owner, resource_repo, pr_number, workflow_run_id, job_name;

-- View for recent rerun activity
CREATE OR REPLACE VIEW recent_job_reruns AS
SELECT 
  resource_owner || '/' || resource_repo AS repository,
  pr_number,
  workflow_run_id,
  job_name,
  attempt_number,
  decision,
  reason_code,
  request_id,
  created_at
FROM job_rerun_attempts
ORDER BY created_at DESC
LIMIT 100;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE job_rerun_attempts IS 
  'E84.3: Append-only ledger for job rerun attempts with bounded retry tracking';

COMMENT ON VIEW job_rerun_attempt_counts IS 
  'E84.3: Aggregated attempt counts for idempotency checks';

COMMENT ON VIEW recent_job_reruns IS 
  'E84.3: Recent job rerun activity for monitoring';
