-- Migration 025: GitHub Handoff Metadata + Idempotence
-- Issue E61.3 (I613): GitHub Handoff Metadaten + Idempotenz
-- 
-- Adds metadata fields for deterministic, traceable, and idempotent handoff
-- Updates handoff_state constraint to support PENDING and SYNCHRONIZED states

-- ========================================
-- Step 1: Add new metadata fields
-- ========================================

-- Timestamp when handoff was initiated
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMP NULL;

-- Error message from handoff failures (replaces/supplements last_error)
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS handoff_error TEXT NULL;

-- GitHub repository (owner/repo) for traceability
-- Allows future multi-repo support
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS github_repo TEXT NULL;

-- Last successful sync timestamp (for idempotent updates)
ALTER TABLE afu9_issues ADD COLUMN IF NOT EXISTS github_issue_last_sync_at TIMESTAMP NULL;

-- ========================================
-- Step 2: Update handoff_state constraint
-- ========================================

-- Drop old constraint
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_handoff_state;

-- Add new constraint with PENDING and SYNCHRONIZED states
-- Semantic mapping:
-- - NONE: No handoff initiated (deprecated, use NOT_SENT)
-- - NOT_SENT: Initial state, no handoff attempted
-- - PENDING: Handoff in progress
-- - SENT: GitHub issue created (deprecated, use SYNCED or SYNCHRONIZED)
-- - SYNCED: Successfully created/updated (existing state, kept for compatibility)
-- - SYNCHRONIZED: Successfully updated (idempotent updates)
-- - FAILED: Handoff/sync failed
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_handoff_state CHECK (handoff_state IN (
  'NONE',
  'NOT_SENT',
  'PENDING',
  'SENT',
  'SYNCED',
  'SYNCHRONIZED',
  'FAILED'
));

-- ========================================
-- Step 3: Migrate existing data
-- ========================================

-- Populate github_repo for existing issues with github_url
-- Extract owner/repo from github_url (https://github.com/owner/repo/issues/123)
UPDATE afu9_issues
SET github_repo = 
  CASE 
    WHEN github_url IS NOT NULL AND github_url LIKE 'https://github.com/%'
    THEN substring(github_url from 'https://github.com/([^/]+/[^/]+)')
    ELSE NULL
  END
WHERE github_repo IS NULL AND github_url IS NOT NULL;

-- Set handoff_at to created_at for issues that have been handed off
-- This is a best-effort migration - actual handoff time may differ
UPDATE afu9_issues
SET handoff_at = created_at
WHERE handoff_at IS NULL 
  AND handoff_state IN ('SENT', 'SYNCED', 'SYNCHRONIZED')
  AND github_issue_number IS NOT NULL;

-- Set github_issue_last_sync_at to updated_at for synced issues
UPDATE afu9_issues
SET github_issue_last_sync_at = updated_at
WHERE github_issue_last_sync_at IS NULL
  AND handoff_state IN ('SYNCED', 'SYNCHRONIZED')
  AND github_issue_number IS NOT NULL;

-- Migrate last_error to handoff_error for failed handoffs
UPDATE afu9_issues
SET handoff_error = last_error
WHERE handoff_error IS NULL
  AND handoff_state = 'FAILED'
  AND last_error IS NOT NULL;

-- ========================================
-- Step 4: Add indexes for new fields
-- ========================================

-- Index for handoff_at (for queries by handoff time)
CREATE INDEX IF NOT EXISTS idx_afu9_issues_handoff_at ON afu9_issues(handoff_at DESC)
WHERE handoff_at IS NOT NULL;

-- Index for github_repo (for multi-repo queries)
CREATE INDEX IF NOT EXISTS idx_afu9_issues_github_repo ON afu9_issues(github_repo)
WHERE github_repo IS NOT NULL;

-- ========================================
-- Step 5: Update issue_events trigger
-- ========================================

-- Update the trigger function to log handoff events with new metadata
CREATE OR REPLACE FUNCTION log_afu9_issue_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT (creation)
  IF TG_OP = 'INSERT' THEN
    INSERT INTO afu9_issue_events (
      issue_id,
      type,
      payload_json,
      to_status,
      actor
    ) VALUES (
      NEW.id,
      'CREATED',
      jsonb_build_object(
        'title', NEW.title,
        'priority', NEW.priority,
        'assignee', NEW.assignee
      ),
      NEW.status,
      'system'
    );
    RETURN NEW;
  END IF;
  
  -- Handle UPDATE - status changes
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        type,
        from_status,
        to_status,
        actor
      ) VALUES (
        NEW.id,
        'STATUS_CHANGED',
        OLD.status,
        NEW.status,
        'system'
      );
    END IF;
    
    -- Log handoff state changes with metadata
    IF OLD.handoff_state IS DISTINCT FROM NEW.handoff_state THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        type,
        payload_json,
        actor
      ) VALUES (
        NEW.id,
        'FIELD_UPDATED',
        jsonb_build_object(
          'field', 'handoff_state',
          'old_value', OLD.handoff_state,
          'new_value', NEW.handoff_state,
          'github_issue_number', NEW.github_issue_number,
          'github_url', NEW.github_url,
          'github_repo', NEW.github_repo,
          'handoff_at', NEW.handoff_at,
          'handoff_error', NEW.handoff_error
        ),
        'system'
      );
    END IF;
    
    -- Log GitHub sync events
    IF (OLD.github_issue_number IS NULL AND NEW.github_issue_number IS NOT NULL) OR
       (OLD.github_issue_last_sync_at IS DISTINCT FROM NEW.github_issue_last_sync_at) THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        type,
        payload_json,
        actor
      ) VALUES (
        NEW.id,
        'GITHUB_SYNCED',
        jsonb_build_object(
          'github_issue_number', NEW.github_issue_number,
          'github_url', NEW.github_url,
          'github_repo', NEW.github_repo,
          'synced_at', NEW.github_issue_last_sync_at,
          'handoff_state', NEW.handoff_state
        ),
        'system'
      );
    END IF;
    
    -- Log errors
    IF OLD.handoff_error IS NULL AND NEW.handoff_error IS NOT NULL THEN
      INSERT INTO afu9_issue_events (
        issue_id,
        type,
        payload_json,
        actor
      ) VALUES (
        NEW.id,
        'ERROR_OCCURRED',
        jsonb_build_object(
          'error', NEW.handoff_error,
          'handoff_state', NEW.handoff_state,
          'handoff_at', NEW.handoff_at
        ),
        'system'
      );
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Comments
-- ========================================

COMMENT ON COLUMN afu9_issues.handoff_at IS 'E61.3: Timestamp when GitHub handoff was initiated';
COMMENT ON COLUMN afu9_issues.handoff_error IS 'E61.3: Error message from handoff failures (supplements last_error)';
COMMENT ON COLUMN afu9_issues.github_repo IS 'E61.3: GitHub repository (owner/repo) for traceability and multi-repo support';
COMMENT ON COLUMN afu9_issues.github_issue_last_sync_at IS 'E61.3: Last successful sync timestamp for idempotent updates';

COMMENT ON CONSTRAINT chk_afu9_issue_handoff_state ON afu9_issues IS 'E61.3: Enforces valid handoff states including PENDING and SYNCHRONIZED for idempotent handoff';
