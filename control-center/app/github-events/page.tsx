import { getPool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Row = {
  delivery_id: string;
  event_name: string | null;
  repository_full_name: string | null;
  received_at: string;
  processed: boolean;
  processed_at: string | null;
  error: string | null;
};

export default async function GithubEventsPage() {
  const pool = getPool();

  const result = await pool.query<Row>(`
    SELECT delivery_id, event_name, repository_full_name, received_at, processed, processed_at, error
    FROM github_action_deliveries
    ORDER BY received_at DESC
    LIMIT 50
  `);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold text-purple-400">GitHub Events (Event Bus)</h1>
        <p className="mt-2 text-sm text-gray-400">Last 50 deliveries from SQS consumer.</p>

        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-800/40 text-gray-300">
                <tr>
                  <th className="text-left px-4 py-3">Received</th>
                  <th className="text-left px-4 py-3">Delivery ID</th>
                  <th className="text-left px-4 py-3">Event</th>
                  <th className="text-left px-4 py-3">Repo</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {result.rows.map((row) => (
                  <tr key={row.delivery_id} className="hover:bg-gray-800/20">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(row.received_at).toLocaleString('de-DE')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-200 break-all">
                      {row.delivery_id}
                    </td>
                    <td className="px-4 py-3 text-gray-200">{row.event_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{row.repository_full_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {row.error ? (
                        <span className="text-red-300">error</span>
                      ) : row.processed ? (
                        <span className="text-green-300">processed</span>
                      ) : (
                        <span className="text-yellow-300">pending</span>
                      )}
                    </td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-gray-500" colSpan={5}>
                      No events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
