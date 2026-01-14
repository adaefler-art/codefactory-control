-- Migration 066: DB Repair Runs (Append-Only Audit)
-- Issue E86.5: Staging DB Repair Mechanism
-- Creates append-only audit table for DB repair operations

-- ========================================
-- DB Repair Runs (Append-Only)
-- ========================================
CREATE TABLE db_repair_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_id TEXT NOT NULL,
  expected_hash TEXT NOT NULL,
  actual_hash TEXT NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  executed_by TEXT NOT NULL,
  deployment_env TEXT NOT NULL,
  lawbook_hash TEXT,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  pre_missing_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  post_missing_tables JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT chk_db_repair_run_status CHECK (
    status IN ('SUCCESS', 'FAILED')
  )
);

-- Indexes for efficient queries
CREATE INDEX idx_db_repair_runs_repair_id ON db_repair_runs(repair_id);
CREATE INDEX idx_db_repair_runs_executed_at ON db_repair_runs(executed_at DESC);
CREATE INDEX idx_db_repair_runs_executed_by ON db_repair_runs(executed_by);
CREATE INDEX idx_db_repair_runs_status ON db_repair_runs(status);
CREATE INDEX idx_db_repair_runs_deployment_env ON db_repair_runs(deployment_env);

-- ========================================
-- Append-Only Policy (E86.5 requirement)
-- ========================================
-- Prevent UPDATE and DELETE operations on this table
-- Only INSERT is allowed to maintain audit integrity

CREATE OR REPLACE FUNCTION prevent_db_repair_runs_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'db_repair_runs is append-only: UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_update_db_repair_runs
  BEFORE UPDATE ON db_repair_runs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_db_repair_runs_modification();

CREATE TRIGGER prevent_delete_db_repair_runs
  BEFORE DELETE ON db_repair_runs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_db_repair_runs_modification();
