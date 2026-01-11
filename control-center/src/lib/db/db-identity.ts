import { Pool } from 'pg';

export type DbIdentity = {
  current_database: string;
  current_schema: string;
  inet_server_addr: string | null;
  inet_server_port: number | null;
};

export async function getDbIdentity(pool: Pool): Promise<DbIdentity> {
  try {
    const result = await pool.query<DbIdentity>(
      `SELECT
         current_database()::text AS current_database,
         current_schema()::text AS current_schema,
         inet_server_addr()::text AS inet_server_addr,
         inet_server_port()::int AS inet_server_port`
    );

    const row = result.rows?.[0];
    return {
      current_database: String(row?.current_database || ''),
      current_schema: String(row?.current_schema || ''),
      inet_server_addr: row?.inet_server_addr ? String(row.inet_server_addr) : null,
      inet_server_port:
        typeof row?.inet_server_port === 'number'
          ? row.inet_server_port
          : row?.inet_server_port
            ? Number(row.inet_server_port)
            : null,
    };
  } catch (error) {
    console.error('[DB Identity] Failed to query database identity:', error);
    return {
      current_database: '',
      current_schema: '',
      inet_server_addr: null,
      inet_server_port: null,
    };
  }
}
