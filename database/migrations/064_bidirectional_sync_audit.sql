-- Migration 064: Bi-directional Sync Audit & Conflict Detection
-- E85.2: AFU-9 ↔ GitHub Bi-directional Sync
--
-- Creates tables for:
-- 1. sync_audit_events: Audit trail of all sync operations (AFU-9 → GitHub and GitHub → AFU-9)
-- 2. sync_conflicts: Tracks detected sync conflicts that need manual resolution
--
-- Implements:
-- - Event hashing for idempotent event processing
-- - Deterministic sync audit trail
-- - Conflict detection and marking
-- - Evidence-based state transitions tracking

-- ========================================
-- Sync Audit Events Table
-- ========================================

CREATE TABLE sync_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event identification
  event_hash VARCHAR(64) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
    'AFU9_TO_GITHUB_LABEL',
    'AFU9_TO_GITHUB_STATUS_COMMENT',
    'AFU9_TO_GITHUB_ISSUE_CLOSE',
    'GITHUB_TO_AFU9_PR_STATUS',
    'GITHUB_TO_AFU9_REVIEW',
    'GITHUB_TO_AFU9_CHECKS',
    'GITHUB_TO_AFU9_LABEL',
    'GITHUB_TO_AFU9_ISSUE_STATE',
    'SYNC_CONFLICT_DETECTED',
    'SYNC_TRANSITION_BLOCKED'
  )),
  
  -- Issue reference
  issue_id UUID REFERENCES afu9_issues(id) ON DELETE SET NULL,
  github_owner VARCHAR(255),
  github_repo VARCHAR(255),
  github_issue_number INTEGER,
  
  -- Sync direction
  sync_direction VARCHAR(20) NOT NULL CHECK (sync_direction IN ('AFU9_TO_GITHUB', 'GITHUB_TO_AFU9', 'CONFLICT')),
  
  -- State transition details (if applicable)
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  transition_allowed BOOLEAN,
  transition_blocked_reason TEXT,
  
  -- Evidence (from GitHub or AFU-9)
  evidence_type VARCHAR(50),
  evidence_payload JSONB DEFAULT '{}'::jsonb,
  
  -- GitHub data snapshot
  github_pr_state VARCHAR(20),
  github_pr_merged BOOLEAN,
  github_checks_status VARCHAR(20),
  github_review_status VARCHAR(20),
  github_labels JSONB DEFAULT '[]'::jsonb,
  
  -- Dry-run mode
  dry_run BOOLEAN DEFAULT FALSE,
  
  -- Conflict detection
  conflict_detected BOOLEAN DEFAULT FALSE,
  conflict_reason TEXT,
  
  -- Metadata
  sync_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(255)
);

-- ========================================
-- Indexes for Sync Audit Events
-- ========================================

-- Primary lookup by event hash (deduplication)
CREATE UNIQUE INDEX idx_sync_audit_events_event_hash ON sync_audit_events(event_hash);

-- Lookup by issue
CREATE INDEX idx_sync_audit_events_issue_id ON sync_audit_events(issue_id) 
  WHERE issue_id IS NOT NULL;

-- Lookup by GitHub issue
CREATE INDEX idx_sync_audit_events_github_issue ON sync_audit_events(github_owner, github_repo, github_issue_number)
  WHERE github_issue_number IS NOT NULL;

-- Lookup by sync direction
CREATE INDEX idx_sync_audit_events_sync_direction ON sync_audit_events(sync_direction);

-- Lookup by event type
CREATE INDEX idx_sync_audit_events_event_type ON sync_audit_events(event_type);

-- Lookup by created_at (recent events)
CREATE INDEX idx_sync_audit_events_created_at ON sync_audit_events(created_at DESC);

-- Lookup conflicts
CREATE INDEX idx_sync_audit_events_conflicts ON sync_audit_events(conflict_detected) 
  WHERE conflict_detected = TRUE;

-- Lookup by sync run
CREATE INDEX idx_sync_audit_events_sync_run_id ON sync_audit_events(sync_run_id)
  WHERE sync_run_id IS NOT NULL;

-- ========================================
-- Sync Conflicts Table
-- ========================================

