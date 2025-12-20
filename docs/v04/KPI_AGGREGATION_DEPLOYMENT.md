# KPI Aggregation Pipeline Deployment Guide

**EPIC:** 3 - KPI System & Telemetry  
**Issue:** 3.2 - KPI Aggregation Pipeline  
**Version:** 1.0.0

## Overview

This guide covers the deployment and operation of the KPI aggregation pipeline, which continuously aggregates metrics from Run → Product → Factory levels.

## Architecture

The KPI aggregation pipeline consists of three components:

1. **KPI Service Functions** (TypeScript) - Core aggregation logic in `control-center/src/lib/kpi-service.ts`
2. **Scheduler Script** (Node.js) - Periodic execution daemon in `scripts/kpi-aggregation-scheduler.js`
3. **API Endpoint** - On-demand triggering via `POST /api/v1/kpi/aggregate`

### Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  KPI Aggregation Pipeline                    │
└─────────────────────────────────────────────────────────────┘

Step 1: Run-Level Aggregation
  workflow_executions → kpi_snapshots (level=run)
  - run_duration (ms)
  - token_usage (tokens)
  - tool_call_success_rate (%)

Step 2: Product-Level Aggregation  
  kpi_snapshots (level=run) → kpi_snapshots (level=product)
  - product_success_rate (%)
  - product_throughput (runs/day)
  - product_avg_duration (ms)

Step 3: Factory-Level Aggregation
  kpi_snapshots (level=product) → kpi_snapshots (level=factory)
  - mtti (ms)
  - success_rate (%)
  - factory_throughput (runs/day)
  - steering_accuracy (%)

Step 4: Materialized View Refresh
  Refresh mv_factory_kpis_24h, mv_product_kpis_7d
```

## Prerequisites

- PostgreSQL database with migration `006_kpi_aggregation.sql` applied
- Node.js 18+ installed
- `DATABASE_URL` environment variable configured

## Installation

### 1. Database Migration

Ensure the KPI aggregation schema is deployed:

```bash
psql $DATABASE_URL -f database/migrations/006_kpi_aggregation.sql
```

This creates:
- `kpi_snapshots` table (time-series storage)
- `verdict_outcomes` table (steering accuracy tracking)
- `kpi_aggregation_jobs` table (job tracking)
- Materialized views for performance
- Helper functions and triggers

### 2. Verify Schema

```sql
-- Check tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE 'kpi_%';

-- Should return:
-- kpi_snapshots
-- kpi_aggregation_jobs
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `KPI_AGGREGATION_INTERVAL_MS` | No | 300000 | Interval between aggregations (5 min) |
| `KPI_AGGREGATION_PERIOD_HOURS` | No | 24 | Period for KPI calculation (24 hours) |

### Example Configuration

```bash
# Production
export DATABASE_URL="postgresql://user:pass@db.example.com:5432/afu9"
export KPI_AGGREGATION_INTERVAL_MS=300000  # 5 minutes
export KPI_AGGREGATION_PERIOD_HOURS=24     # 24 hours

# Development
export DATABASE_URL="postgresql://localhost:5432/afu9_dev"
export KPI_AGGREGATION_INTERVAL_MS=60000   # 1 minute (faster testing)
export KPI_AGGREGATION_PERIOD_HOURS=1      # 1 hour (recent data only)
```

## Deployment

### Option 1: Systemd Service (Production)

Create `/etc/systemd/system/afu9-kpi-scheduler.service`:

```ini
[Unit]
Description=AFU-9 KPI Aggregation Scheduler
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=afu9
Group=afu9
WorkingDirectory=/opt/afu9/codefactory-control
Environment="DATABASE_URL=postgresql://user:pass@localhost:5432/afu9"
Environment="KPI_AGGREGATION_INTERVAL_MS=300000"
Environment="KPI_AGGREGATION_PERIOD_HOURS=24"
ExecStart=/usr/bin/node scripts/kpi-aggregation-scheduler.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=afu9-kpi-scheduler

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable afu9-kpi-scheduler
sudo systemctl start afu9-kpi-scheduler
sudo systemctl status afu9-kpi-scheduler
```

