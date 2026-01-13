-- Migration 065: Drift Detection & Repair Suggestions
-- E85.4: Drift Detection + Repair Suggestions
--
-- Creates tables for:
-- 1. drift_detections: Tracks detected drift between AFU-9 and GitHub
-- 2. drift_resolutions: Audit trail of applied repair suggestions
--
-- Implements:
-- - Evidence-first drift detection
-- - No auto-repair (only suggestions)
-- - Explicit user confirmation required
-- - Full audit trail of all decisions

-- ========================================
-- Drift Detections Table
-- ========================================

CREATE TABLE drift_detections (
  id UUID PRIMARY KEY,
  
  -- Issue reference
  issue_id UUID NOT NULL REFERENCES afu9_issues(id) ON DELETE CASCADE,
  
  -- Drift detection results
  drift_detected BOOLEAN NOT NULL DEFAULT false,
  drift_types TEXT[] NOT NULL DEFAULT '{}',
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  
  -- Evidence (JSONB for flexible schema)
  evidence JSONB NOT NULL DEFAULT '{}',
  
  -- Repair suggestions (JSONB array)
  suggestions JSONB NOT NULL DEFAULT '[]',
  
  -- Detection metadata
  detected_at TIMESTAMPTZ NOT NULL,
  
  -- GitHub reference
  github_owner VARCHAR(255) NOT NULL,
  github_repo VARCHAR(255) NOT NULL,
  github_issue_number INTEGER NOT NULL,
  
  -- Dry run flag
  dry_run BOOLEAN NOT NULL DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by issue
CREATE INDEX idx_drift_detections_issue_id ON drift_detections(issue_id);

-- Index for querying by drift detection status
CREATE INDEX idx_drift_detections_drift_detected ON drift_detections(drift_detected, detected_at DESC);

-- Index for querying by severity
CREATE INDEX idx_drift_detections_severity ON drift_detections(severity, detected_at DESC);

-- Index for querying by drift types (GIN for array containment)
CREATE INDEX idx_drift_detections_drift_types ON drift_detections USING GIN(drift_types);

-- ========================================
-- Drift Resolutions Table
-- ========================================

CREATE TABLE drift_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference to detection
  drift_detection_id UUID NOT NULL REFERENCES drift_detections(id) ON DELETE CASCADE,
  
  -- Reference to specific suggestion that was applied
  suggestion_id UUID NOT NULL,
  
  -- Who applied the resolution
  applied_by VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  
  -- Actions that were applied (JSONB array)
  actions_applied JSONB NOT NULL DEFAULT '[]',
  
  -- Result of applying the suggestion
  result_success BOOLEAN NOT NULL,
  result_message TEXT,
  
  -- Full audit trail (JSONB for flexible schema)
  audit_trail JSONB NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying resolutions by detection
CREATE INDEX idx_drift_resolutions_detection_id ON drift_resolutions(drift_detection_id);

-- Index for querying resolutions by user
CREATE INDEX idx_drift_resolutions_applied_by ON drift_resolutions(applied_by, applied_at DESC);

-- Index for querying resolutions by success
CREATE INDEX idx_drift_resolutions_result_success ON drift_resolutions(result_success, applied_at DESC);

-- ========================================
-- Views for Reporting
-- ========================================

-- View: Recent drift detections with drift
CREATE VIEW drift_detections_recent AS
SELECT
  id,
  issue_id,
  drift_types,
  severity,
  detected_at,
  github_owner,
  github_repo,
  github_issue_number,
  (SELECT COUNT(*) FROM drift_resolutions WHERE drift_detection_id = drift_detections.id) as resolution_count
FROM drift_detections
WHERE drift_detected = true
ORDER BY detected_at DESC
LIMIT 100;

-- View: Drift audit summary by issue
CREATE VIEW drift_audit_summary AS
SELECT
  i.id as issue_id,
  i.title as issue_title,
  i.status as issue_status,
  COUNT(DISTINCT d.id) as total_detections,
  COUNT(DISTINCT d.id) FILTER (WHERE d.drift_detected = true) as drift_detected_count,
  MAX(d.detected_at) as last_detection_at,
  COUNT(DISTINCT r.id) as total_resolutions,
  COUNT(DISTINCT r.id) FILTER (WHERE r.result_success = true) as successful_resolutions
FROM afu9_issues i
LEFT JOIN drift_detections d ON i.id = d.issue_id
LEFT JOIN drift_resolutions r ON d.id = r.drift_detection_id
GROUP BY i.id, i.title, i.status;

-- ========================================
-- Functions
-- ========================================

-- Function: Update updated_at timestamp on drift_detections
CREATE OR REPLACE FUNCTION update_drift_detections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update updated_at on drift_detections
CREATE TRIGGER trigger_drift_detections_updated_at
  BEFORE UPDATE ON drift_detections
  FOR EACH ROW
  EXECUTE FUNCTION update_drift_detections_updated_at();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE drift_detections IS 'E85.4: Tracks detected drift between AFU-9 and GitHub state';
COMMENT ON TABLE drift_resolutions IS 'E85.4: Audit trail of applied drift repair suggestions (requires explicit user confirmation)';
COMMENT ON COLUMN drift_detections.drift_detected IS 'Whether any drift was detected';
COMMENT ON COLUMN drift_detections.drift_types IS 'Array of drift types detected (STATUS_MISMATCH, LABEL_MISMATCH, CHECK_MISMATCH, STATE_MISMATCH, METADATA_MISMATCH)';
COMMENT ON COLUMN drift_detections.severity IS 'Severity level: LOW, MEDIUM, HIGH, CRITICAL';
COMMENT ON COLUMN drift_detections.evidence IS 'JSONB evidence collected during drift detection';
COMMENT ON COLUMN drift_detections.suggestions IS 'JSONB array of repair suggestions (AFU9_TO_GITHUB, GITHUB_TO_AFU9, MANUAL_REVIEW)';
COMMENT ON COLUMN drift_resolutions.applied_by IS 'User who applied the repair suggestion';
COMMENT ON COLUMN drift_resolutions.actions_applied IS 'JSONB array of actions that were executed';
COMMENT ON COLUMN drift_resolutions.audit_trail IS 'Full audit trail including before/after state';
