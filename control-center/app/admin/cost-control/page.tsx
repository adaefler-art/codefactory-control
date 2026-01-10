"use client";

import { useEffect, useMemo, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";

type DeploymentEnv = "production" | "staging" | "development" | "unknown";

type WhoamiData = {
  sub: string;
  isAdmin: boolean;
  deploymentEnv?: DeploymentEnv;
};

type SettingsRow = {
  key: string;
  value: any;
  updatedAt?: string;
  updatedBy?: string;
};

type EventRow = {
  requestId: string;
  sub: string;
  env: string;
  action: string;
  paramsHash: string;
  resultHash: string;
  lawbookVersion: string | null;
  createdAt: string;
};

type SettingsResponse = {
  ok: boolean;
  env: string;
  settings: SettingsRow[];
  events: EventRow[];
  diagnostics?: any;
};

type StatusResponse = {
  ok: boolean;
  env: string;
  ecs: any;
  rds: any;
  diagnostics?: any;
  timestamp: string;
};

export default function AdminCostControlPage() {
  const [whoami, setWhoami] = useState<WhoamiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const env = "staging";

  const desiredEcsCount = useMemo(() => {
    const row = settings.find(s => s.key === "stagingEcsDesiredCount");
    const raw = row?.value;
    if (raw === 0 || raw === 1) return raw;
    if (raw === "0") return 0;
    if (raw === "1") return 1;
    return 0;
  }, [settings]);

  const desiredRdsSchedule = useMemo(() => {
    const row = settings.find(s => s.key === "stagingRdsSchedule");
    const raw = row?.value;
    if (raw === "off" || raw === "workhours") return raw;
    return "off";
  }, [settings]);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const who = await fetch(API_ROUTES.ops.whoami, {
        credentials: "include",
        cache: "no-store",
      });
      if (!who.ok) {
        setWhoami(null);
        setLoading(false);
        return;
      }
      const whoData = (await who.json()) as WhoamiData;
      setWhoami(whoData);

      if (!whoData.isAdmin || whoData.deploymentEnv !== "staging") {
        setLoading(false);
        return;
      }

      const [settingsRes, statusRes] = await Promise.all([
        fetch(API_ROUTES.admin.costControl.settings(env), {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(API_ROUTES.admin.costControl.status(env), {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      const settingsJson = (await settingsRes.json()) as SettingsResponse;
      if (settingsRes.ok && settingsJson.ok) {
        setSettings(settingsJson.settings || []);
        setEvents(settingsJson.events || []);
      } else {
        setSettings([]);
        setEvents([]);
      }

      const statusJson = (await statusRes.json()) as StatusResponse;
      if (statusRes.ok && statusJson.ok) {
        setStatus(statusJson);
      } else {
        setStatus({
          ok: true,
          env,
          ecs: { state: "unknown" },
          rds: { state: "unknown" },
          timestamp: new Date().toISOString(),
        } as any);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSettings([]);
      setEvents([]);
      setStatus({
        ok: true,
        env,
        ecs: { state: "unknown" },
        rds: { state: "unknown" },
        timestamp: new Date().toISOString(),
      } as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const patchSetting = async (key: string, value: any) => {
    setMessage(null);
    setError(null);

    try {
      const res = await fetch(API_ROUTES.admin.costControl.settingsPatch, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env, key, value }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details || data?.error || "Failed to update setting");
      }

      setMessage(`Updated ${key} (requestId: ${data.requestId})`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Cost Control</h1>
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!whoami) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Cost Control</h1>
        <div className="text-gray-400">Authentication required.</div>
      </div>
    );
  }

  if (!whoami.isAdmin) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Cost Control</h1>
        <div className="text-gray-400">Admin access required.</div>
      </div>
    );
  }

  if (whoami.deploymentEnv !== "staging") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Cost Control</h1>
        <div className="text-gray-400">This page is available only in staging.</div>
      </div>
    );
  }

  const ecsStatus = status?.ecs || { state: "unknown" };
  const rdsStatus = status?.rds || { state: "unknown" };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
      <h1 className="text-2xl font-bold mb-6">Cost Control</h1>

      {(error || message) && (
        <div className="mb-4">
          {error && <div className="text-red-300">{error}</div>}
          {message && <div className="text-green-300">{message}</div>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">Desired State (staging)</h2>

          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-400 mb-1">stagingEcsDesiredCount</div>
              <select
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                value={String(desiredEcsCount)}
                onChange={(e) => patchSetting("stagingEcsDesiredCount", Number(e.target.value))}
              >
                <option value="0">0</option>
                <option value="1">1</option>
              </select>
            </div>

            <div>
              <div className="text-sm text-gray-400 mb-1">stagingRdsSchedule</div>
              <select
                className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
                value={desiredRdsSchedule}
                onChange={(e) => patchSetting("stagingRdsSchedule", e.target.value)}
              >
                <option value="off">off</option>
                <option value="workhours">workhours</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">Status (read-only)</h2>

          <div className="space-y-3">
            <div className="bg-gray-950 border border-gray-800 rounded p-3">
              <div className="text-sm font-medium">ECS</div>
              {ecsStatus.state === "ok" ? (
                <div className="text-sm text-gray-300">
                  desired: {ecsStatus.desiredCount} / running: {ecsStatus.runningCount}
                </div>
              ) : (
                <div className="text-sm text-gray-400">unknown</div>
              )}
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded p-3">
              <div className="text-sm font-medium">RDS</div>
              {rdsStatus.state === "ok" ? (
                <div className="text-sm text-gray-300">{rdsStatus.status}</div>
              ) : (
                <div className="text-sm text-gray-400">unknown</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Event Log (last 20)</h2>

        {events.length === 0 ? (
          <div className="text-sm text-gray-400">No events.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="py-2 pr-4">createdAt</th>
                  <th className="py-2 pr-4">action</th>
                  <th className="py-2 pr-4">requestId</th>
                  <th className="py-2 pr-4">paramsHash</th>
                  <th className="py-2 pr-4">resultHash</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={`${ev.requestId}-${ev.createdAt}`} className="border-t border-gray-800">
                    <td className="py-2 pr-4 text-gray-300">{new Date(ev.createdAt).toISOString()}</td>
                    <td className="py-2 pr-4 text-gray-300">{ev.action}</td>
                    <td className="py-2 pr-4 text-gray-300">{ev.requestId}</td>
                    <td className="py-2 pr-4 text-gray-400">{ev.paramsHash.slice(0, 16)}…</td>
                    <td className="py-2 pr-4 text-gray-400">{ev.resultHash.slice(0, 16)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