View logs:

```bash
sudo journalctl -u afu9-kpi-scheduler -f
```

### Option 2: Docker Container

Create `Dockerfile.kpi-scheduler`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy scheduler script
COPY scripts/kpi-aggregation-scheduler.js scripts/

# Run scheduler
CMD ["node", "scripts/kpi-aggregation-scheduler.js"]
```

Build and run:

```bash
docker build -f Dockerfile.kpi-scheduler -t afu9-kpi-scheduler .

docker run -d \
  --name afu9-kpi-scheduler \
  --restart unless-stopped \
  -e DATABASE_URL="postgresql://user:pass@db:5432/afu9" \
  -e KPI_AGGREGATION_INTERVAL_MS=300000 \
  -e KPI_AGGREGATION_PERIOD_HOURS=24 \
  afu9-kpi-scheduler

docker logs -f afu9-kpi-scheduler
```

### Option 3: Manual Execution (Development)

```bash
cd /path/to/codefactory-control
export DATABASE_URL="postgresql://localhost:5432/afu9_dev"
node scripts/kpi-aggregation-scheduler.js
```

Press `Ctrl+C` to stop gracefully.

## Monitoring

### Job Status

Check aggregation job history:

```sql
SELECT 
  id,
  job_type,
  status,
  started_at,
  completed_at,
  duration_ms,
  snapshots_created,
  error
FROM kpi_aggregation_jobs
ORDER BY started_at DESC
LIMIT 10;
```

### KPI Freshness

Monitor how current the KPIs are:

```bash
curl http://localhost:3000/api/v1/kpi/freshness
```

Expected output:
```json
{
  "status": "success",
  "data": [
    {
      "kpiName": "mtti",
      "freshnessSeconds": 45,
      "lastCalculatedAt": "2025-12-16T20:00:00.000Z",
      "isFresh": true,
      "status": "fresh"
    }
  ]
}
```

**Alert Conditions:**
- `freshnessSeconds > 300` - KPIs are stale, scheduler may be down
- `status = "stale"` - KPIs haven't been updated recently

### Scheduler Health

The scheduler logs its status regularly:

```
[KPI Scheduler] Starting aggregation pipeline at 2025-12-16T20:00:00.000Z
[KPI Scheduler] Period: 2025-12-15T20:00:00.000Z to 2025-12-16T20:00:00.000Z
[KPI Scheduler] Processing 12 run-level aggregations
[KPI Scheduler] Processing 3 product-level aggregations
[KPI Scheduler] Processing factory-level aggregation
[KPI Scheduler] Materialized views refreshed
[KPI Scheduler] ✅ Aggregation completed: 42 snapshots in 3250ms
```

Look for:
- ✅ Regular completion messages every 5 minutes
- ❌ Error messages indicating failures
- ⚠️  Long durations (> 30 seconds) indicating performance issues

## Operations

### Manual Trigger

Trigger aggregation on-demand via API:

```bash
curl -X POST http://localhost:3000/api/v1/kpi/aggregate \
  -H "Content-Type: application/json" \
  -d '{"periodHours": 24}'
```

### Backfilling Historical Data

To backfill KPIs for a specific period:

```bash
# Aggregate last 7 days
curl -X POST http://localhost:3000/api/v1/kpi/aggregate \
  -H "Content-Type: application/json" \
  -d '{"periodHours": 168}'
```

**Note:** The aggregation is idempotent - it won't create duplicate snapshots for already-aggregated runs.

### Stop Scheduler Gracefully

The scheduler handles `SIGTERM` and `SIGINT` signals:

```bash
# Systemd
sudo systemctl stop afu9-kpi-scheduler

# Docker
docker stop afu9-kpi-scheduler

