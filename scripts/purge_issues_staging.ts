/*
 * Purge AFU-9 issues from STAGING ONLY.
 *
 * This script is intentionally defensive:
 * - Requires AFU9_STAGE=staging OR NODE_ENV=staging
 * - Supports DryRun (default) and Delete modes
 * - In Delete mode: deletes in chunks inside transactions and writes a backup JSON export
 */

import { mkdirSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool, closePool } from '../control-center/src/lib/db';

type Mode = 'DryRun' | 'Delete';

type Options = {
  mode: Mode;
  olderThanDays: number;
  source?: string;
  status?: string;
  titleContains?: string;
  publicId?: string;
  id?: string;
  confirm: boolean;
};

function requireStagingGate(): void {
  const afu9Stage = String(process.env.AFU9_STAGE || '').trim();
  const nodeEnv = String(process.env.NODE_ENV || '').trim();

  if (afu9Stage !== 'staging' && nodeEnv !== 'staging') {
    throw new Error(
      `Refusing to run: staging gate not satisfied. Set AFU9_STAGE=staging or NODE_ENV=staging. (AFU9_STAGE=${afu9Stage || '<unset>'}, NODE_ENV=${nodeEnv || '<unset>'})`
    );
  }
}

function parseArgs(argv: string[]): Options {
  // Simple "--flag value" parser. We intentionally do not support "--flag=value" to keep behavior predictable.
  const map = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      map.set(key, true);
      continue;
    }

    map.set(key, next);
    index++;
  }

  const modeRaw = String(map.get('mode') ?? 'DryRun');
  const mode: Mode = modeRaw === 'Delete' ? 'Delete' : 'DryRun';

  const olderThanDaysRaw = String(map.get('olderThanDays') ?? '14');
  const olderThanDays = Number.parseInt(olderThanDaysRaw, 10);
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
    throw new Error(`Invalid --olderThanDays: ${olderThanDaysRaw}`);
  }

  const confirm = map.get('confirm') === true || String(map.get('confirm') ?? '').toLowerCase() === 'true';

  const source = typeof map.get('source') === 'string' ? String(map.get('source')) : 'afu9';
  const status = typeof map.get('status') === 'string' ? String(map.get('status')) : undefined;
  const titleContains = typeof map.get('titleContains') === 'string' ? String(map.get('titleContains')) : undefined;
  const publicId = typeof map.get('publicId') === 'string' ? String(map.get('publicId')) : undefined;
  const id = typeof map.get('id') === 'string' ? String(map.get('id')) : undefined;

  if (id && publicId) {
    throw new Error('Provide only one of --id or --publicId');
  }

  return {
    mode,
    olderThanDays,
    source,
    status,
    titleContains,
    publicId,
    id,
    confirm,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isShortHex8(value: string): boolean {
  return /^[0-9a-f]{8}$/i.test(value);
}

function buildWhereClause(options: Options): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Mandatory age filter
  params.push(options.olderThanDays);
  conditions.push(`created_at < NOW() - ($${params.length}::int * INTERVAL '1 day')`);

  if (options.source) {
    params.push(options.source);
    conditions.push(`source = $${params.length}`);
  }

  if (options.status) {
    params.push(options.status);
    conditions.push(`status = $${params.length}`);
  }

  if (options.titleContains) {
    params.push(`%${options.titleContains}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }

  if (options.publicId) {
    if (!isShortHex8(options.publicId)) {
      throw new Error(`Invalid --publicId (expected 8 hex chars): ${options.publicId}`);
    }
    params.push(options.publicId);
    conditions.push(`LOWER(LEFT(id::text, 8)) = LOWER($${params.length})`);
  }

  if (options.id) {
    if (!isUuid(options.id)) {
      throw new Error(`Invalid --id (expected UUID): ${options.id}`);
    }
    params.push(options.id);
    conditions.push(`id = $${params.length}::uuid`);
  }

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

async function listReferencingFks(): Promise<
  Array<{ table: string; column: string; onDelete: string; constraint: string }>
> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Find foreign keys that reference afu9_issues(id)
    const result = await client.query<{
      constraint_name: string;
      table_name: string;
      column_name: string;
      delete_rule: string;
    }>(
      `SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
       AND tc.table_schema = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'afu9_issues'
        AND ccu.column_name = 'id'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name`
    );

    return result.rows.map((row) => ({
      table: row.table_name,
      column: row.column_name,
      onDelete: row.delete_rule,
      constraint: row.constraint_name,
    }));
  } finally {
    client.release();
  }
}

function makeTimestampForFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}_` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}`
  );
}

async function main(): Promise<void> {
  requireStagingGate();

  const options = parseArgs(process.argv.slice(2));

  if (options.mode === 'Delete' && !options.confirm) {
    throw new Error('Refusing to delete without --confirm true');
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const chunkSize = 500;

  const { sql: whereSql, params } = buildWhereClause(options);

  console.log('[purge_issues_staging] Starting', {
    runId,
    startedAt,
    mode: options.mode,
    olderThanDays: options.olderThanDays,
    filters: {
      source: options.source,
      status: options.status,
      titleContains: options.titleContains,
      publicId: options.publicId,
      id: options.id,
    },
  });

  const fks = await listReferencingFks();
  if (fks.length > 0) {
    console.log('[purge_issues_staging] Referencing foreign keys detected:', fks);
  } else {
    console.log('[purge_issues_staging] No referencing foreign keys detected (information_schema)');
  }

  if (options.mode === 'Delete') {
    const nonCascade = fks.filter((fk) => fk.onDelete.toUpperCase() !== 'CASCADE');
    if (nonCascade.length > 0) {
      throw new Error(
        `Refusing to delete because some referencing FKs are not CASCADE: ${JSON.stringify(nonCascade)}`
      );
    }
  }

  const pool = getPool();
  const client = await pool.connect();

  const deletedIds: string[] = [];

  const artifactsDir = path.resolve(process.cwd(), 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  try {
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM afu9_issues ${whereSql}`,
      params
    );

    const total = Number.parseInt(countResult.rows[0]?.count ?? '0', 10);

    const sampleResult = await client.query<{
      id: string;
      publicid: string;
      title: string;
      status: string;
      created_at: string;
    }>(
      `SELECT
        id,
        LOWER(LEFT(id::text, 8)) as publicId,
        title,
        status,
        created_at
      FROM afu9_issues
      ${whereSql}
      ORDER BY created_at ASC, id ASC
      LIMIT 20`,
      params
    );

    console.log('[purge_issues_staging] Preview', {
      total,
      sample: sampleResult.rows,
    });

    if (options.mode === 'DryRun') {
      return;
    }

    const backupPath = path.resolve(
      artifactsDir,
      `purge_issues_${makeTimestampForFilename()}_${runId}.json`
    );

    console.log('[purge_issues_staging] Delete mode enabled', {
      runId,
      backupPath,
      chunkSize,
    });

    const stream = createWriteStream(backupPath, { encoding: 'utf8' });
    stream.write('[');
    let wroteAny = false;

    let deletedTotal = 0;
    let chunkIndex = 0;

    while (true) {
      chunkIndex += 1;

      await client.query('BEGIN');
      try {
        const deleteResult = await client.query<any>(
          `WITH candidates AS (
            SELECT id
            FROM afu9_issues
            ${whereSql}
            ORDER BY created_at ASC, id ASC
            LIMIT ${chunkSize}
          )
          DELETE FROM afu9_issues i
          USING candidates c
          WHERE i.id = c.id
          RETURNING i.*`,
          params
        );

        const rows = deleteResult.rows ?? [];
        if (rows.length === 0) {
          await client.query('COMMIT');
          break;
        }

        for (const row of rows) {
          const json = JSON.stringify({
            ...row,
            publicId: typeof row?.id === 'string' ? String(row.id).slice(0, 8).toLowerCase() : null,
          });
          if (wroteAny) stream.write(',');
          stream.write(json);
          wroteAny = true;

          if (typeof row?.id === 'string') {
            deletedIds.push(row.id);
          }
        }

        deletedTotal += rows.length;

        await client.query('COMMIT');

        console.log('[purge_issues_staging] Deleted chunk', {
          runId,
          chunkIndex,
          deletedChunk: rows.length,
          deletedTotal,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    stream.write(']');
    stream.end();

    const remainingResult = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM afu9_issues ${whereSql}`,
      params
    );

    const remaining = Number.parseInt(remainingResult.rows[0]?.count ?? '0', 10);

    console.log('[purge_issues_staging] Delete complete', {
      runId,
      initialMatched: total,
      deletedTotal,
      remainingMatched: remaining,
      backupPath,
    });

    // Optional referential integrity check (bounded)
    if (deletedIds.length > 0 && deletedIds.length <= 5000) {
      const eventCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM afu9_issue_events WHERE issue_id = ANY($1::uuid[])`,
        [deletedIds]
      );
      console.log('[purge_issues_staging] Referential integrity check', {
        runId,
        checkedIssueIds: deletedIds.length,
        remainingEventRowsForDeletedIssues: Number.parseInt(eventCount.rows[0]?.count ?? '0', 10),
      });
    } else if (deletedIds.length > 5000) {
      console.log('[purge_issues_staging] Skipping referential integrity check (too many IDs)', {
        runId,
        deletedIds: deletedIds.length,
      });
    }
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((err) => {
  const anyErr = err as any;
  console.error('[purge_issues_staging] Failed', {
    name: anyErr?.name,
    message: anyErr?.message,
    code: anyErr?.code,
    detail: anyErr?.detail,
    hint: anyErr?.hint,
    stack: anyErr?.stack,
    toString: String(err),
  });
  process.exitCode = 1;
});
