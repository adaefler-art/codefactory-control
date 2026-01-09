/**
 * API Route Alias: GET /api/ops/db/migration-parity
 *
 * Backwards-compatible alias for the migration parity report.
 * The canonical route is /api/ops/db/migrations.
 */

export { runtime, dynamic, GET } from '../migrations/route';
