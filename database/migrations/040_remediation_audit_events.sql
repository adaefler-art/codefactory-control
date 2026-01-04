-- Migration 040: Remediation Audit Events (E77.5 / I775)
-- 
-- Full audit trail for remediation runs:
-- - Append-only event log (no updates)
-- - Governance-grade tracking (actions/inputs/evidence/results/lawbookVersion)
-- - Deterministic ordering (created_at, id)
-- - Payload hashing for integrity verification
--
-- Event Types:
-- - PLANNED: When remediation plan is generated
-- - STEP_STARTED: Before each step execution
-- - STEP_FINISHED: After each step execution
-- - VERIFICATION_STARTED: Before verification runs
-- - VERIFICATION_FINISHED: After verification runs
-- - STATUS_UPDATED: When run status changes
-- - COMPLETED: Run completed successfully
-- - FAILED: Run failed

-- ========================================
-- Table: remediation_audit_events
-- ========================================

CREATE TABLE IF NOT EXISTS remediation_audit_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign keys
  remediation_run_id UUID NOT NULL REFERENCES remediation_runs(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  -- Event type
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PLANNED',
    'STEP_STARTED',
    'STEP_FINISHED',
    'VERIFICATION_STARTED',
    'VERIFICATION_FINISHED',
    'STATUS_UPDATED',
    'COMPLETED',
    'FAILED'
  )),
  
  -- Timestamp (immutable, set on creation)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Lawbook version at time of event
  lawbook_version TEXT NOT NULL,
  
  -- Sanitized payload (inputs hashes, evidence refs, outputs summary)
  -- NO SECRETS - only pointers + hashes
  -- Example: {
  --   "stepId": "restart-service",
  --   "actionType": "RESTART_SERVICE",
  --   "inputsHash": "abc123...",
  --   "evidenceRefs": [{"kind": "ecs", "sha256": "def456..."}],
  --   "outputSummary": {"taskArn": "arn:...", "status": "RUNNING"}
  -- }
  payload_json JSONB NOT NULL,
  
  -- SHA-256 hash of canonical payload for integrity verification
  -- Computed from stable JSON serialization of payload_json
  payload_hash TEXT NOT NULL,
  
  -- Constraints
  CONSTRAINT valid_payload_json CHECK (jsonb_typeof(payload_json) = 'object')
);

-- Indexes for remediation_audit_events
-- Primary query pattern: get all events for a run, ordered by time
CREATE INDEX IF NOT EXISTS remediation_audit_events_run_id_created_at_idx 
  ON remediation_audit_events(remediation_run_id, created_at, id);

-- Query by incident
CREATE INDEX IF NOT EXISTS remediation_audit_events_incident_id_idx 
  ON remediation_audit_events(incident_id);

-- Query by event type
CREATE INDEX IF NOT EXISTS remediation_audit_events_type_idx 
  ON remediation_audit_events(event_type);

-- ========================================
-- Prevent Updates (Append-Only Enforcement)
-- ========================================

-- Trigger function to prevent updates
CREATE OR REPLACE FUNCTION prevent_remediation_audit_event_updates()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'remediation_audit_events is append-only: updates are not allowed';
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce append-only
CREATE TRIGGER trg_prevent_remediation_audit_event_updates
  BEFORE UPDATE ON remediation_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_remediation_audit_event_updates();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE remediation_audit_events IS 'Append-only audit trail for remediation runs (E77.5/I775)';
COMMENT ON COLUMN remediation_audit_events.event_type IS 'Event type: PLANNED, STEP_STARTED, STEP_FINISHED, VERIFICATION_*, STATUS_UPDATED, COMPLETED, FAILED';
COMMENT ON COLUMN remediation_audit_events.payload_json IS 'Sanitized event payload (no secrets, only pointers + hashes)';
COMMENT ON COLUMN remediation_audit_events.payload_hash IS 'SHA-256 hash of canonical payload for integrity verification';
COMMENT ON COLUMN remediation_audit_events.lawbook_version IS 'Lawbook version at time of event';
