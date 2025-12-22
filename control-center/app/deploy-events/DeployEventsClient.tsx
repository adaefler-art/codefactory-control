'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type DeployEvent = {
  id: string;
  created_at: string;
  env: string;
  service: string;
  version: string;
  commit_hash: string;
  status: string;
  message: string | null;
};

type Props = {
  defaultEnv: string;
  defaultService: string;
  buildVersion: string;
  buildCommitHash: string;
};

export default function DeployEventsClient({
  defaultEnv,
  defaultService,
  buildVersion,
  buildCommitHash,
}: Props) {
  const [events, setEvents] = useState<DeployEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      env: defaultEnv,
      service: defaultService,
      limit: '20',
    });
    return params.toString();
  }, [defaultEnv, defaultService]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deploy-events?${query}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        setEvents([]);
        return;
      }

      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const addTestEvent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        env: 'prod',
        service: 'control-center',
        version: buildVersion || 'local',
        commit_hash: buildCommitHash || 'local',
        status: 'SUCCEEDED',
        message: new Date().toISOString(),
      };

      const res = await fetch('/api/deploy-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [buildVersion, buildCommitHash, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Deploy Events</h1>
        <button
          type="button"
          onClick={() => void addTestEvent()}
          disabled={loading}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Add test deploy event
        </button>
      </div>

      {error ? (
        <div className="rounded-md border p-3 text-sm">
          <div className="font-medium">Error</div>
          <div className="mt-1 break-words">{error}</div>
        </div>
      ) : null}

      <div className="rounded-md border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b">
            <tr className="text-left">
              <th className="p-2">created_at</th>
              <th className="p-2">env</th>
              <th className="p-2">service</th>
              <th className="p-2">version</th>
              <th className="p-2">commit_hash</th>
              <th className="p-2">status</th>
              <th className="p-2">message</th>
            </tr>
          </thead>
          <tbody>
            {loading && events.length === 0 ? (
              <tr>
                <td className="p-2" colSpan={7}>
                  Loading…
                </td>
              </tr>
            ) : null}
            {!loading && events.length === 0 ? (
              <tr>
                <td className="p-2" colSpan={7}>
                  No deploy events yet.
                </td>
              </tr>
            ) : null}
            {events.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2 whitespace-nowrap">{e.created_at}</td>
                <td className="p-2 whitespace-nowrap">{e.env}</td>
                <td className="p-2 whitespace-nowrap">{e.service}</td>
                <td className="p-2 whitespace-nowrap">{e.version}</td>
                <td className="p-2 whitespace-nowrap font-mono">{e.commit_hash}</td>
                <td className="p-2 whitespace-nowrap">{e.status}</td>
                <td className="p-2 whitespace-nowrap">{e.message ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
