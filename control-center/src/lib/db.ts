/**
 * Database Connection Pool
 * 
 * Provides PostgreSQL connection management for workflow persistence.
 */

import { Pool, PoolConfig } from 'pg';

let pool: Pool | null = null;

/**
 * Get or create a PostgreSQL connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const shouldUseSsl =
      process.env.DATABASE_SSL === 'true' ||
      process.env.PGSSLMODE?.toLowerCase() === 'require' ||
      ['production', 'staging'].includes(process.env.NODE_ENV || '');

    const sslConfig = shouldUseSsl ? { rejectUnauthorized: false } : undefined;

    const config: PoolConfig = {
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME || 'afu9',
      user: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: sslConfig,
    };

    pool = new Pool(config);

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('[Database] Unexpected error on idle client', err);
    });
  }

  return pool;
}

/**
 * Close the database pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Check if database is available
 */
export async function checkDatabase(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('[Database] Health check failed:', error);
    return false;
  }
}
