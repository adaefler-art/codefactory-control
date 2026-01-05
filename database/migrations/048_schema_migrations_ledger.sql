-- Migration: Create schema_migrations ledger table
-- Purpose: Track applied migrations for parity checks (E80.1)
-- Date: 2026-01-05

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by applied_at (for getLastAppliedMigration)
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
    ON schema_migrations(applied_at DESC);

-- Comment on table
COMMENT ON TABLE schema_migrations IS 'Migration ledger for tracking applied database migrations';
COMMENT ON COLUMN schema_migrations.filename IS 'Migration filename (e.g., 001_initial_schema.sql)';
COMMENT ON COLUMN schema_migrations.sha256 IS 'SHA-256 hash of migration file content for integrity verification';
COMMENT ON COLUMN schema_migrations.applied_at IS 'Timestamp when migration was applied';
