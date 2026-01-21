-- Migration 084: Loop Locks and Idempotency (E9.1-CTRL-3)
-- 
-- Adds locking and idempotency support for Loop execution:
-- - loop_locks: distributed locks to prevent concurrent execution
-- - loop_idempotency: replay cache for deterministic re-execution
--
-- Intent: No race conditions, no double execution. Fail-closed.

-- ========================================
-- Table: loop_locks
-- ========================================

CREATE TABLE IF NOT EXISTS loop_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key TEXT NOT NULL UNIQUE,
  locked_by TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  request_id TEXT NOT NULL,
  metadata JSONB
);

-- Index for loop_locks table
CREATE INDEX IF NOT EXISTS loop_locks_lock_key_idx ON loop_locks(lock_key);
CREATE INDEX IF NOT EXISTS loop_locks_expires_at_idx ON loop_locks(expires_at);

-- ========================================
-- Table: loop_idempotency
-- ========================================

CREATE TABLE IF NOT EXISTS loop_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  run_id UUID,
  response_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB
);

-- Index for loop_idempotency table
CREATE INDEX IF NOT EXISTS loop_idempotency_key_idx ON loop_idempotency(idempotency_key);
CREATE INDEX IF NOT EXISTS loop_idempotency_expires_at_idx ON loop_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS loop_idempotency_run_id_idx ON loop_idempotency(run_id);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE loop_locks IS 'Distributed locks for loop execution to prevent race conditions (E9.1-CTRL-3)';
COMMENT ON TABLE loop_idempotency IS 'Idempotency cache for deterministic replay of loop executions (E9.1-CTRL-3)';

COMMENT ON COLUMN loop_locks.lock_key IS 'Unique lock identifier derived from execution parameters';
COMMENT ON COLUMN loop_locks.locked_by IS 'Actor who acquired the lock';
COMMENT ON COLUMN loop_locks.expires_at IS 'Lock expiration time (TTL)';
COMMENT ON COLUMN loop_locks.request_id IS 'Request ID for traceability';

COMMENT ON COLUMN loop_idempotency.idempotency_key IS 'Stable hash of execution parameters {issueId, step, mode, actorId}';
COMMENT ON COLUMN loop_idempotency.run_id IS 'Reference to the loop_runs record';
COMMENT ON COLUMN loop_idempotency.response_data IS 'Cached response for replay';
COMMENT ON COLUMN loop_idempotency.expires_at IS 'Cache expiration time (TTL)';
