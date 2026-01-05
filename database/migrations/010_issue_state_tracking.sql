-- Migration 010: Issue State Tracking
-- Issue A1: Kanonische Issue-State-Machine definieren
-- Creates table to track canonical issue states through their lifecycle

-- ========================================
-- Issue Tracking Table
-- ========================================

CREATE TABLE issue_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- GitHub reference
  github_issue_number INTEGER NOT NULL,
  repository VARCHAR(255) NOT NULL,
  
  -- State tracking (canonical states)
  state VARCHAR(50) NOT NULL,
  previous_state VARCHAR(50),
  
  -- State change metadata
  state_changed_at TIMESTAMP DEFAULT NOW(),
  state_changed_by VARCHAR(255),
  state_change_reason TEXT,
  
  -- Additional metadata
  metadata JSONB DEFAULT '{}',
  
  -- Audit fields
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_issue_state CHECK (state IN (
    'CREATED',
    'SPEC_READY',
    'IMPLEMENTING',
    'VERIFIED',
    'MERGE_READY',
    'DONE',
    'HOLD',
    'KILLED'
  )),
  CONSTRAINT chk_previous_issue_state CHECK (previous_state IS NULL OR previous_state IN (
    'CREATED',
    'SPEC_READY',
    'IMPLEMENTING',
    'VERIFIED',
    'MERGE_READY',
    'DONE',
    'HOLD',
    'KILLED'
  )),
  -- Unique constraint: one active tracking record per issue
  CONSTRAINT uk_issue_tracking_repo_number UNIQUE (repository, github_issue_number)
);

-- Indexes for efficient queries
CREATE INDEX idx_issue_tracking_state ON issue_tracking(state);
CREATE INDEX idx_issue_tracking_repo_number ON issue_tracking(repository, github_issue_number);
CREATE INDEX idx_issue_tracking_state_changed_at ON issue_tracking(state_changed_at DESC);
CREATE INDEX idx_issue_tracking_repository ON issue_tracking(repository);

-- ========================================
-- Issue State History Table
-- ========================================
-- Track all state transitions for audit and analytics

CREATE TABLE issue_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to issue tracking
  issue_tracking_id UUID REFERENCES issue_tracking(id) ON DELETE CASCADE,
  
  -- State transition details
  from_state VARCHAR(50),
  to_state VARCHAR(50) NOT NULL,
  
  -- Transition metadata
  transition_at TIMESTAMP DEFAULT NOW(),
  transition_by VARCHAR(255),
  transition_reason TEXT,
  
  -- Context at time of transition
  context JSONB DEFAULT '{}',
  
  -- Audit fields
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_from_state CHECK (from_state IS NULL OR from_state IN (
    'CREATED',
    'SPEC_READY',
    'IMPLEMENTING',
    'VERIFIED',
    'MERGE_READY',
    'DONE',
    'HOLD',
    'KILLED'
  )),
  CONSTRAINT chk_to_state CHECK (to_state IN (
    'CREATED',
    'SPEC_READY',
    'IMPLEMENTING',
    'VERIFIED',
    'MERGE_READY',
    'DONE',
    'HOLD',
    'KILLED'
  ))
);

-- Indexes for history queries
CREATE INDEX idx_issue_state_history_tracking_id ON issue_state_history(issue_tracking_id);
CREATE INDEX idx_issue_state_history_transition_at ON issue_state_history(transition_at DESC);
CREATE INDEX idx_issue_state_history_to_state ON issue_state_history(to_state);
-- Performance index for transition analysis with window functions
CREATE INDEX idx_issue_state_history_tracking_id_transition_at ON issue_state_history(issue_tracking_id, transition_at);

-- ========================================
-- Helper Function: Record State Transition
-- ========================================
-- Automatically records state transitions in history table

