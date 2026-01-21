-- Migration 083: Loop Runs Persistence (E9.1-CTRL-2)
-- 
-- Adds persistent storage for Loop execution tracking:
-- - loop_runs: immutable run records with status and timestamps
-- - loop_run_steps: individual step execution results
--
-- Intent: Track every loop execution (success, blocked, fail) for audit and replay

-- ========================================
-- Table: loop_runs
-- ========================================

CREATE TABLE IF NOT EXISTS loop_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  request_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('execute', 'dryRun')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB
);

-- Indexes for loop_runs table
CREATE INDEX IF NOT EXISTS loop_runs_issue_id_idx ON loop_runs(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS loop_runs_status_idx ON loop_runs(status);
CREATE INDEX IF NOT EXISTS loop_runs_request_id_idx ON loop_runs(request_id);
CREATE INDEX IF NOT EXISTS loop_runs_created_at_idx ON loop_runs(created_at DESC);

-- ========================================
-- Table: loop_run_steps
-- ========================================

CREATE TABLE IF NOT EXISTS loop_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  step_number INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB,
  
  -- Foreign key constraint
  CONSTRAINT fk_loop_run_steps_run FOREIGN KEY (run_id) REFERENCES loop_runs(id) ON DELETE CASCADE,
  
  -- Unique constraint on run_id + step_number
  CONSTRAINT uq_loop_run_steps_run_step UNIQUE (run_id, step_number)
);

-- Index for loop_run_steps table
CREATE INDEX IF NOT EXISTS loop_run_steps_run_idx ON loop_run_steps(run_id, step_number);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE loop_runs IS 'Loop execution tracking with status and timestamps (E9.1-CTRL-2)';
COMMENT ON TABLE loop_run_steps IS 'Individual step execution results within loop runs';

COMMENT ON COLUMN loop_runs.id IS 'Unique run identifier (UUID)';
COMMENT ON COLUMN loop_runs.issue_id IS 'GitHub issue ID for tracking';
COMMENT ON COLUMN loop_runs.actor IS 'User or system that triggered the run';
COMMENT ON COLUMN loop_runs.request_id IS 'Request ID for traceability';
COMMENT ON COLUMN loop_runs.mode IS 'Execution mode: execute or dryRun';
COMMENT ON COLUMN loop_runs.status IS 'Run status: pending, running, completed, failed, blocked';
COMMENT ON COLUMN loop_runs.metadata IS 'Additional run context and details';

COMMENT ON COLUMN loop_run_steps.step_number IS 'Step number within the run (1-based)';
COMMENT ON COLUMN loop_run_steps.step_type IS 'Type of step being executed';
COMMENT ON COLUMN loop_run_steps.status IS 'Step status: pending, running, completed, failed, skipped';
COMMENT ON COLUMN loop_run_steps.metadata IS 'Additional step context and details';
