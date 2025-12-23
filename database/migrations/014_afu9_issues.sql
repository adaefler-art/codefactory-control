-- Migration 014: AFU9 Issues Domain Model + Persistence (MVP)
-- Creates canonical AFU9 issue tracking with handoff state management
-- Enforces single-active issue constraint

-- ========================================
-- AFU9 Issues Table
-- ========================================

CREATE TABLE afu9_issues (
  -- Primary identifier
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Core fields
  title VARCHAR(500) NOT NULL,
  body TEXT,
  
  -- Status and lifecycle
  status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
  labels TEXT[] DEFAULT '{}',
  priority VARCHAR(10),
  assignee VARCHAR(255),
  source VARCHAR(50) NOT NULL DEFAULT 'afu9',
  
  -- GitHub handoff state
  handoff_state VARCHAR(50) NOT NULL DEFAULT 'NOT_SENT',
  github_issue_number INTEGER,
  github_url VARCHAR(500),
  last_error TEXT,
  
  -- Audit timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_afu9_issue_status CHECK (status IN (
    'CREATED',
    'ACTIVE',
    'BLOCKED',
    'DONE'
  )),
  CONSTRAINT chk_afu9_issue_priority CHECK (priority IS NULL OR priority IN (
    'P0',
    'P1',
    'P2'
  )),
  CONSTRAINT chk_afu9_issue_handoff_state CHECK (handoff_state IN (
    'NOT_SENT',
    'SENT',
    'SYNCED',
    'FAILED'
  )),
  CONSTRAINT chk_afu9_issue_source CHECK (source = 'afu9')
);

-- ========================================
-- Indexes
-- ========================================

-- Performance indexes for common queries
CREATE INDEX idx_afu9_issues_status ON afu9_issues(status);
CREATE INDEX idx_afu9_issues_handoff_state ON afu9_issues(handoff_state);
CREATE INDEX idx_afu9_issues_github_issue_number ON afu9_issues(github_issue_number) WHERE github_issue_number IS NOT NULL;
CREATE INDEX idx_afu9_issues_created_at ON afu9_issues(created_at DESC);
CREATE INDEX idx_afu9_issues_updated_at ON afu9_issues(updated_at DESC);
CREATE INDEX idx_afu9_issues_priority ON afu9_issues(priority) WHERE priority IS NOT NULL;

-- ========================================
-- Single-Active Issue Enforcement
-- ========================================

-- Function to enforce only one ACTIVE issue at a time
CREATE OR REPLACE FUNCTION enforce_single_active_issue()
RETURNS TRIGGER AS $$
DECLARE
  active_count INTEGER;
BEGIN
  -- Only check if the new/updated status is ACTIVE
  IF NEW.status = 'ACTIVE' THEN
    -- Count other ACTIVE issues (excluding this one)
    SELECT COUNT(*) INTO active_count
    FROM afu9_issues
    WHERE status = 'ACTIVE' 
      AND id != NEW.id;
    
    -- Raise error if another ACTIVE issue exists
    IF active_count > 0 THEN
      RAISE EXCEPTION 'Single-Active constraint violation: Only one issue can have status=ACTIVE. Found % other active issue(s). Current active issues: %',
        active_count,
        (SELECT array_agg(id::text || ':' || title) FROM afu9_issues WHERE status = 'ACTIVE' AND id != NEW.id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce single-active on INSERT and UPDATE
CREATE TRIGGER trg_enforce_single_active_issue
  BEFORE INSERT OR UPDATE OF status ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_active_issue();

-- ========================================
-- Audit/Event Log Support
-- ========================================

-- AFU9 Issues Event History Table
CREATE TABLE afu9_issue_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to issue
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- Event details
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB DEFAULT '{}',
  
  -- State changes
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  old_handoff_state VARCHAR(50),
  new_handoff_state VARCHAR(50),
  
  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255),
  
  -- Constraints
  CONSTRAINT chk_afu9_event_type CHECK (event_type IN (
    'CREATED',
    'STATUS_CHANGED',
    'HANDOFF_STATE_CHANGED',
    'FIELD_UPDATED',
    'GITHUB_SYNCED',
    'ERROR_OCCURRED'
  ))
);