# Manual
# Press Ctrl+C
```

Graceful shutdown:
1. Stops accepting new aggregation cycles
2. Waits for current aggregation to complete (max 60 seconds)
3. Closes database connections
4. Exits cleanly

## Troubleshooting

### Scheduler Not Starting

**Symptom:** Service fails to start

**Check:**
```bash
# Verify DATABASE_URL is set
echo $DATABASE_URL

# Test database connection
psql $DATABASE_URL -c "SELECT NOW();"

# Check Node.js version
node --version  # Should be 18+
```

### No KPI Snapshots Created

**Symptom:** `snapshotsCreated: 0` in every job

**Causes:**
1. No workflow executions in period
2. Executions already aggregated
3. Executions not in terminal state

**Check:**
```sql
-- Check for executions in period
SELECT COUNT(*) 
FROM workflow_executions
WHERE status IN ('completed', 'failed')
  AND completed_at >= NOW() - INTERVAL '24 hours';

-- Check if already aggregated
SELECT COUNT(*) 
FROM kpi_snapshots
WHERE level = 'run'
  AND calculated_at >= NOW() - INTERVAL '24 hours';
```

### Aggregation Taking Too Long

**Symptom:** `duration_ms > 30000` in job logs

**Solutions:**
1. Add database indexes (should already exist from migration)
2. Reduce `KPI_AGGREGATION_PERIOD_HOURS`
3. Limit runs processed per cycle (modify scheduler limit from 100)
4. Archive old data to reduce table size

**Check indexes:**
```sql
SELECT indexname 
FROM pg_indexes 
WHERE tablename IN ('kpi_snapshots', 'workflow_executions');
```

### Scheduler Crashes

**Symptom:** Service repeatedly restarts

**Check logs:**
```bash
# Systemd
sudo journalctl -u afu9-kpi-scheduler -n 100

# Docker
docker logs afu9-kpi-scheduler --tail 100
```

**Common causes:**
- Database connection lost → Check network/credentials
- Out of memory → Reduce period or add RAM
- Unhandled errors → Report bug with logs

## Performance Tuning

### Recommended Settings by Scale

| Scale | Executions/Day | Interval | Period | Expected Duration |
|-------|----------------|----------|--------|-------------------|
| Small | < 100 | 5 min | 24h | < 5s |
| Medium | 100-1000 | 5 min | 24h | 5-15s |
| Large | 1000-10000 | 3 min | 12h | 15-30s |
| XLarge | > 10000 | 1 min | 6h | 30-60s |

### Database Optimization

```sql
-- Vacuum and analyze regularly
VACUUM ANALYZE kpi_snapshots;
VACUUM ANALYZE workflow_executions;

-- Check table sizes
SELECT 
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
WHERE relname LIKE 'kpi_%' OR relname = 'workflow_executions'
ORDER BY pg_total_relation_size(relid) DESC;
```

### Data Retention

Implement retention policy to prevent unbounded growth:

```sql
-- Archive snapshots older than 90 days
DELETE FROM kpi_snapshots
WHERE calculated_at < NOW() - INTERVAL '90 days'
  AND level IN ('run', 'product');

-- Keep factory-level longer (2 years)
DELETE FROM kpi_snapshots
WHERE calculated_at < NOW() - INTERVAL '2 years'
  AND level = 'factory';
```

## Related Documentation

- [KPI Definitions](./KPI_DEFINITIONS.md) - Canonical KPI definitions
- [KPI API](./KPI_API.md) - REST API documentation
- [KPI Governance](./KPI_GOVERNANCE.md) - Change management process
- [Observability](./OBSERVABILITY.md) - Complete observability guide

## Support

For issues with the KPI aggregation pipeline:
1. Check logs for error messages
2. Verify database connectivity
3. Review job status in `kpi_aggregation_jobs` table
4. Check KPI freshness via API
5. Consult troubleshooting section above

---

_End of KPI Aggregation Pipeline Deployment Guide v1.0.0_
