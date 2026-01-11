-- Migration 058: Create AFU-9 migrations ledger table
--
-- Purpose:
--   Canonical, append-only ledger for AFU-9 migration tracking.
--   This replaces reliance on legacy schema_migrations shapes.
--
-- Notes:
--   - Idempotent and safe to run multiple times.
--   - Enforces append-only behavior via UPDATE/DELETE-deny triggers.
--
-- Date: 2026-01-11

CREATE TABLE IF NOT EXISTS afu9_migrations_ledger (
    filename TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by TEXT,
    runner_version TEXT
);

-- Index for querying by applied_at (for getLastAppliedAfu9Migration)
CREATE INDEX IF NOT EXISTS idx_afu9_migrations_ledger_applied_at
    ON afu9_migrations_ledger(applied_at DESC);

-- Append-only enforcement
CREATE OR REPLACE FUNCTION afu9_migrations_ledger_deny_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'afu9_migrations_ledger is append-only: % is not allowed', TG_OP;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'trg_afu9_migrations_ledger_no_update'
      AND t.tgrelid = 'afu9_migrations_ledger'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_afu9_migrations_ledger_no_update
             BEFORE UPDATE ON afu9_migrations_ledger
             FOR EACH ROW
             EXECUTE FUNCTION afu9_migrations_ledger_deny_mutations()';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'trg_afu9_migrations_ledger_no_delete'
      AND t.tgrelid = 'afu9_migrations_ledger'::regclass
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_afu9_migrations_ledger_no_delete
             BEFORE DELETE ON afu9_migrations_ledger
             FOR EACH ROW
             EXECUTE FUNCTION afu9_migrations_ledger_deny_mutations()';
  END IF;
END $$;

-- Comments
COMMENT ON TABLE afu9_migrations_ledger IS 'Canonical, append-only ledger for tracking AFU-9 database migrations';
COMMENT ON COLUMN afu9_migrations_ledger.filename IS 'Migration filename (e.g., 001_initial_schema.sql)';
COMMENT ON COLUMN afu9_migrations_ledger.sha256 IS 'SHA-256 hash of migration file content for integrity verification';
COMMENT ON COLUMN afu9_migrations_ledger.applied_at IS 'Timestamp when migration was applied';
COMMENT ON COLUMN afu9_migrations_ledger.applied_by IS 'Optional: identity of the runner/operator that applied the migration';
COMMENT ON COLUMN afu9_migrations_ledger.runner_version IS 'Optional: runner version identifier for audit/debug';