CREATE TABLE sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Issue reference
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  github_issue_number INTEGER NOT NULL,
  
  -- Conflict details
  conflict_type VARCHAR(50) NOT NULL CHECK (conflict_type IN (
    'STATE_DIVERGENCE',
    'MANUAL_OVERRIDE_BLOCKED',
    'TRANSITION_NOT_ALLOWED',
    'EVIDENCE_MISSING',
    'PRECONDITION_FAILED',
    'CONCURRENT_MODIFICATION'
  )),
  
  -- State information
  afu9_status VARCHAR(50) NOT NULL,
  github_status_raw VARCHAR(100),
  github_pr_state VARCHAR(20),
  
  -- Conflict description
  description TEXT NOT NULL,
  resolution_required BOOLEAN DEFAULT TRUE,
  
  -- Resolution
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(255),
  resolution_action VARCHAR(50),
  resolution_notes TEXT,
  
  -- Metadata
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  audit_event_id UUID REFERENCES sync_audit_events(id) ON DELETE SET NULL,
  
  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ========================================
-- Indexes for Sync Conflicts
-- ========================================

-- Lookup by issue
CREATE INDEX idx_sync_conflicts_issue_id ON sync_conflicts(issue_id);

-- Lookup by GitHub issue
CREATE INDEX idx_sync_conflicts_github_issue ON sync_conflicts(github_owner, github_repo, github_issue_number);

-- Lookup unresolved conflicts
CREATE INDEX idx_sync_conflicts_unresolved ON sync_conflicts(resolved, detected_at DESC)
  WHERE resolved = FALSE;

-- Lookup by conflict type
CREATE INDEX idx_sync_conflicts_type ON sync_conflicts(conflict_type);

-- Lookup by detected_at
CREATE INDEX idx_sync_conflicts_detected_at ON sync_conflicts(detected_at DESC);

-- ========================================
-- Helper Function: Generate Event Hash
-- ========================================

-- Function to generate deterministic event hash for idempotency
-- Hash is based on: event_type, issue_id, github_issue, timestamp bucket (5min), payload
CREATE OR REPLACE FUNCTION generate_sync_event_hash(
  p_event_type VARCHAR,
  p_issue_id UUID,
  p_github_owner VARCHAR,
  p_github_repo VARCHAR,
  p_github_issue_number INTEGER,
  p_evidence_payload JSONB,
  p_timestamp TIMESTAMPTZ
) RETURNS VARCHAR AS $$
DECLARE
  timestamp_bucket TIMESTAMPTZ;
  hash_input TEXT;
