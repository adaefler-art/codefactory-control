-- Migration 063: Stop Decision Audit Trail
-- 
-- Supports E84.4: Stop Conditions + HOLD Rules
-- 
-- Creates append-only ledger for tracking stop decisions
-- in automated workflow reruns to prevent infinite loops

-- ========================================
-- Stop Decision Audit Ledger (Append-Only)
-- ========================================

CREATE TABLE IF NOT EXISTS stop_decision_audit (
  id SERIAL PRIMARY KEY,
  
  -- Resource identifier
  resource_owner VARCHAR(255) NOT NULL,
  resource_repo VARCHAR(255) NOT NULL,
  pr_number INTEGER NOT NULL,
  workflow_run_id BIGINT, -- GitHub workflow run ID (optional)
  
  -- Request tracking
  request_id VARCHAR(255) NOT NULL,
  
  -- Decision outcome
  decision VARCHAR(20) NOT NULL, -- 'CONTINUE', 'HOLD', 'KILL'
  reason_code VARCHAR(50), -- 'MAX_ATTEMPTS', 'TIMEOUT', 'NON_RETRIABLE', etc.
  reasons JSONB NOT NULL, -- Array of human-readable reasons
  recommended_next_step VARCHAR(50) NOT NULL, -- 'PROMPT', 'MANUAL_REVIEW', 'FIX_REQUIRED', 'WAIT'
  
  -- Failure context
  failure_class VARCHAR(100), -- 'flaky probable', 'infra transient', etc.
  current_job_attempts INTEGER NOT NULL DEFAULT 0,
  total_pr_attempts INTEGER NOT NULL DEFAULT 0,
  
  -- Lawbook context
  lawbook_hash VARCHAR(255) NOT NULL,
  lawbook_version VARCHAR(255),
  applied_rules JSONB NOT NULL, -- Array of rule names that were evaluated
  
  -- Evidence
  evidence JSONB, -- Additional context (thresholds, timing, etc.)
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for PR-level queries (all stop decisions for a PR)
CREATE INDEX IF NOT EXISTS idx_stop_decision_audit_pr 
  ON stop_decision_audit(resource_owner, resource_repo, pr_number, created_at DESC);

-- Index for request tracking
CREATE INDEX IF NOT EXISTS idx_stop_decision_audit_request 
  ON stop_decision_audit(request_id, created_at DESC);

-- Index for decision analytics
CREATE INDEX IF NOT EXISTS idx_stop_decision_audit_decision 
  ON stop_decision_audit(decision, created_at DESC);

-- Index for reason code analytics
CREATE INDEX IF NOT EXISTS idx_stop_decision_audit_reason 
  ON stop_decision_audit(reason_code, created_at DESC) 
  WHERE reason_code IS NOT NULL;

-- ========================================
-- Helper Views
-- ========================================

-- View for recent stop decisions
CREATE OR REPLACE VIEW recent_stop_decisions AS
SELECT 
  resource_owner || '/' || resource_repo AS repository,
  pr_number,
  workflow_run_id,
  decision,
  reason_code,
  recommended_next_step,
  current_job_attempts,
  total_pr_attempts,
  request_id,
  created_at
FROM stop_decision_audit
ORDER BY created_at DESC
LIMIT 100;

-- View for HOLD decisions requiring attention
CREATE OR REPLACE VIEW active_hold_decisions AS
SELECT 
  resource_owner || '/' || resource_repo AS repository,
  pr_number,
  workflow_run_id,
  reason_code,
  recommended_next_step,
  reasons,
  current_job_attempts,
  total_pr_attempts,
  created_at
FROM stop_decision_audit
WHERE decision = 'HOLD'
  AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- View for decision analytics
CREATE OR REPLACE VIEW stop_decision_analytics AS
SELECT 
  decision,
  reason_code,
  COUNT(*) AS decision_count,
  MAX(created_at) AS last_occurred_at
FROM stop_decision_audit
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY decision, reason_code
ORDER BY decision_count DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE stop_decision_audit IS 
  'E84.4: Append-only audit trail for stop decisions (CONTINUE/HOLD/KILL)';

COMMENT ON VIEW recent_stop_decisions IS 
  'E84.4: Recent stop decisions for monitoring';

COMMENT ON VIEW active_hold_decisions IS 
  'E84.4: Active HOLD decisions requiring attention (last 24h)';

COMMENT ON VIEW stop_decision_analytics IS 
  'E84.4: Decision analytics for the last 7 days';
