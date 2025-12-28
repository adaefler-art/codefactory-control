-- AFU-9 v0.5 GitHub webhook delivery idempotency
-- PostgreSQL 15+

CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  repository_full_name VARCHAR(255),
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_webhook_deliveries_received_at
  ON github_webhook_deliveries (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_github_webhook_deliveries_event_type
  ON github_webhook_deliveries (event_type);
