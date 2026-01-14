-- Migration 067: Approval Gates Framework (E87.1)
-- 
-- Supports explicit human approval for dangerous operations:
-- - merge (PR merge)
-- - prod operations (all against production env)
-- - destructive ops (delete/reset/force-migration/rollback)
-- 
-- Implements fail-closed semantics with append-only audit trail.

-- ========================================
-- Approval Gates Table
-- ========================================

CREATE TABLE IF NOT EXISTS approval_gates (
  id SERIAL PRIMARY KEY,
  
  -- Request identification
  request_id VARCHAR(255) NOT NULL, -- Unique request ID from API
  session_id VARCHAR(255), -- Optional session ID for traceability
  
  -- Action details
  action_type VARCHAR(50) NOT NULL, -- 'merge', 'prod_operation', 'destructive_operation'
  action_fingerprint VARCHAR(64) NOT NULL, -- SHA-256 hash of action+target+params (deterministic)
  
  -- Target resource
  target_type VARCHAR(50) NOT NULL, -- 'pr', 'env', 'database', etc.
  target_identifier TEXT NOT NULL, -- e.g., 'owner/repo#123', 'production', 'db:migration:xyz'
  
  -- Context capture
  lawbook_version VARCHAR(50), -- Lawbook version at time of approval
  lawbook_hash VARCHAR(64), -- SHA-256 of lawbook content
  context_pack_hash VARCHAR(64), -- SHA-256 of context/inputs
  context_summary JSONB, -- Human-readable summary of what will happen
  
  -- Approval decision
  decision VARCHAR(20) NOT NULL, -- 'approved', 'denied', 'cancelled'
  signed_phrase TEXT, -- Required phrase user must enter (e.g., "YES MERGE")
  signed_phrase_hash VARCHAR(64), -- SHA-256 of signed phrase (for verification)
  reason TEXT, -- Optional reason provided by user
  
  -- Actor
  actor VARCHAR(255) NOT NULL, -- User who made the decision (from x-afu9-sub)
  
  -- Timestamps (append-only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_approval_decision CHECK (decision IN ('approved', 'denied', 'cancelled')),
  CONSTRAINT chk_approval_action_type CHECK (action_type IN ('merge', 'prod_operation', 'destructive_operation'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_approval_gates_request_id 
  ON approval_gates(request_id);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action_fingerprint 
  ON approval_gates(action_fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_gates_actor 
  ON approval_gates(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_gates_action_type 
  ON approval_gates(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_gates_target 
  ON approval_gates(target_type, target_identifier);
CREATE INDEX IF NOT EXISTS idx_approval_gates_created_at 
  ON approval_gates(created_at DESC);

-- Unique index to prevent duplicate approvals for same action
CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_gates_unique_action 
  ON approval_gates(action_fingerprint, request_id);

-- ========================================
-- Helper Views
-- ========================================

-- View for recent approvals
CREATE OR REPLACE VIEW recent_approvals AS
SELECT 
  id,
  action_type,
  decision,
  target_identifier,
  actor,
  created_at,
  reason
FROM approval_gates
ORDER BY created_at DESC
LIMIT 100;

-- View for approved actions (last 24 hours)
CREATE OR REPLACE VIEW approved_actions_24h AS
SELECT 
  action_type,
  action_fingerprint,
  target_identifier,
  actor,
  created_at,
  signed_phrase_hash
FROM approval_gates
WHERE decision = 'approved'
  AND created_at >= NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE approval_gates IS 
  'E87.1: Append-only audit trail for explicit human approval of dangerous operations (merge/prod/destructive)';

COMMENT ON COLUMN approval_gates.action_fingerprint IS 
  'Deterministic SHA-256 hash of actionType+target+params for idempotency and deduplication';

COMMENT ON COLUMN approval_gates.signed_phrase IS 
  'Exact phrase user must type to confirm (e.g., "YES MERGE", "YES PROD", "YES DESTRUCTIVE")';

COMMENT ON COLUMN approval_gates.context_summary IS 
  'Human-readable JSON describing what will happen (repo/PR, env, checks status, diff summary, risk flags)';
