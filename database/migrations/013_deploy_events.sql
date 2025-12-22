-- AFU-9 v0.2 Deploy Events (DB roundtrip smoke)
-- PostgreSQL 15+

-- ========================================
-- Deploy Events
-- ========================================

CREATE TABLE deploy_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  env TEXT NOT NULL,
  service TEXT NOT NULL,
  version TEXT NOT NULL,
  commit_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT
);

-- Minimal index for efficiently listing newest events first
CREATE INDEX idx_deploy_events_created_at_desc ON deploy_events(created_at DESC);