-- Indexes for event history
CREATE INDEX idx_afu9_issue_events_issue_id ON afu9_issue_events(issue_id);
CREATE INDEX idx_afu9_issue_events_created_at ON afu9_issue_events(created_at DESC);
CREATE INDEX idx_afu9_issue_events_event_type ON afu9_issue_events(event_type);
CREATE INDEX idx_afu9_issue_events_issue_id_created_at ON afu9_issue_events(issue_id, created_at DESC);

-- Function to automatically log events
CREATE OR REPLACE FUNCTION log_afu9_issue_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT (creation)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO afu9_issue_events (
      issue_id,
      event_type,
      event_data,
      new_status,
      new_handoff_state
    ) VALUES (
      NEW.id,
      'CREATED',
      jsonb_build_object(
        'title', NEW.title,
        'priority', NEW.priority,
        'assignee', NEW.assignee
      ),
      NEW.status,
      NEW.handoff_state
    );
    RETURN NEW;
  END IF;
  
  -- Handle UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- Log status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        event_type,
        old_status,
        new_status
      ) VALUES (
        NEW.id,
        'STATUS_CHANGED',
        OLD.status,
        NEW.status
      );
    END IF;
    
    -- Log handoff state changes
    IF OLD.handoff_state IS DISTINCT FROM NEW.handoff_state THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        event_type,
        old_handoff_state,
        new_handoff_state,
        event_data
      ) VALUES (
        NEW.id,
        'HANDOFF_STATE_CHANGED',
        OLD.handoff_state,
        NEW.handoff_state,
        jsonb_build_object(
          'github_issue_number', NEW.github_issue_number,
          'github_url', NEW.github_url,
          'last_error', NEW.last_error
        )
      );
    END IF;
    
    -- Log GitHub sync
    IF OLD.github_issue_number IS NULL AND NEW.github_issue_number IS NOT NULL THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        event_type,
        event_data
      ) VALUES (
        NEW.id,
        'GITHUB_SYNCED',
        jsonb_build_object(
          'github_issue_number', NEW.github_issue_number,
          'github_url', NEW.github_url
        )
      );
    END IF;
    
    -- Log errors
    IF OLD.last_error IS NULL AND NEW.last_error IS NOT NULL THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        event_type,
        event_data
      ) VALUES (
        NEW.id,
        'ERROR_OCCURRED',
        jsonb_build_object(
          'error', NEW.last_error,
          'handoff_state', NEW.handoff_state
        )
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically log events
CREATE TRIGGER trg_log_afu9_issue_event
  AFTER INSERT OR UPDATE ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION log_afu9_issue_event();

-- ========================================
-- Helper Function: Update Timestamp
-- ========================================

CREATE OR REPLACE FUNCTION update_afu9_issue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_afu9_issue_timestamp
  BEFORE UPDATE ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION update_afu9_issue_timestamp();

-- ========================================
-- Helpful Views
-- ========================================

-- View: Active and blocked issues
CREATE VIEW afu9_active_issues AS
SELECT 
  id,
  title,
  status,
  priority,
  assignee,
  handoff_state,
  github_issue_number,
  github_url,
  created_at,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 as hours_since_creation,
  EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 as hours_since_update
FROM afu9_issues
WHERE status IN ('CREATED', 'ACTIVE', 'BLOCKED')
ORDER BY 
  CASE status
    WHEN 'ACTIVE' THEN 1
    WHEN 'BLOCKED' THEN 2
    WHEN 'CREATED' THEN 3
  END,
  priority NULLS LAST,
  created_at ASC;

-- View: Issues pending GitHub handoff
CREATE VIEW afu9_pending_handoff AS
SELECT 
  id,
  title,
  status,
  handoff_state,
  last_error,
  created_at,
  updated_at
FROM afu9_issues
WHERE handoff_state IN ('NOT_SENT', 'FAILED')
  AND status != 'DONE'
ORDER BY 
  CASE handoff_state
    WHEN 'FAILED' THEN 1
    WHEN 'NOT_SENT' THEN 2
  END,
  created_at ASC;

-- View: Issue statistics
CREATE VIEW afu9_issue_stats AS
SELECT 
  status,
  COUNT(*) as count,
  COUNT(CASE WHEN handoff_state = 'SYNCED' THEN 1 END) as synced_to_github,
  COUNT(CASE WHEN handoff_state = 'FAILED' THEN 1 END) as failed_handoff,
  AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600) as avg_age_hours
