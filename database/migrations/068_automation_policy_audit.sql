-- Migration 068: Automation Policy Audit Trail (E87.2)
-- 
-- Supports automation policy enforcement for:
-- - reruns (workflow/job reruns)
-- - merge gates (PR merge operations)
-- - prod operations (production deployments)
-- 
-- Implements fail-closed semantics with append-only audit trail
-- for cooldown enforcement, rate limiting, and idempotency.

-- ========================================
-- Automation Policy Executions Table
-- ========================================

CREATE TABLE IF NOT EXISTS automation_policy_executions (
  id SERIAL PRIMARY KEY,
  
  -- Request identification
  request_id VARCHAR(255) NOT NULL, -- Unique request ID from API
  session_id VARCHAR(255), -- Optional session ID for traceability
  
  -- Action details
  action_type VARCHAR(100) NOT NULL, -- 'rerun_checks', 'merge_pr', 'prod_deploy', etc.
  action_fingerprint VARCHAR(64) NOT NULL, -- SHA-256 hash of action+target+params (deterministic)
  
  -- Idempotency
  idempotency_key VARCHAR(255) NOT NULL, -- Computed from template + context (stable)
  idempotency_key_hash VARCHAR(64) NOT NULL, -- SHA-256 of idempotency key
  
  -- Target resource
  target_type VARCHAR(50) NOT NULL, -- 'pr', 'workflow', 'deployment', etc.
  target_identifier TEXT NOT NULL, -- e.g., 'owner/repo#123', 'workflow:12345'
  
  -- Policy decision
  decision VARCHAR(20) NOT NULL, -- 'allowed', 'denied'
  decision_reason TEXT NOT NULL, -- Human-readable reason for allow/deny
  next_allowed_at TIMESTAMPTZ, -- When action can be retried (for cooldown/rate limit denies)
  
  -- Policy context
  lawbook_version VARCHAR(50), -- Lawbook version at time of execution
  lawbook_hash VARCHAR(64), -- SHA-256 of lawbook content
  policy_name VARCHAR(100), -- Name of policy that was evaluated
  
  -- Enforcement details
  enforcement_data JSONB NOT NULL DEFAULT '{}', -- Cooldown, rate limits, approval status, etc.
  context_data JSONB NOT NULL DEFAULT '{}', -- Action-specific context (owner, repo, PR, etc.)
  
  -- Environment
  deployment_env VARCHAR(20), -- 'staging', 'prod', etc.
  
  -- Actor
  actor VARCHAR(255), -- User/system who initiated the action
  
  -- Timestamps (append-only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_automation_decision CHECK (decision IN ('allowed', 'denied'))
);

-- Indexes for efficient queries

-- Idempotency lookups
CREATE INDEX IF NOT EXISTS idx_automation_policy_idempotency_hash 
  ON automation_policy_executions(idempotency_key_hash, created_at DESC);

-- Action type queries
CREATE INDEX IF NOT EXISTS idx_automation_policy_action_type 
  ON automation_policy_executions(action_type, created_at DESC);

-- Target lookups (for per-resource rate limiting)
CREATE INDEX IF NOT EXISTS idx_automation_policy_target 
  ON automation_policy_executions(target_type, target_identifier, created_at DESC);

-- Request tracking
CREATE INDEX IF NOT EXISTS idx_automation_policy_request_id 
  ON automation_policy_executions(request_id);

-- Time-based queries for rate limiting
CREATE INDEX IF NOT EXISTS idx_automation_policy_created_at 
  ON automation_policy_executions(created_at DESC);

-- Decision analytics
CREATE INDEX IF NOT EXISTS idx_automation_policy_decision 
  ON automation_policy_executions(decision, action_type, created_at DESC);

-- Policy name analytics
CREATE INDEX IF NOT EXISTS idx_automation_policy_name 
  ON automation_policy_executions(policy_name, created_at DESC)
  WHERE policy_name IS NOT NULL;

-- Environment-specific queries
CREATE INDEX IF NOT EXISTS idx_automation_policy_env 
  ON automation_policy_executions(deployment_env, action_type, created_at DESC)
  WHERE deployment_env IS NOT NULL;

-- ========================================
-- Helper Views
-- ========================================

-- View for recent policy executions
CREATE OR REPLACE VIEW recent_automation_policy_executions AS
SELECT 
  id,
  action_type,
  decision,
  decision_reason,
  target_identifier,
  deployment_env,
  actor,
  next_allowed_at,
  created_at,
  request_id
FROM automation_policy_executions
ORDER BY created_at DESC
LIMIT 200;

-- View for denied actions (last 24 hours) - for monitoring cooldowns/rate limits
CREATE OR REPLACE VIEW denied_automation_actions_24h AS
SELECT 
  action_type,
  target_identifier,
  decision_reason,
  next_allowed_at,
  COUNT(*) AS deny_count,
  MAX(created_at) AS last_denied_at,
  MIN(created_at) AS first_denied_at
FROM automation_policy_executions
WHERE decision = 'denied'
  AND created_at >= NOW() - INTERVAL '24 hours'
GROUP BY action_type, target_identifier, decision_reason, next_allowed_at
ORDER BY deny_count DESC, last_denied_at DESC;

-- View for allowed actions by type (analytics)
CREATE OR REPLACE VIEW automation_action_analytics AS
SELECT 
  action_type,
  deployment_env,
  decision,
  COUNT(*) AS execution_count,
  MAX(created_at) AS last_execution_at
FROM automation_policy_executions
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY action_type, deployment_env, decision
ORDER BY execution_count DESC;

-- View for rate limit tracking (per action type in last hour)
CREATE OR REPLACE VIEW automation_rate_limit_1h AS
SELECT 
  action_type,
  target_identifier,
  COUNT(*) AS execution_count,
  COUNT(*) FILTER (WHERE decision = 'allowed') AS allowed_count,
  COUNT(*) FILTER (WHERE decision = 'denied') AS denied_count,
  MAX(created_at) AS last_execution_at
FROM automation_policy_executions
WHERE created_at >= NOW() - INTERVAL '1 hour'
GROUP BY action_type, target_identifier
ORDER BY execution_count DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE automation_policy_executions IS 
  'E87.2: Append-only audit trail for automation policy enforcement (cooldown/rate-limiting/idempotency/approval gates)';

COMMENT ON COLUMN automation_policy_executions.idempotency_key IS 
  'Stable key computed from policy template + context for deduplication and idempotent operations';

COMMENT ON COLUMN automation_policy_executions.action_fingerprint IS 
  'Deterministic SHA-256 hash of actionType+target+params for cross-reference with other audit tables';

COMMENT ON COLUMN automation_policy_executions.enforcement_data IS 
  'JSONB containing cooldownSeconds, maxRunsPerWindow, windowSeconds, requiresApproval status, etc.';

COMMENT ON COLUMN automation_policy_executions.next_allowed_at IS 
  'Timestamp when denied action can be retried (NULL if allowed or permanently blocked)';

COMMENT ON VIEW denied_automation_actions_24h IS 
  'E87.2: Denied automation actions in last 24h for monitoring backpressure and rate limiting';

COMMENT ON VIEW automation_rate_limit_1h IS 
  'E87.2: Rate limit tracking per action type in last hour for real-time monitoring';
