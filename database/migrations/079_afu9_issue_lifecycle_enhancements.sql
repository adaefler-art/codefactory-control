-- Migration 079: AFU-9 Issue Lifecycle Enhancements
-- 
-- Implements canonical AFU-9 Issue lifecycle (Issue → CR → Publish → GH Mirror → CP Assign → Timeline/Evidence)
-- 
-- Issue: AFU-9: Introduce canonical AFU-9 Issue lifecycle
-- 
-- Features:
-- 1. CR Binding: Explicit binding of Change Requests to Issues
-- 2. Lifecycle State Extensions: DRAFT_READY, VERSION_COMMITTED, CR_BOUND, PUBLISHING, PUBLISHED
-- 3. Timeline Events: Comprehensive event tracking
-- 4. Evidence Records: Publish receipts and audit trail
-- 5. Control Pack Assignments: Default CP assignment for issues
-- 6. Canonical ID: Public identifier for issues
-- 7. KPI Context: Metadata for KPI tracking

-- ========================================
-- Step 1: Add new fields to afu9_issues
-- ========================================

-- Canonical ID (public identifier, derived from UUID prefix)
-- No column needed - computed from id as LOWER(LEFT(id::text, 8))

-- Session and draft tracking
ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS source_session_id UUID,
  ADD COLUMN IF NOT EXISTS current_draft_id UUID;

-- CR binding (explicit one-to-one relationship)
ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS active_cr_id UUID;

-- GitHub mirror synchronization timestamp
ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS github_synced_at TIMESTAMP;

-- KPI context (JSONB for flexibility)
ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS kpi_context JSONB DEFAULT '{}';

-- Publish orchestration metadata
ALTER TABLE afu9_issues
  ADD COLUMN IF NOT EXISTS publish_batch_id UUID,
  ADD COLUMN IF NOT EXISTS publish_request_id VARCHAR(255);

-- ========================================
-- Step 2: Update status constraint to include new lifecycle states
-- ========================================

-- Drop old constraint
ALTER TABLE afu9_issues DROP CONSTRAINT IF EXISTS chk_afu9_issue_status;

-- Add new constraint with extended states
ALTER TABLE afu9_issues ADD CONSTRAINT chk_afu9_issue_status CHECK (status IN (
  'CREATED',
  'DRAFT_READY',
  'VERSION_COMMITTED',
  'CR_BOUND',
  'SPEC_READY',
  'PUBLISHING',
  'PUBLISHED',
  'IMPLEMENTING',
  'VERIFIED',
  'MERGE_READY',
  'DONE',
  'HOLD',
  'KILLED'
));

-- ========================================
-- Step 3: Create issue_timeline table
-- ========================================

CREATE TABLE IF NOT EXISTS issue_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Issue reference
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- Event details
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB DEFAULT '{}',
  
  -- Actor information
  actor VARCHAR(255),
  actor_type VARCHAR(50), -- 'system', 'user', 'agent'
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_issue_timeline_event_type CHECK (event_type IN (
    'ISSUE_CREATED',
    'DRAFT_COMMITTED',
    'CR_BOUND',
    'CR_UNBOUND',
    'PUBLISHING_STARTED',
    'PUBLISHED',
    'PUBLISH_FAILED',
    'GITHUB_MIRRORED',
    'CP_ASSIGNED',
    'CP_UNASSIGNED',
    'STATE_TRANSITION',
    'FIELD_UPDATED',
    'ERROR_OCCURRED'
  ))
);

-- Indexes for timeline queries
CREATE INDEX idx_issue_timeline_issue_id ON issue_timeline(issue_id);
CREATE INDEX idx_issue_timeline_created_at ON issue_timeline(created_at DESC);
CREATE INDEX idx_issue_timeline_event_type ON issue_timeline(event_type);
CREATE INDEX idx_issue_timeline_issue_id_created_at ON issue_timeline(issue_id, created_at DESC);

-- ========================================
-- Step 4: Create issue_evidence table
-- ========================================

