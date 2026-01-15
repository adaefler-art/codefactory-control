-- Migration 069: Unified Timeline Events (E87.3)
-- 
-- Creates a unified timeline_events table that consolidates all audit-worthy actions:
-- - Approvals (E87.1 approval_gates)
-- - Automation policy decisions (E87.2)
-- - Merge gate / PR actions
-- - Rerun job actions  
-- - Issue publish audit (E82.3)
-- 
-- Design:
-- - Append-only (no updates/deletes)
-- - Strict schema with bounded sizes
-- - Filterable by sessionId, canonicalId, ghIssueNumber, prNumber
-- - Deterministic summary formatting
-- - Backlinks between AFU-9 and GitHub

-- ========================================
-- Unified Timeline Events Table
-- ========================================

CREATE TABLE IF NOT EXISTS unified_timeline_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event type (explicit enum for strict validation)
  event_type VARCHAR(100) NOT NULL CHECK (event_type IN (
    'approval_submitted',
    'approval_approved',
    'approval_denied',
    'approval_cancelled',
    'automation_policy_allowed',
    'automation_policy_denied',
    'pr_opened',
    'pr_merged',
    'pr_closed',
    'checks_rerun',
    'workflow_dispatched',
    'issue_published',
    'issue_updated',
    'deploy_executed',
    'rollback_executed'
  )),
  
  -- Timestamp
  timestamp TIMESTAMPTZ NOT NULL,
  
  -- Actor (session/user/system)
  actor VARCHAR(255) NOT NULL,
  
  -- Subject references (for filtering)
  session_id VARCHAR(255), -- AFU-9 session ID (e.g., 19eacd15-4925-4b53-90b8-99751843e19f)
  canonical_id VARCHAR(255), -- AFU-9 canonical ID (e.g., CR-2026-01-02-001)
  gh_issue_number INTEGER, -- GitHub issue number
  pr_number INTEGER, -- GitHub PR number
  workflow_run_id BIGINT, -- GitHub workflow run ID
  
  -- Target resource
  subject_type VARCHAR(50) NOT NULL, -- 'afu9_issue', 'gh_issue', 'pr', 'workflow_run', 'deployment'
  subject_identifier TEXT NOT NULL, -- e.g., 'owner/repo#123', 'sessionId:xyz'
  
  -- Request tracking
  request_id VARCHAR(255) NOT NULL,
  
  -- Evidence hashes
  lawbook_hash VARCHAR(64), -- SHA-256 of lawbook content
  evidence_hash VARCHAR(64), -- SHA-256 of evidence/context
  context_pack_id UUID, -- Reference to intent_context_packs if applicable
  
  -- Links (URLs, IDs)
  links JSONB NOT NULL DEFAULT '{}', -- { afu9Url, ghUrl, prUrl, workflowUrl, etc. }
  
  -- Summary (deterministic, bounded)
  summary TEXT NOT NULL CHECK (LENGTH(summary) <= 500), -- Short human-readable summary
  details JSONB NOT NULL DEFAULT '{}' CHECK (pg_column_size(details) <= 16384), -- Bounded to ~16KB
  
  -- Timestamps (append-only)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- Indexes for Efficient Queries
-- ========================================

-- Primary query: by subject identifiers (most common filters)
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_session_id
  ON unified_timeline_events(session_id, timestamp DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_canonical_id
  ON unified_timeline_events(canonical_id, timestamp DESC)
  WHERE canonical_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_gh_issue
  ON unified_timeline_events(gh_issue_number, timestamp DESC)
  WHERE gh_issue_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_pr
  ON unified_timeline_events(pr_number, timestamp DESC)
  WHERE pr_number IS NOT NULL;

-- Query by event type
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_event_type
  ON unified_timeline_events(event_type, timestamp DESC);

-- Query by actor
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_actor
  ON unified_timeline_events(actor, timestamp DESC);

-- Query by request ID (for deduplication/correlation)
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_request_id
  ON unified_timeline_events(request_id, timestamp DESC);

-- Global timeline (all events sorted by time)
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_timestamp
  ON unified_timeline_events(timestamp DESC);

-- Query by subject type
CREATE INDEX IF NOT EXISTS idx_unified_timeline_events_subject_type
  ON unified_timeline_events(subject_type, timestamp DESC);

-- ========================================
-- Helper Views
-- ========================================

-- Recent events (last 100)
CREATE OR REPLACE VIEW recent_timeline_events AS
SELECT 
  id,
  event_type,
  timestamp,
  actor,
  subject_type,
  subject_identifier,
  summary,
  session_id,
  canonical_id,
  gh_issue_number,
  pr_number
FROM unified_timeline_events
ORDER BY timestamp DESC
LIMIT 100;

-- Events with backlinks (AFU-9 ↔ GitHub)
CREATE OR REPLACE VIEW timeline_events_with_backlinks AS
SELECT 
  id,
  event_type,
  timestamp,
  actor,
  summary,
  session_id,
  canonical_id,
  gh_issue_number,
  pr_number,
  links,
  CASE 
    WHEN session_id IS NOT NULL AND gh_issue_number IS NOT NULL THEN TRUE
    ELSE FALSE
  END AS has_bidirectional_link
FROM unified_timeline_events
WHERE session_id IS NOT NULL OR gh_issue_number IS NOT NULL
ORDER BY timestamp DESC;

-- Approval events (from E87.1)
CREATE OR REPLACE VIEW timeline_approval_events AS
SELECT 
  id,
  event_type,
  timestamp,
  actor,
  summary,
  details,
  request_id
FROM unified_timeline_events
WHERE event_type LIKE 'approval_%'
ORDER BY timestamp DESC;

-- Policy decision events (from E87.2)
CREATE OR REPLACE VIEW timeline_policy_events AS
SELECT 
  id,
  event_type,
  timestamp,
  actor,
  summary,
  details,
  request_id
FROM unified_timeline_events
WHERE event_type LIKE 'automation_policy_%'
ORDER BY timestamp DESC;

-- ========================================
-- Comments for Documentation
-- ========================================

COMMENT ON TABLE unified_timeline_events IS 
  'E87.3: Unified append-only timeline for all audit-worthy actions (approvals, policy decisions, PR actions, issue publishes, reruns)';

COMMENT ON COLUMN unified_timeline_events.event_type IS 
  'Explicit enum of allowed event types - fail-closed, no arbitrary strings';

COMMENT ON COLUMN unified_timeline_events.actor IS 
  'Who triggered the action: user ID (from x-afu9-sub), session ID, or "system"';

COMMENT ON COLUMN unified_timeline_events.summary IS 
  'Deterministic short summary (max 500 chars) - stable formatting for consistent display';

COMMENT ON COLUMN unified_timeline_events.details IS 
  'Bounded JSONB payload (max ~16KB) - no secrets, sanitized data only';

COMMENT ON COLUMN unified_timeline_events.links IS 
  'Backlinks between AFU-9 and GitHub (URLs, IDs) for navigation';

COMMENT ON COLUMN unified_timeline_events.lawbook_hash IS 
  'SHA-256 hash of lawbook at time of action (for policy versioning)';

COMMENT ON COLUMN unified_timeline_events.evidence_hash IS 
  'SHA-256 hash of evidence/context for verification';

COMMENT ON CONSTRAINT unified_timeline_events_summary_check ON unified_timeline_events IS 
  'Bounded summary length to prevent abuse and ensure consistent display';

COMMENT ON CONSTRAINT unified_timeline_events_details_check ON unified_timeline_events IS 
  'Bounded details size (~16KB) to prevent abuse and maintain query performance';
