-- Migration 045: Outcome Records + Auto-Postmortem JSON (E78.2 / I782)
-- 
-- Evidence-based outcome tracking with auto-generated postmortem artifacts:
-- - Measurable outcomes for Incidents/Remediation runs
-- - Deterministic postmortem generation (same inputs → same hash)
-- - Evidence-backed summaries (no invention, only facts)
-- - Append-only records with idempotent generation
-- - No secrets, only pointers + hashes
--
-- Features:
-- - Idempotency via outcome_key + postmortem_hash
-- - Version-controlled postmortem JSON schema (v0.7.0)
-- - Lawbook version tracking for transparency
-- - Source refs linking to incidents, remediation runs, verification reports
-- - Metrics tracking (MTTR, incidents_open, auto_fix_rate, etc.)

-- ========================================
-- Table: outcome_records
-- ========================================

CREATE TABLE IF NOT EXISTS outcome_records (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Entity type and ID (polymorphic reference)
  entity_type TEXT NOT NULL CHECK (entity_type IN ('incident', 'remediation_run')),
  entity_id UUID NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Idempotency key (deterministic, stable)
  -- Format examples:
  --   incident:<incident_id>:<remediation_run_id?>:<pack_hash>
  --   remediation_run:<remediation_run_id>:<verification_hash?>
  outcome_key TEXT NOT NULL,
  
  -- Status (future: support DRAFT, FINALIZED, etc.)
  status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED')),
  
  -- Metrics delta (jsonb)
  -- Example: {"mttr_hours": 2.5, "incidents_open": -1, "auto_fixed": true}
  metrics_json JSONB NOT NULL DEFAULT '{}',
  
  -- Postmortem JSON artifact (version-controlled schema)
  -- See PostmortemV0_7_0Schema in contracts/outcome.ts
  postmortem_json JSONB NOT NULL,
  
  -- Postmortem hash (SHA-256 of stable JSON)
  -- Deterministic: same inputs → same hash
  postmortem_hash TEXT NOT NULL,
  
  -- Lawbook version at time of generation
  lawbook_version TEXT,
  
  -- Source references (jsonb)
  -- Example: {
  --   "incidentId": "...",
  --   "remediationRunIds": ["..."],
  --   "verificationReportHashes": ["..."],
  --   "statusChanges": [...]
  -- }
  source_refs JSONB NOT NULL DEFAULT '{}',
  
  -- Constraints
  CONSTRAINT valid_metrics_json CHECK (jsonb_typeof(metrics_json) = 'object'),
  CONSTRAINT valid_postmortem_json CHECK (jsonb_typeof(postmortem_json) = 'object'),
  CONSTRAINT valid_source_refs CHECK (jsonb_typeof(source_refs) = 'object')
);

-- Unique constraint: prevent duplicate outcome records
-- Same outcome_key + postmortem_hash = idempotent
CREATE UNIQUE INDEX IF NOT EXISTS outcome_records_idempotency_idx 
  ON outcome_records(outcome_key, postmortem_hash);

-- Partial index on outcome_key alone for faster idempotency checks
-- Useful for checking if any outcome exists for a key before generating
CREATE INDEX IF NOT EXISTS outcome_records_outcome_key_idx 
  ON outcome_records(outcome_key);

-- Indexes for outcome_records
CREATE INDEX IF NOT EXISTS outcome_records_entity_type_id_idx 
  ON outcome_records(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS outcome_records_created_at_idx 
  ON outcome_records(created_at DESC);

CREATE INDEX IF NOT EXISTS outcome_records_lawbook_version_idx 
  ON outcome_records(lawbook_version) 
  WHERE lawbook_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS outcome_records_postmortem_hash_idx 
  ON outcome_records(postmortem_hash);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE outcome_records IS 'Evidence-based outcome tracking with auto-postmortem artifacts (E78.2/I782)';
COMMENT ON COLUMN outcome_records.entity_type IS 'Type of entity: incident or remediation_run';
COMMENT ON COLUMN outcome_records.entity_id IS 'UUID of the incident or remediation_run';
COMMENT ON COLUMN outcome_records.outcome_key IS 'Idempotency key derived from entity + evidence refs';
COMMENT ON COLUMN outcome_records.status IS 'Record status: RECORDED (future: DRAFT, FINALIZED)';
COMMENT ON COLUMN outcome_records.metrics_json IS 'Metrics delta: mttr_hours, incidents_open, auto_fixed, etc.';
COMMENT ON COLUMN outcome_records.postmortem_json IS 'Version-controlled postmortem JSON artifact (v0.7.0)';
COMMENT ON COLUMN outcome_records.postmortem_hash IS 'SHA-256 hash of stable postmortem JSON (deterministic)';
COMMENT ON COLUMN outcome_records.lawbook_version IS 'Lawbook version at time of generation';
COMMENT ON COLUMN outcome_records.source_refs IS 'Source references: incidentId, remediationRunIds, verificationHashes, etc.';