FROM afu9_issues
GROUP BY status
ORDER BY 
  CASE status
    WHEN 'ACTIVE' THEN 1
    WHEN 'CREATED' THEN 2
    WHEN 'BLOCKED' THEN 3
    WHEN 'DONE' THEN 4
  END;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE afu9_issues IS 'AFU9 canonical issue domain model with GitHub handoff state management';
COMMENT ON TABLE afu9_issue_events IS 'Audit trail of all AFU9 issue lifecycle events';

COMMENT ON COLUMN afu9_issues.id IS 'Unique identifier (UUID)';
COMMENT ON COLUMN afu9_issues.title IS 'Issue title (required, max 500 chars)';
COMMENT ON COLUMN afu9_issues.body IS 'Issue body in markdown format (optional)';
COMMENT ON COLUMN afu9_issues.status IS 'Current status: CREATED, ACTIVE, BLOCKED, or DONE';
COMMENT ON COLUMN afu9_issues.labels IS 'Array of label strings';
COMMENT ON COLUMN afu9_issues.priority IS 'Priority level: P0 (highest), P1, or P2 (lowest)';
COMMENT ON COLUMN afu9_issues.assignee IS 'Assigned user or agent';
COMMENT ON COLUMN afu9_issues.source IS 'Source system (always afu9 for this table)';
COMMENT ON COLUMN afu9_issues.handoff_state IS 'GitHub handoff state: NOT_SENT, SENT, SYNCED, or FAILED';
COMMENT ON COLUMN afu9_issues.github_issue_number IS 'GitHub issue number after successful handoff';
COMMENT ON COLUMN afu9_issues.github_url IS 'Full GitHub issue URL';
COMMENT ON COLUMN afu9_issues.last_error IS 'Last error message from handoff or processing';

COMMENT ON VIEW afu9_active_issues IS 'All non-DONE issues with age metrics';
COMMENT ON VIEW afu9_pending_handoff IS 'Issues awaiting GitHub handoff or with failed handoff';
COMMENT ON VIEW afu9_issue_stats IS 'Aggregated statistics by status';

COMMENT ON CONSTRAINT chk_afu9_issue_status ON afu9_issues IS 'Enforces valid status values';
COMMENT ON CONSTRAINT chk_afu9_issue_priority ON afu9_issues IS 'Enforces valid priority values (P0, P1, P2)';
COMMENT ON CONSTRAINT chk_afu9_issue_handoff_state ON afu9_issues IS 'Enforces valid handoff state values';
COMMENT ON CONSTRAINT chk_afu9_issue_source ON afu9_issues IS 'Enforces source is always afu9';

COMMENT ON TRIGGER trg_enforce_single_active_issue ON afu9_issues IS 'Ensures only one issue can have status=ACTIVE at a time (Single-Issue-Mode)';
COMMENT ON TRIGGER trg_log_afu9_issue_event ON afu9_issues IS 'Automatically logs lifecycle events to afu9_issue_events table';
COMMENT ON TRIGGER trg_update_afu9_issue_timestamp ON afu9_issues IS 'Automatically updates updated_at timestamp on modifications';
