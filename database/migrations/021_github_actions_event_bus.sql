-- 021_github_actions_event_bus.sql
-- ========================================
-- AFU-9 GitHub Actions Event Bus (Option 2)
-- ========================================
-- Stores GitHub events published via GitHub Actions into SQS.
-- Provides DB-backed idempotency via delivery_id (unique).

CREATE TABLE IF NOT EXISTS github_action_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_name TEXT,
  repository_full_name TEXT,
  envelope JSONB NOT NULL,
  received_at TIMESTAMP DEFAULT NOW(),
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_github_action_deliveries_received_at
  ON github_action_deliveries(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_action_deliveries_processed_at
  ON github_action_deliveries(processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_action_deliveries_repository
  ON github_action_deliveries(repository_full_name);
