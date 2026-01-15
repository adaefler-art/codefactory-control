-- Migration: 072_capabilities_registry.sql
-- E89.8: Capabilities Registry + "Tools" UI
--
-- Creates append-only audit log for capability probes and a view for latest status.
-- Enables operators to see what INTENT can do: tools/capabilities, status, health, versioned manifest.
--
-- Tables:
--   afu9_capability_probes: Append-only probe results (audit trail)
--   afu9_capability_manifest_view: Materialized view of latest probe status per capability
--
-- Security:
--   - No PII
--   - Append-only audit (no updates/deletes)
--   - Read-only queries for dashboard

-- ============================================================================
-- Table: afu9_capability_probes
-- ============================================================================
-- Append-only audit log of all capability health probes
-- Each probe checks a tool/MCP endpoint and records status
CREATE TABLE IF NOT EXISTS afu9_capability_probes (
  probe_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_name   TEXT NOT NULL,           -- e.g., "github.list_repos", "deploy.trigger_deployment"
  capability_kind   TEXT NOT NULL,           -- 'tool' | 'mcp_tool' | 'feature_flag' | 'constraint'
  capability_source TEXT NOT NULL,           -- 'intent_registry' | 'mcp' | 'flags' | 'lawbook'
  
  -- Probe execution metadata
  probed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  probe_status      TEXT NOT NULL,           -- 'ok' | 'error' | 'timeout' | 'unreachable'
  response_time_ms  INTEGER,                 -- Latency in milliseconds (null if failed)
  
  -- Error details (bounded)
  error_message     TEXT,                    -- Max 500 chars, truncated if needed
  error_code        TEXT,                    -- Optional error code
  
  -- Capability metadata snapshot at probe time
  enabled           BOOLEAN NOT NULL,        -- Was capability enabled at probe time?
  requires_approval BOOLEAN DEFAULT FALSE,   -- Does capability require approval?
  version           TEXT,                    -- Version/contract version if applicable
  
  -- Indexing
  CONSTRAINT valid_probe_status CHECK (probe_status IN ('ok', 'error', 'timeout', 'unreachable')),
  CONSTRAINT valid_capability_kind CHECK (capability_kind IN ('tool', 'mcp_tool', 'feature_flag', 'constraint')),
  CONSTRAINT valid_capability_source CHECK (capability_source IN ('intent_registry', 'mcp', 'flags', 'lawbook'))
);

-- Index for querying latest probe by capability
CREATE INDEX idx_capability_probes_latest 
  ON afu9_capability_probes (capability_name, probed_at DESC);

-- Index for filtering by status
CREATE INDEX idx_capability_probes_status 
  ON afu9_capability_probes (probe_status, probed_at DESC);

-- Index for time-range queries
CREATE INDEX idx_capability_probes_time 
  ON afu9_capability_probes (probed_at DESC);

-- ============================================================================
-- View: afu9_capability_manifest_view
-- ============================================================================
-- Latest probe status for each capability
-- This is a VIEW (not materialized) to always show current state
-- Query optimized with index on (capability_name, probed_at DESC)
CREATE OR REPLACE VIEW afu9_capability_manifest_view AS
SELECT DISTINCT ON (capability_name)
  capability_name,
  capability_kind,
  capability_source,
  probed_at AS last_probe_at,
  probe_status AS last_probe_status,
  response_time_ms AS last_probe_latency_ms,
  error_message AS last_probe_error,
  error_code AS last_probe_error_code,
  enabled,
  requires_approval,
  version
FROM afu9_capability_probes
ORDER BY capability_name, probed_at DESC;

-- Add comment for documentation
COMMENT ON TABLE afu9_capability_probes IS 
  'E89.8: Append-only audit log of capability health probes. Tracks tool/MCP availability over time.';

COMMENT ON VIEW afu9_capability_manifest_view IS 
  'E89.8: Latest probe status per capability. Used by Tools UI to show current health.';
