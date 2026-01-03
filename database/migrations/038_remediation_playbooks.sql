-- Migration 038: Remediation Playbook Framework (E77.1 / I771)
-- 
-- Controlled remediation playbook execution framework:
-- - Idempotency via run_key (incident_key + playbookId + inputs_hash)
-- - Evidence gating: require specific evidence before running
-- - Lawbook gating: deny-by-default, explicit allow required
-- - Full audit trail: planned → executed → verified
-- - Step-level idempotency and tracking
--
-- Features:
-- - Deterministic planning (same inputs → same plan)
-- - Append-only audit (status transitions recorded)
-- - No secrets in stored JSON (sanitized inputs/outputs)
-- - Compatible with Incident schema (E76.1 / I761)

-- ========================================
-- Table: remediation_runs
-- ========================================

CREATE TABLE IF NOT EXISTS remediation_runs (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Idempotency key (deterministic, stable)
  -- Format: <incident_key>:<playbook_id>:<inputs_hash>
  -- Example: deploy_status:prod:deploy-123:2024-01-01T00:00:00Z:restart-service:abc123
  run_key TEXT NOT NULL,
  
  -- Foreign key to incident
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  
  -- Playbook identification
  playbook_id TEXT NOT NULL,
  playbook_version TEXT NOT NULL,
  
  -- Status: lifecycle state
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Planned execution (deterministic, no secrets)
  -- Example: {"playbookId": "restart-service", "steps": [...], "lawbookVersion": "v1.0.0"}
  planned_json JSONB,
  
  -- Result summary (no secrets)
  -- Example: {"totalSteps": 3, "successCount": 3, "failedCount": 0, "durationMs": 1234}
  result_json JSONB,
  
  -- Lawbook version used for gating
  lawbook_version TEXT NOT NULL,
  
  -- Inputs hash (SHA-256 of stable JSON inputs)
  inputs_hash TEXT NOT NULL,
  
  -- Constraints
  CONSTRAINT uq_remediation_runs_key UNIQUE (run_key),
  CONSTRAINT valid_planned_json CHECK (planned_json IS NULL OR jsonb_typeof(planned_json) = 'object'),
  CONSTRAINT valid_result_json CHECK (result_json IS NULL OR jsonb_typeof(result_json) = 'object')
);

-- Indexes for remediation_runs
CREATE INDEX IF NOT EXISTS remediation_runs_incident_id_idx ON remediation_runs(incident_id);
CREATE INDEX IF NOT EXISTS remediation_runs_playbook_id_idx ON remediation_runs(playbook_id);
CREATE INDEX IF NOT EXISTS remediation_runs_status_idx ON remediation_runs(status);
CREATE INDEX IF NOT EXISTS remediation_runs_created_at_idx ON remediation_runs(created_at DESC);

-- ========================================
-- Table: remediation_steps
-- ========================================

CREATE TABLE IF NOT EXISTS remediation_steps (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Foreign key to remediation run
  remediation_run_id UUID NOT NULL REFERENCES remediation_runs(id) ON DELETE CASCADE,
  
  -- Step identification
  step_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'RESTART_SERVICE',
    'ROLLBACK_DEPLOY',
    'SCALE_UP',
    'SCALE_DOWN',
    'DRAIN_TASKS',
    'NOTIFY_SLACK',
    'CREATE_ISSUE',
    'RUN_VERIFICATION'
  )),
  
  -- Status: lifecycle state
  status TEXT NOT NULL CHECK (status IN ('PLANNED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  
  -- Timestamps
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  
  -- Step-level idempotency key (optional, for global step deduplication)
  -- Format: <action_type>:<target_id>:<params_hash>
  -- Example: RESTART_SERVICE:prod-api:abc123
  idempotency_key TEXT,
  
  -- Step input (sanitized, no secrets)
  -- Example: {"service": "prod-api", "reason": "health_check_failed"}
  input_json JSONB,
  
  -- Step output (sanitized, no secrets)
  -- Example: {"taskArn": "...", "restartedAt": "..."}
  output_json JSONB,
  
  -- Step error (sanitized, no secrets)
  -- Example: {"code": "SERVICE_NOT_FOUND", "message": "..."}
  error_json JSONB,
  
  -- Constraints
  CONSTRAINT uq_remediation_steps_per_run UNIQUE (remediation_run_id, step_id),
  CONSTRAINT valid_input_json CHECK (input_json IS NULL OR jsonb_typeof(input_json) = 'object'),
  CONSTRAINT valid_output_json CHECK (output_json IS NULL OR jsonb_typeof(output_json) = 'object'),
  CONSTRAINT valid_error_json CHECK (error_json IS NULL OR jsonb_typeof(error_json) = 'object'),
  CONSTRAINT valid_timestamps CHECK (
    (started_at IS NULL) OR 
    (finished_at IS NULL) OR 
    (started_at <= finished_at)
  )
);

-- Indexes for remediation_steps
CREATE INDEX IF NOT EXISTS remediation_steps_run_id_idx ON remediation_steps(remediation_run_id);
CREATE INDEX IF NOT EXISTS remediation_steps_action_type_idx ON remediation_steps(action_type);
CREATE INDEX IF NOT EXISTS remediation_steps_status_idx ON remediation_steps(status);
CREATE INDEX IF NOT EXISTS remediation_steps_idempotency_key_idx ON remediation_steps(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Optional: Global uniqueness constraint for step idempotency keys
-- Uncomment if global step deduplication is required across all runs
-- CREATE UNIQUE INDEX IF NOT EXISTS remediation_steps_global_idempotency_idx 
--   ON remediation_steps(idempotency_key) 
--   WHERE idempotency_key IS NOT NULL;

-- ========================================
-- Trigger: Update timestamp on remediation_runs
-- ========================================

CREATE OR REPLACE FUNCTION update_remediation_run_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_remediation_run_timestamp
  BEFORE UPDATE ON remediation_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_remediation_run_timestamp();

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE remediation_runs IS 'Remediation playbook execution runs (E77.1/I771)';
COMMENT ON COLUMN remediation_runs.run_key IS 'Idempotency key: <incident_key>:<playbook_id>:<inputs_hash>';
COMMENT ON COLUMN remediation_runs.status IS 'Lifecycle state: PLANNED, RUNNING, SUCCEEDED, FAILED, SKIPPED';
COMMENT ON COLUMN remediation_runs.planned_json IS 'Deterministic plan: steps + resolved targets (no secrets)';
COMMENT ON COLUMN remediation_runs.result_json IS 'Summary: totalSteps, successCount, failedCount, durationMs (no secrets)';
COMMENT ON COLUMN remediation_runs.lawbook_version IS 'Lawbook version used for gating';
COMMENT ON COLUMN remediation_runs.inputs_hash IS 'SHA-256 hash of stable JSON inputs for idempotency';

COMMENT ON TABLE remediation_steps IS 'Individual remediation step executions';
COMMENT ON COLUMN remediation_steps.step_id IS 'Step identifier within the playbook';
COMMENT ON COLUMN remediation_steps.action_type IS 'Type of remediation action';
COMMENT ON COLUMN remediation_steps.idempotency_key IS 'Optional global step idempotency key';
COMMENT ON COLUMN remediation_steps.input_json IS 'Sanitized step input (no secrets)';
COMMENT ON COLUMN remediation_steps.output_json IS 'Sanitized step output (no secrets)';
COMMENT ON COLUMN remediation_steps.error_json IS 'Sanitized step error (no secrets)';
