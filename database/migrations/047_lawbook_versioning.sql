-- Migration 047: Lawbook Versioning (E79.1 / I791)
--
-- Versioned, immutable, auditable Lawbook (guardrails/rules document)
-- with active pointer and deny-by-default semantics.
--
-- Features:
-- - Immutable lawbook versions (never change once created)
-- - Deterministic hashing (same content → same lawbook_hash)
-- - Active pointer for current enforcement version
-- - Audit trail for activation changes
-- - Idempotency via lawbook_hash uniqueness
--
-- Non-Negotiables:
-- - Immutability: published versions never change
-- - Deny-by-default: missing/invalid lawbook → gates deny
-- - Deterministic: same content → same hash
-- - Transparency: lawbookVersion in all verdicts/reports

-- ========================================
-- Table: lawbook_versions
-- ========================================

CREATE TABLE IF NOT EXISTS lawbook_versions (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Lawbook identification
  lawbook_id TEXT NOT NULL,                    -- e.g. "AFU9-LAWBOOK"
  lawbook_version TEXT NOT NULL,               -- e.g. "2025-12-30.1"
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL CHECK (created_by IN ('admin', 'system')),
  
  -- Lawbook content (immutable)
  lawbook_json JSONB NOT NULL,
  
  -- Deterministic hash (SHA-256 of canonical JSON)
  lawbook_hash TEXT NOT NULL,
  
  -- Schema version tracking
  schema_version TEXT NOT NULL DEFAULT '0.7.0',
  
  -- Constraints
  CONSTRAINT valid_lawbook_id CHECK (lawbook_id ~ '^[A-Z0-9_-]+$'),
  CONSTRAINT valid_lawbook_version CHECK (lawbook_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'),
  CONSTRAINT valid_lawbook_json CHECK (jsonb_typeof(lawbook_json) = 'object'),
  CONSTRAINT valid_lawbook_hash CHECK (lawbook_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT valid_schema_version CHECK (schema_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

-- Unique: (lawbook_id, lawbook_version) - no duplicate versions
CREATE UNIQUE INDEX IF NOT EXISTS lawbook_versions_id_version_idx
  ON lawbook_versions(lawbook_id, lawbook_version);

-- Unique: lawbook_hash - same content can't exist twice (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS lawbook_versions_hash_idx
  ON lawbook_versions(lawbook_hash);

-- Index for querying by lawbook_id (list versions)
CREATE INDEX IF NOT EXISTS lawbook_versions_lawbook_id_idx
  ON lawbook_versions(lawbook_id, created_at DESC);

-- Index for creation time queries
CREATE INDEX IF NOT EXISTS lawbook_versions_created_at_idx
  ON lawbook_versions(created_at DESC);

-- GIN index on lawbook_json for JSONB queries
CREATE INDEX IF NOT EXISTS lawbook_versions_json_idx
  ON lawbook_versions USING GIN(lawbook_json);

-- ========================================
-- Table: lawbook_active
-- ========================================

CREATE TABLE IF NOT EXISTS lawbook_active (
  -- Identity (one row per lawbook_id)
  lawbook_id TEXT PRIMARY KEY,
  
  -- Active version pointer
  active_lawbook_version_id UUID NOT NULL REFERENCES lawbook_versions(id) ON DELETE RESTRICT,
  
  -- Timestamps
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_active_lawbook_id CHECK (lawbook_id ~ '^[A-Z0-9_-]+$')
);

-- Index for FK lookup
CREATE INDEX IF NOT EXISTS lawbook_active_version_id_idx
  ON lawbook_active(active_lawbook_version_id);

-- ========================================
-- Table: lawbook_events (audit trail)
-- ========================================

CREATE TABLE IF NOT EXISTS lawbook_events (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Event classification
  event_type TEXT NOT NULL CHECK (event_type IN ('version_created', 'version_activated', 'version_deactivated')),
  
  -- Lawbook reference
  lawbook_id TEXT NOT NULL,
  lawbook_version_id UUID REFERENCES lawbook_versions(id) ON DELETE CASCADE,
  
  -- Event metadata
  event_json JSONB NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL CHECK (created_by IN ('admin', 'system', 'api')),
  
  -- Constraints
  CONSTRAINT valid_event_json CHECK (jsonb_typeof(event_json) = 'object')
);

-- Index for querying events by lawbook_id
CREATE INDEX IF NOT EXISTS lawbook_events_lawbook_id_idx
  ON lawbook_events(lawbook_id, created_at DESC);

-- Index for querying events by version
CREATE INDEX IF NOT EXISTS lawbook_events_version_id_idx
  ON lawbook_events(lawbook_version_id, created_at DESC);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS lawbook_events_type_idx
  ON lawbook_events(event_type, created_at DESC);

-- GIN index on event_json
CREATE INDEX IF NOT EXISTS lawbook_events_json_idx
  ON lawbook_events USING GIN(event_json);

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE lawbook_versions IS 'Immutable lawbook versions (E79.1/I791)';
COMMENT ON COLUMN lawbook_versions.lawbook_id IS 'Lawbook identifier (e.g. AFU9-LAWBOOK)';
COMMENT ON COLUMN lawbook_versions.lawbook_version IS 'Version string (YYYY-MM-DD.N format)';
COMMENT ON COLUMN lawbook_versions.lawbook_json IS 'Immutable lawbook JSON (v0.7.0 schema)';
COMMENT ON COLUMN lawbook_versions.lawbook_hash IS 'SHA-256 hash of canonical JSON (deterministic)';
COMMENT ON COLUMN lawbook_versions.schema_version IS 'Lawbook schema version (e.g. 0.7.0)';

COMMENT ON TABLE lawbook_active IS 'Active lawbook pointer (one per lawbook_id)';
COMMENT ON COLUMN lawbook_active.active_lawbook_version_id IS 'Currently active lawbook version';

COMMENT ON TABLE lawbook_events IS 'Lawbook audit trail (append-only)';
COMMENT ON COLUMN lawbook_events.event_type IS 'Event type: version_created, version_activated, version_deactivated';
COMMENT ON COLUMN lawbook_events.event_json IS 'Event metadata JSON';