CREATE TABLE IF NOT EXISTS issue_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Issue reference
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- Evidence type
  evidence_type VARCHAR(50) NOT NULL,
  
  -- Evidence data
  evidence_data JSONB NOT NULL,
  
  -- Request tracking
  request_id VARCHAR(255),
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_issue_evidence_type CHECK (evidence_type IN (
    'PUBLISH_RECEIPT',
    'GITHUB_MIRROR_RECEIPT',
    'CR_BINDING_RECEIPT',
    'CP_ASSIGNMENT_RECEIPT',
    'STATE_TRANSITION_RECEIPT'
  ))
);

-- Indexes for evidence queries
CREATE INDEX idx_issue_evidence_issue_id ON issue_evidence(issue_id);
CREATE INDEX idx_issue_evidence_created_at ON issue_evidence(created_at DESC);
CREATE INDEX idx_issue_evidence_evidence_type ON issue_evidence(evidence_type);
CREATE INDEX idx_issue_evidence_request_id ON issue_evidence(request_id) WHERE request_id IS NOT NULL;

-- ========================================
-- Step 5: Create control_pack_assignments table
-- ========================================

CREATE TABLE IF NOT EXISTS control_pack_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Issue reference
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- Control Pack information
  control_pack_id VARCHAR(255) NOT NULL,
  control_pack_name VARCHAR(255) NOT NULL,
  
  -- Assignment metadata
  assigned_by VARCHAR(255),
  assignment_reason VARCHAR(500),
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT chk_cp_assignment_status CHECK (status IN (
    'active',
    'inactive',
    'revoked'
  ))
);

-- Indexes for CP assignment queries
CREATE INDEX idx_cp_assignments_issue_id ON control_pack_assignments(issue_id);
CREATE INDEX idx_cp_assignments_control_pack_id ON control_pack_assignments(control_pack_id);
CREATE INDEX idx_cp_assignments_status ON control_pack_assignments(status);

-- Unique constraint: one active CP per issue
CREATE UNIQUE INDEX idx_cp_assignments_unique_active 
  ON control_pack_assignments(issue_id, control_pack_id) 
  WHERE status = 'active';

-- ========================================
-- Step 6: Add foreign key constraints (if referenced tables exist)
-- ========================================

-- Note: FK constraints for source_session_id and active_cr_id are optional
-- They would reference intent_sessions and intent_cr_versions respectively
-- We'll add them as conditional constraints if the tables exist