BEGIN
  -- Bucket timestamp to 5-minute intervals for idempotency window
  timestamp_bucket := date_trunc('minute', p_timestamp) + 
    INTERVAL '5 minutes' * (EXTRACT(MINUTE FROM p_timestamp)::INTEGER / 5);
  
  -- Build hash input
  hash_input := concat_ws('|',
    p_event_type,
    COALESCE(p_issue_id::text, ''),
    COALESCE(p_github_owner, ''),
    COALESCE(p_github_repo, ''),
    COALESCE(p_github_issue_number::text, ''),
    COALESCE(p_evidence_payload::text, '{}'),
    timestamp_bucket::text
  );
  
  -- Return SHA-256 hash
  RETURN encode(digest(hash_input, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ========================================
-- Helper Function: Record Sync Event (Idempotent)
-- ========================================

CREATE OR REPLACE FUNCTION record_sync_event(
  p_event_type VARCHAR,
  p_issue_id UUID,
  p_github_owner VARCHAR,
  p_github_repo VARCHAR,
  p_github_issue_number INTEGER,
  p_sync_direction VARCHAR,
  p_old_status VARCHAR,
  p_new_status VARCHAR,
  p_transition_allowed BOOLEAN,
  p_transition_blocked_reason TEXT,
  p_evidence_type VARCHAR,
  p_evidence_payload JSONB,
  p_github_pr_state VARCHAR,
  p_github_pr_merged BOOLEAN,
  p_github_checks_status VARCHAR,
  p_github_review_status VARCHAR,
  p_github_labels JSONB,
  p_dry_run BOOLEAN,
  p_conflict_detected BOOLEAN,
  p_conflict_reason TEXT,
  p_sync_run_id UUID,
  p_created_by VARCHAR
) RETURNS UUID AS $$
DECLARE
  v_event_hash VARCHAR;
  v_event_id UUID;
BEGIN
  -- Generate event hash
  v_event_hash := generate_sync_event_hash(
    p_event_type,
    p_issue_id,
    p_github_owner,
    p_github_repo,
    p_github_issue_number,
    p_evidence_payload,
    NOW()
  );
  
  -- Insert event (idempotent - ON CONFLICT DO NOTHING)
  INSERT INTO sync_audit_events (
    event_hash,
    event_type,
    issue_id,
    github_owner,
    github_repo,
    github_issue_number,
    sync_direction,
    old_status,
    new_status,
    transition_allowed,
    transition_blocked_reason,
    evidence_type,
    evidence_payload,
    github_pr_state,
    github_pr_merged,
    github_checks_status,
    github_review_status,
    github_labels,
    dry_run,
    conflict_detected,
    conflict_reason,
    sync_run_id,
    created_by
  ) VALUES (
    v_event_hash,
    p_event_type,
    p_issue_id,
    p_github_owner,
    p_github_repo,
    p_github_issue_number,
    p_sync_direction,
    p_old_status,
    p_new_status,
    p_transition_allowed,
    p_transition_blocked_reason,
    p_evidence_type,
    p_evidence_payload,
    p_github_pr_state,
    p_github_pr_merged,
    p_github_checks_status,
    p_github_review_status,
    p_github_labels,
    p_dry_run,
    p_conflict_detected,
    p_conflict_reason,
    p_sync_run_id,
    p_created_by
  )
  ON CONFLICT (event_hash) DO NOTHING
  RETURNING id INTO v_event_id;
  
  -- Return event ID (NULL if duplicate)
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Trigger: Update sync_conflicts timestamp
-- ========================================

CREATE OR REPLACE FUNCTION update_sync_conflict_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_sync_conflict_timestamp
  BEFORE UPDATE ON sync_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION update_sync_conflict_timestamp();

-- ========================================
-- Views for Monitoring
-- ========================================

-- View: Recent Sync Events
CREATE VIEW sync_audit_recent_events AS
SELECT 
  id,
  event_type,
  sync_direction,
  issue_id,
  github_owner,
  github_repo,
  github_issue_number,
  old_status,
  new_status,
  transition_allowed,
  conflict_detected,
  dry_run,
  created_at
FROM sync_audit_events
ORDER BY created_at DESC
LIMIT 100;

-- View: Unresolved Conflicts
CREATE VIEW sync_conflicts_unresolved AS
SELECT 
  c.id,
  c.issue_id,
  i.title as issue_title,
  c.github_owner,
  c.github_repo,
  c.github_issue_number,
  c.conflict_type,
  c.afu9_status,
  c.github_status_raw,
  c.description,
  c.detected_at,
  EXTRACT(EPOCH FROM (NOW() - c.detected_at)) / 3600 as hours_since_detection
FROM sync_conflicts c
LEFT JOIN afu9_issues i ON c.issue_id = i.id
WHERE c.resolved = FALSE
ORDER BY c.detected_at DESC;

-- View: Sync Event Statistics
CREATE VIEW sync_event_stats AS
SELECT 
  sync_direction,
  event_type,
  COUNT(*) as event_count,
  COUNT(CASE WHEN conflict_detected THEN 1 END) as conflicts_count,
  COUNT(CASE WHEN dry_run THEN 1 END) as dry_run_count,
  COUNT(CASE WHEN transition_allowed = FALSE THEN 1 END) as blocked_transitions_count,
  MAX(created_at) as last_event_at
FROM sync_audit_events
GROUP BY sync_direction, event_type
ORDER BY sync_direction, event_type;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE sync_audit_events IS 'E85.2: Audit trail of all bi-directional sync operations between AFU-9 and GitHub';
COMMENT ON TABLE sync_conflicts IS 'E85.2: Detected sync conflicts requiring manual resolution';

COMMENT ON COLUMN sync_audit_events.event_hash IS 'SHA-256 hash for idempotent event processing (5-minute bucket)';
COMMENT ON COLUMN sync_audit_events.sync_direction IS 'Direction of sync: AFU9_TO_GITHUB, GITHUB_TO_AFU9, or CONFLICT';
COMMENT ON COLUMN sync_audit_events.transition_allowed IS 'Whether the state transition was allowed by state machine spec';
COMMENT ON COLUMN sync_audit_events.evidence_payload IS 'Evidence data (PR merge commit, CI status, review approval, etc.)';
COMMENT ON COLUMN sync_audit_events.dry_run IS 'Whether this was a dry-run sync (no actual changes made)';
COMMENT ON COLUMN sync_audit_events.conflict_detected IS 'Whether a sync conflict was detected';

COMMENT ON COLUMN sync_conflicts.conflict_type IS 'Type of conflict: STATE_DIVERGENCE, MANUAL_OVERRIDE_BLOCKED, etc.';
COMMENT ON COLUMN sync_conflicts.resolution_required IS 'Whether manual resolution is required';
COMMENT ON COLUMN sync_conflicts.resolved IS 'Whether the conflict has been resolved';

COMMENT ON VIEW sync_audit_recent_events IS 'Recent sync events for monitoring dashboard';
COMMENT ON VIEW sync_conflicts_unresolved IS 'All unresolved sync conflicts with age';
COMMENT ON VIEW sync_event_stats IS 'Aggregated sync event statistics by direction and type';
