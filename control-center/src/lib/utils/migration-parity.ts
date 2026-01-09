/**
 * Migration Parity Utility
 * 
 * Deterministic computation of migration parity between repository and database.
 * All operations produce stable, sorted output for audit-friendly reports.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface MigrationFile {
  filename: string;
  sha256: string;
}

export interface MigrationLedgerEntry {
  filename: string;
  sha256: string;
  applied_at: Date;
}

export interface ParityResult {
  status: 'PASS' | 'FAIL';
  missingInDb: string[];
  extraInDb: string[];
  hashMismatches: Array<{
    filename: string;
    repoHash: string;
    dbHash: string;
  }>;
}

function stripExtension(filename: string): string {
  const base = path.basename(filename);
  return base.replace(/\.[^/.]+$/, '');
}

function normalizeNumericId(value: string): string {
  const digits = value.match(/^\d+/)?.[0];
  if (!digits) return value;
  const asNumber = Number.parseInt(digits, 10);
  return Number.isFinite(asNumber) ? String(asNumber) : digits;
}

export function canonicalizeRepoMigrationId(filename: string): string {
  const base = stripExtension(filename);
  const digits = base.match(/^\d+/)?.[0];
  if (digits) return normalizeNumericId(digits);
  return base;
}

export function canonicalizeDbMigrationId(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (!str) return '';
  const digits = str.match(/^\d+/)?.[0];
  if (digits) return normalizeNumericId(digits);
  return str;
}

/**
 * Compute SHA-256 hash of file contents
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * List all migration files from repository (database/migrations/)
 * Returns sorted array for deterministic output
 */
export function listRepoMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort(); // Lexicographic sort for determinism

  return files.map(filename => ({
    filename,
    sha256: computeFileHash(path.join(migrationsDir, filename)),
  }));
}

/**
 * Compute deterministic parity between repo and DB migrations
 * All arrays are sorted lexicographically for stable output
 */
export function computeParity(
  repoMigrations: MigrationFile[],
  dbMigrations: MigrationLedgerEntry[]
): ParityResult {
  const repoById = new Map(
    repoMigrations.map(m => [canonicalizeRepoMigrationId(m.filename), m])
  );
  const dbById = new Map(
    dbMigrations.map(m => [canonicalizeDbMigrationId(m.filename), m])
  );

  // Create stable, deterministic lists for display.
  const repoDisplayById = new Map(
    repoMigrations
      .map(m => ({ id: canonicalizeRepoMigrationId(m.filename), filename: m.filename }))
      .sort((a, b) => a.filename.localeCompare(b.filename))
      .map(x => [x.id, x.filename])
  );

  const dbDisplayById = new Map(
    dbMigrations
      .map(m => ({ id: canonicalizeDbMigrationId(m.filename), raw: String(m.filename) }))
      .sort((a, b) => a.raw.localeCompare(b.raw))
      .map(x => [x.id, x.raw])
  );

  // Find migrations missing in DB (in repo but not in ledger)
  const missingInDb = Array.from(repoById.keys())
    .filter(id => !dbById.has(id))
    .map(id => repoDisplayById.get(id) || id)
    .sort();

  // Find extra migrations in DB (in ledger but not in repo)
  const extraInDb = Array.from(dbById.keys())
    .filter(id => !repoById.has(id))
    .map(id => dbDisplayById.get(id) || id)
    .sort();

  // Find hash mismatches (same filename but different hash)
  const hashMismatches = Array.from(repoById.keys())
    .filter(id => {
      const repo = repoById.get(id);
      const db = dbById.get(id);
      if (!repo || !db) return false;
      if (!repo.sha256 || !db.sha256) return false;
      return db.sha256 !== repo.sha256;
    })
    .map(id => {
      const repo = repoById.get(id)!;
      const db = dbById.get(id)!;
      return {
        filename: repo.filename,
        repoHash: repo.sha256,
        dbHash: db.sha256,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));

  const status = (missingInDb.length === 0 && extraInDb.length === 0 && hashMismatches.length === 0)
    ? 'PASS'
    : 'FAIL';

  return {
    status,
    missingInDb,
    extraInDb,
    hashMismatches,
  };
}

/**
 * Get latest migration filename from sorted list
 */
export function getLatestMigration(migrations: MigrationFile[]): string | null {
  if (migrations.length === 0) {
    return null;
  }
  
  // Already sorted, return last element
  return migrations[migrations.length - 1].filename;
}