DO $$
BEGIN
  -- Check if intent_sessions table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'intent_sessions') THEN
    -- Add FK constraint for source_session_id
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_afu9_issues_source_session_id'
    ) THEN
      ALTER TABLE afu9_issues 
        ADD CONSTRAINT fk_afu9_issues_source_session_id 
        FOREIGN KEY (source_session_id) REFERENCES intent_sessions(id) ON DELETE SET NULL;
    END IF;
  END IF;
  
  -- Check if intent_cr_versions table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'intent_cr_versions') THEN
    -- Add FK constraint for active_cr_id
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'fk_afu9_issues_active_cr_id'
    ) THEN
      ALTER TABLE afu9_issues 
        ADD CONSTRAINT fk_afu9_issues_active_cr_id 
        FOREIGN KEY (active_cr_id) REFERENCES intent_cr_versions(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- ========================================
-- Step 7: Add indexes for new afu9_issues fields
-- ========================================

CREATE INDEX IF NOT EXISTS idx_afu9_issues_source_session_id 
  ON afu9_issues(source_session_id) WHERE source_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_afu9_issues_active_cr_id 
  ON afu9_issues(active_cr_id) WHERE active_cr_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_afu9_issues_github_synced_at 
  ON afu9_issues(github_synced_at DESC) WHERE github_synced_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_afu9_issues_publish_batch_id 
  ON afu9_issues(publish_batch_id) WHERE publish_batch_id IS NOT NULL;

-- ========================================
-- Step 8: Create helper views
-- ========================================

-- View: Issues with active CR binding
CREATE OR REPLACE VIEW afu9_issues_with_cr AS
SELECT 
  i.id,
  i.title,
  i.status,
  i.active_cr_id,
  i.github_issue_number,
  i.github_url,
  i.github_synced_at,
  i.created_at,
  i.updated_at
FROM afu9_issues i
WHERE i.active_cr_id IS NOT NULL
  AND i.deleted_at IS NULL
ORDER BY i.created_at DESC;

-- View: Issues pending publish
CREATE OR REPLACE VIEW afu9_issues_pending_publish AS
SELECT 
  i.id,
  i.title,
  i.status,
  i.active_cr_id,
  i.handoff_state,
  i.created_at
FROM afu9_issues i
WHERE i.status IN ('CR_BOUND', 'DRAFT_READY', 'VERSION_COMMITTED')
  AND i.github_issue_number IS NULL
  AND i.deleted_at IS NULL
ORDER BY i.created_at ASC;

-- View: Issue with CP assignments
CREATE OR REPLACE VIEW afu9_issues_with_assignments AS
SELECT 
  i.id,
  i.title,
  i.status,
  array_agg(DISTINCT cp.control_pack_name) FILTER (WHERE cp.status = 'active') as active_control_packs,
  COUNT(cp.id) FILTER (WHERE cp.status = 'active') as active_cp_count,
  i.created_at,
  i.updated_at
FROM afu9_issues i
LEFT JOIN control_pack_assignments cp ON i.id = cp.issue_id
WHERE i.deleted_at IS NULL
GROUP BY i.id, i.title, i.status, i.created_at, i.updated_at
ORDER BY i.created_at DESC;

-- ========================================
-- Step 9: Helper functions
-- ========================================

-- Function to get public ID from issue UUID
CREATE OR REPLACE FUNCTION get_afu9_issue_public_id(issue_uuid UUID)
RETURNS VARCHAR(8) AS $$
BEGIN
  RETURN LOWER(LEFT(issue_uuid::text, 8));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to log timeline event
CREATE OR REPLACE FUNCTION log_issue_timeline_event(
  p_issue_id UUID,
  p_event_type VARCHAR(50),
  p_event_data JSONB DEFAULT '{}',
  p_actor VARCHAR(255) DEFAULT 'system',
  p_actor_type VARCHAR(50) DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO issue_timeline (
    issue_id,
    event_type,
    event_data,
    actor,
    actor_type
  ) VALUES (
    p_issue_id,
    p_event_type,
    p_event_data,
    p_actor,
    p_actor_type
  )
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- Function to record evidence
CREATE OR REPLACE FUNCTION record_issue_evidence(
  p_issue_id UUID,
  p_evidence_type VARCHAR(50),
  p_evidence_data JSONB,
  p_request_id VARCHAR(255) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_evidence_id UUID;
BEGIN
  INSERT INTO issue_evidence (
    issue_id,
    evidence_type,
    evidence_data,
    request_id
  ) VALUES (
    p_issue_id,
    p_evidence_type,
    p_evidence_data,
    p_request_id
  )
  RETURNING id INTO v_evidence_id;
  
  RETURN v_evidence_id;
END;
$$ LANGUAGE plpgsql;

-- Function to assign default control pack
CREATE OR REPLACE FUNCTION assign_default_control_pack(
  p_issue_id UUID,
  p_assigned_by VARCHAR(255) DEFAULT 'system'
)
RETURNS UUID AS $$
DECLARE
  v_assignment_id UUID;
  v_default_cp_id VARCHAR(255) := 'cp:intent-issue-authoring';
  v_default_cp_name VARCHAR(255) := 'INTENT Issue Authoring';
BEGIN
  INSERT INTO control_pack_assignments (
    issue_id,
    control_pack_id,
    control_pack_name,
    assigned_by,
    assignment_reason,
    status
  ) VALUES (
    p_issue_id,
    v_default_cp_id,
    v_default_cp_name,
    p_assigned_by,
    'Default CP assignment on issue creation',
    'active'
  )
  ON CONFLICT (issue_id, control_pack_id) WHERE status = 'active'
  DO NOTHING
  RETURNING id INTO v_assignment_id;
  
  RETURN v_assignment_id;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Step 10: Triggers for automatic timeline logging
-- ========================================

-- Trigger function to log CR binding events
CREATE OR REPLACE FUNCTION log_cr_binding_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Log CR binding
  IF NEW.active_cr_id IS NOT NULL AND (OLD.active_cr_id IS NULL OR OLD.active_cr_id IS DISTINCT FROM NEW.active_cr_id) THEN
    PERFORM log_issue_timeline_event(
      NEW.id,
      'CR_BOUND',
      jsonb_build_object(
        'cr_id', NEW.active_cr_id,
        'previous_cr_id', OLD.active_cr_id
      ),
      'system',
      'system'
    );
  END IF;
  
  -- Log CR unbinding
  IF NEW.active_cr_id IS NULL AND OLD.active_cr_id IS NOT NULL THEN
    PERFORM log_issue_timeline_event(
      NEW.id,
      'CR_UNBOUND',
      jsonb_build_object(
        'previous_cr_id', OLD.active_cr_id
      ),
      'system',
      'system'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for CR binding
CREATE TRIGGER trg_log_cr_binding
  AFTER UPDATE OF active_cr_id ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION log_cr_binding_event();

-- Trigger function to log publish events
CREATE OR REPLACE FUNCTION log_publish_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Log GitHub mirror creation
  IF NEW.github_issue_number IS NOT NULL AND OLD.github_issue_number IS NULL THEN
    PERFORM log_issue_timeline_event(
      NEW.id,
      'GITHUB_MIRRORED',
      jsonb_build_object(
        'github_issue_number', NEW.github_issue_number,
        'github_url', NEW.github_url,
        'github_synced_at', NEW.github_synced_at
      ),
      'system',
      'system'
    );
    
    PERFORM record_issue_evidence(
      NEW.id,
      'GITHUB_MIRROR_RECEIPT',
      jsonb_build_object(
        'github_issue_number', NEW.github_issue_number,
        'github_url', NEW.github_url,
        'synced_at', NEW.github_synced_at,
        'batch_id', NEW.publish_batch_id
      ),
      NEW.publish_request_id
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for publish events
CREATE TRIGGER trg_log_publish_event
  AFTER UPDATE OF github_issue_number, github_url ON afu9_issues
  FOR EACH ROW
  EXECUTE FUNCTION log_publish_event();

-- ========================================
-- Step 11: Comments
-- ========================================

COMMENT ON TABLE issue_timeline IS 'Timeline events for AFU-9 Issues (Issue → CR → Publish → GH Mirror → CP Assign)';
COMMENT ON TABLE issue_evidence IS 'Evidence records for AFU-9 Issue lifecycle actions (publish receipts, audit trail)';
COMMENT ON TABLE control_pack_assignments IS 'Control Pack assignments for AFU-9 Issues';

COMMENT ON COLUMN afu9_issues.source_session_id IS 'INTENT session that created this issue';
COMMENT ON COLUMN afu9_issues.current_draft_id IS 'Current draft version ID';
COMMENT ON COLUMN afu9_issues.active_cr_id IS 'Active Change Request ID (explicit binding)';
COMMENT ON COLUMN afu9_issues.github_synced_at IS 'Last successful GitHub mirror sync timestamp';
COMMENT ON COLUMN afu9_issues.kpi_context IS 'KPI tracking metadata (D2D, HSH, AVS, etc.)';
COMMENT ON COLUMN afu9_issues.publish_batch_id IS 'Publish batch ID for idempotency tracking';
COMMENT ON COLUMN afu9_issues.publish_request_id IS 'Request ID for publish operation tracking';

COMMENT ON FUNCTION get_afu9_issue_public_id IS 'Get 8-char public ID from issue UUID';
COMMENT ON FUNCTION log_issue_timeline_event IS 'Log a timeline event for an issue';
COMMENT ON FUNCTION record_issue_evidence IS 'Record evidence for an issue lifecycle action';
COMMENT ON FUNCTION assign_default_control_pack IS 'Assign default control pack to an issue';