CREATE OR REPLACE FUNCTION record_issue_state_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Record the state transition in history
  IF OLD.state IS DISTINCT FROM NEW.state THEN
    INSERT INTO issue_state_history (
      issue_tracking_id,
      from_state,
      to_state,
      transition_at,
      transition_by,
      transition_reason,
      context
    ) VALUES (
      NEW.id,
      OLD.state,
      NEW.state,
      NEW.state_changed_at,
      NEW.state_changed_by,
      NEW.state_change_reason,
      NEW.metadata
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically record state transitions
CREATE TRIGGER trg_record_issue_state_transition
  AFTER UPDATE OF state ON issue_tracking
  FOR EACH ROW
  EXECUTE FUNCTION record_issue_state_transition();

-- ========================================
-- Helper Function: Update Timestamp
-- ========================================

CREATE OR REPLACE FUNCTION update_issue_tracking_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_issue_tracking_timestamp
  BEFORE UPDATE ON issue_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_issue_tracking_timestamp();

-- ========================================
-- Views for Common Queries
-- ========================================

-- View: Active issues (not in terminal states)
CREATE VIEW active_issues AS
SELECT 
  it.*,
  (SELECT COUNT(*) FROM issue_state_history WHERE issue_tracking_id = it.id) as transition_count,
  EXTRACT(EPOCH FROM (NOW() - it.state_changed_at)) / 3600 as hours_in_current_state
FROM issue_tracking it
WHERE state NOT IN ('DONE', 'KILLED')
ORDER BY state_changed_at DESC;

-- View: Issues by state with metrics
CREATE VIEW issue_state_metrics AS
SELECT 
  state,
  COUNT(*) as issue_count,
  AVG(EXTRACT(EPOCH FROM (NOW() - state_changed_at)) / 3600) as avg_hours_in_state,
  MAX(state_changed_at) as most_recent_change,
  MIN(state_changed_at) as oldest_change
FROM issue_tracking
GROUP BY state
ORDER BY 
  CASE state
    WHEN 'CREATED' THEN 1
    WHEN 'SPEC_READY' THEN 2
    WHEN 'IMPLEMENTING' THEN 3
    WHEN 'VERIFIED' THEN 4
    WHEN 'MERGE_READY' THEN 5
    WHEN 'DONE' THEN 6
    WHEN 'HOLD' THEN 7
    WHEN 'KILLED' THEN 8
  END;

-- View: State transition flow analysis
CREATE VIEW issue_transition_analysis AS
WITH transitions AS (
  SELECT
    issue_tracking_id,
    from_state,
    to_state,
    EXTRACT(EPOCH FROM (
      transition_at - LAG(transition_at) OVER (PARTITION BY issue_tracking_id ORDER BY transition_at)
    )) / 3600 as hours_since_previous_transition
  FROM issue_state_history
  WHERE from_state IS NOT NULL
)
SELECT
  from_state,
  to_state,
  COUNT(*) as transition_count,
  AVG(hours_since_previous_transition) as avg_hours_between_transitions
FROM transitions
GROUP BY from_state, to_state
ORDER BY transition_count DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE issue_tracking IS 'Tracks canonical AFU-9 issue states through their lifecycle';
COMMENT ON TABLE issue_state_history IS 'Audit trail of all issue state transitions';
COMMENT ON COLUMN issue_tracking.state IS 'Current canonical state: CREATED, SPEC_READY, IMPLEMENTING, VERIFIED, MERGE_READY, DONE, HOLD, KILLED';
COMMENT ON COLUMN issue_tracking.previous_state IS 'Previous state before last transition';
COMMENT ON COLUMN issue_tracking.state_change_reason IS 'Human-readable explanation for state change';
COMMENT ON VIEW active_issues IS 'Issues not in terminal states (DONE, KILLED)';
COMMENT ON VIEW issue_state_metrics IS 'Aggregated metrics by state for monitoring';
COMMENT ON VIEW issue_transition_analysis IS 'Analysis of state transition patterns';
