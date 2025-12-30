-- Migration 026: AFU-9 Runs Ledger (E63.2 / I632)
-- 
-- Adds persistent storage for AFU-9 runner executions:
-- - runs: immutable run records with spec and result
-- - run_steps: individual step execution results
-- - run_artifacts: artifact metadata (logs, files)
--
-- Stability: Supports deterministic playbook IDs and immutable runs with re-run via parentRunId

-- ========================================
-- Table: runs
-- ========================================

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  issue_id TEXT,
  title TEXT NOT NULL,
  playbook_id TEXT,
  parent_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  spec_json JSONB NOT NULL,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  
  -- Foreign key constraint for parent runs
  CONSTRAINT fk_parent_run FOREIGN KEY (parent_run_id) REFERENCES runs(id) ON DELETE SET NULL
);

-- Indexes for runs table
CREATE INDEX IF NOT EXISTS runs_issue_id_idx ON runs(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
CREATE INDEX IF NOT EXISTS runs_parent_idx ON runs(parent_run_id);
CREATE INDEX IF NOT EXISTS runs_playbook_idx ON runs(playbook_id);
CREATE INDEX IF NOT EXISTS runs_created_at_idx ON runs(created_at DESC);

-- ========================================
-- Table: run_steps
-- ========================================

CREATE TABLE IF NOT EXISTS run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  exit_code INTEGER,
  duration_ms INTEGER,
  stdout_tail TEXT,
  stderr_tail TEXT,
  
  -- Foreign key constraint
  CONSTRAINT fk_run_steps_run FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  
  -- Unique constraint on run_id + idx
  CONSTRAINT uq_run_steps_run_idx UNIQUE (run_id, idx)
);

-- Index for run_steps table
CREATE INDEX IF NOT EXISTS run_steps_run_idx ON run_steps(run_id, idx);

-- ========================================
-- Table: run_artifacts
-- ========================================

CREATE TABLE IF NOT EXISTS run_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  step_idx INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'file')),
  name TEXT NOT NULL,
  ref TEXT NOT NULL,
  bytes INTEGER,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Foreign key constraint
  CONSTRAINT fk_run_artifacts_run FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

-- Index for run_artifacts table
CREATE INDEX IF NOT EXISTS run_artifacts_run_idx ON run_artifacts(run_id);
CREATE INDEX IF NOT EXISTS run_artifacts_kind_idx ON run_artifacts(kind);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE runs IS 'AFU-9 run executions with immutable specs and status tracking';
COMMENT ON TABLE run_steps IS 'Individual step execution results within runs';
COMMENT ON TABLE run_artifacts IS 'Artifact metadata for run outputs (logs, files)';

COMMENT ON COLUMN runs.id IS 'Unique run identifier (UUID or custom ID)';
COMMENT ON COLUMN runs.issue_id IS 'Optional GitHub issue ID for tracking';
COMMENT ON COLUMN runs.playbook_id IS 'Deterministic playbook identifier';
COMMENT ON COLUMN runs.parent_run_id IS 'Parent run ID for re-runs';
COMMENT ON COLUMN runs.spec_json IS 'Validated RunSpec (immutable)';
COMMENT ON COLUMN runs.result_json IS 'Optional cached minimal RunResult summary';

COMMENT ON COLUMN run_steps.idx IS 'Step index within the run (0-based)';
COMMENT ON COLUMN run_steps.stdout_tail IS 'Last N characters of stdout (capped at 4000)';
COMMENT ON COLUMN run_steps.stderr_tail IS 'Last N characters of stderr (capped at 4000)';

COMMENT ON COLUMN run_artifacts.kind IS 'Artifact type: log or file';
COMMENT ON COLUMN run_artifacts.ref IS 'Storage reference (s3://, db://, or inline key)';
COMMENT ON COLUMN run_artifacts.step_idx IS 'Optional step index this artifact belongs to';
