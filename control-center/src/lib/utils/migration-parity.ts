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
  const repoMap = new Map(repoMigrations.map(m => [m.filename, m.sha256]));
  const dbMap = new Map(dbMigrations.map(m => [m.filename, m.sha256]));

  // Find migrations missing in DB (in repo but not in ledger)
  const missingInDb = Array.from(repoMap.keys())
    .filter(filename => !dbMap.has(filename))
    .sort();

  // Find extra migrations in DB (in ledger but not in repo)
  const extraInDb = Array.from(dbMap.keys())
    .filter(filename => !repoMap.has(filename))
    .sort();

  // Find hash mismatches (same filename but different hash)
  const hashMismatches = Array.from(repoMap.keys())
    .filter(filename => {
      const dbHash = dbMap.get(filename);
      return dbHash && dbHash !== repoMap.get(filename);
    })
    .map(filename => ({
      filename,
      repoHash: repoMap.get(filename)!,
      dbHash: dbMap.get(filename)!,
    }))
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
