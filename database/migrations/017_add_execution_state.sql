-- Migration 017: Add Execution State Tracking to AFU9 Issues
-- Adds execution state, timestamps and output fields for tracking issue execution progress
-- Issue #adaefler-art/codefactory-control#319 (Epic) - I5-4.1: Execution State Visibility

-- ========================================
-- Add Execution State Columns
-- ========================================

-- Add execution_state column with default 'IDLE'
ALTER TABLE afu9_issues 
ADD COLUMN execution_state VARCHAR(50) DEFAULT 'IDLE' NOT NULL;

-- Add execution timestamp columns
ALTER TABLE afu9_issues 
ADD COLUMN execution_started_at TIMESTAMPTZ;

ALTER TABLE afu9_issues 
ADD COLUMN execution_completed_at TIMESTAMPTZ;

-- Add execution output column for storing execution results
ALTER TABLE afu9_issues 
ADD COLUMN execution_output JSONB;

-- ========================================
-- Add Constraint for Valid Execution States
-- ========================================

ALTER TABLE afu9_issues 
ADD CONSTRAINT chk_afu9_issue_execution_state CHECK (execution_state IN (
  'IDLE',
  'RUNNING',
  'DONE',
  'FAILED'
));

-- ========================================
-- Indexes for Execution State Queries
-- ========================================

-- Index for filtering by execution state
CREATE INDEX idx_afu9_issues_execution_state 
ON afu9_issues(execution_state);

-- Index for querying execution timing
CREATE INDEX idx_afu9_issues_execution_started_at 
ON afu9_issues(execution_started_at DESC) 
WHERE execution_started_at IS NOT NULL;

-- ========================================
-- Update Event Log to Track Execution State Changes
-- ========================================

-- Extend afu9_issue_events to support execution state changes
ALTER TABLE afu9_issue_events 
ADD COLUMN old_execution_state VARCHAR(50);

ALTER TABLE afu9_issue_events 
ADD COLUMN new_execution_state VARCHAR(50);

-- Update event type constraint to include execution state change
ALTER TABLE afu9_issue_events DROP CONSTRAINT IF EXISTS chk_afu9_event_type;

ALTER TABLE afu9_issue_events ADD CONSTRAINT chk_afu9_event_type CHECK (event_type IN (
  'CREATED',
  'STATUS_CHANGED',
  'HANDOFF_STATE_CHANGED',
  'FIELD_UPDATED',
  'GITHUB_SYNCED',
  'ERROR_OCCURRED',
  'EXECUTION_STATE_CHANGED'
));

-- ========================================
-- Update Event Logging Trigger
-- ========================================

-- Replace the existing log_afu9_issue_event function to include execution state logging
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
      new_handoff_state,
      new_execution_state
    ) VALUES (
      NEW.id,
      'CREATED',
      jsonb_build_object(
        'title', NEW.title,
        'priority', NEW.priority,
        'assignee', NEW.assignee
      ),
      NEW.status,
      NEW.handoff_state,
      NEW.execution_state
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
    
    -- Log execution state changes
    IF OLD.execution_state IS DISTINCT FROM NEW.execution_state THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        event_type,
        old_execution_state,
        new_execution_state,
        event_data
      ) VALUES (
        NEW.id,
        'EXECUTION_STATE_CHANGED',
        OLD.execution_state,
        NEW.execution_state,
        jsonb_build_object(
          'execution_started_at', NEW.execution_started_at,
          'execution_completed_at', NEW.execution_completed_at,
          'execution_output', NEW.execution_output
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

-- ========================================
-- Helper View for Execution Monitoring
-- ========================================

-- View: Issues with active executions
CREATE VIEW afu9_executing_issues AS
SELECT 
  id,
  title,
  status,
  execution_state,
  execution_started_at,
  execution_completed_at,
  EXTRACT(EPOCH FROM (COALESCE(execution_completed_at, NOW()) - execution_started_at)) / 60 as execution_duration_minutes,
  created_at,
  updated_at
FROM afu9_issues
WHERE execution_state IN ('RUNNING', 'DONE', 'FAILED')
  AND execution_started_at IS NOT NULL
ORDER BY 
  CASE execution_state
    WHEN 'RUNNING' THEN 1
    WHEN 'FAILED' THEN 2
    WHEN 'DONE' THEN 3
  END,
  execution_started_at DESC;

-- ========================================
-- Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.execution_state IS 'Current execution state: IDLE, RUNNING, DONE, or FAILED';
COMMENT ON COLUMN afu9_issues.execution_started_at IS 'Timestamp when execution started (for RUNNING/DONE/FAILED states)';
COMMENT ON COLUMN afu9_issues.execution_completed_at IS 'Timestamp when execution completed (for DONE/FAILED states)';
COMMENT ON COLUMN afu9_issues.execution_output IS 'JSONB output from execution (logs, results, error details)';

COMMENT ON VIEW afu9_executing_issues IS 'Issues that have been executed or are currently executing';
