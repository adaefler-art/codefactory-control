/**
 * API Route Alias: GET /api/ops/db/migration-parity
 *
 * Backwards-compatible alias for the migration parity report.
 * The canonical route is /api/ops/db/migrations.
 *
 * Note: Avoid "export-from" re-exports here so Next.js can statically
 * recognize route config exports (runtime/dynamic) without build warnings.
 */

import { GET as canonicalGET } from '../migrations/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = canonicalGET;
