"use client";

import { useEffect, useState, useCallback } from "react";
import { DeployStatusResponse, DeployStatus } from "@/lib/contracts/deployStatus";
import { API_ROUTES } from "@/lib/api-routes";
import DeployStatusBadge from "../../components/DeployStatusBadge";

const statusColors: Record<DeployStatus, string> = {
  GREEN: "text-green-400",
  YELLOW: "text-yellow-400",
  RED: "text-red-400",
};

export default function DeployStatusPage() {
  const [selectedEnv, setSelectedEnv] = useState<string>("prod");
  const [status, setStatus] = useState<DeployStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const environments = ["prod", "stage", "dev"];

  const fetchStatus = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const response = await fetch(API_ROUTES.deploy.status(selectedEnv, force));
      if (!response.ok) {
        throw new Error(`Failed to fetch status: ${response.status}`);
      }
      const data: DeployStatusResponse = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch deploy status:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [selectedEnv]);

  useEffect(() => {
    fetchStatus();

    if (autoRefresh) {
      const interval = setInterval(() => fetchStatus(), 30000); // 30s refresh
      return () => clearInterval(interval);
    }
  }, [selectedEnv, autoRefresh, fetchStatus]);

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  const verificationRun = status?.signals?.verificationRun || null;

  const getRecommendation = (status: DeployStatus): string => {
    switch (status) {
      case "RED":
        return "HOLD - Do not deploy. Investigation required.";
      case "YELLOW":
        return "CAUTION - Proceed with care. Monitor closely.";
      case "GREEN":
        return "GO - Safe to deploy.";
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Deploy Status Monitor</h1>
          <p className="text-gray-400">
            Real-time deployment health status for AFU-9 environments
          </p>
        </div>

        {/* Environment Selector */}
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-gray-300">Environment:</label>
              <div className="flex space-x-2">
                {environments.map((env) => (
                  <button
                    key={env}
                    onClick={() => setSelectedEnv(env)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      selectedEnv === env
                        ? "bg-purple-900/30 text-purple-200 border border-purple-500/50"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                    }`}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500"
                />
                <span>Auto-refresh (30s)</span>
              </label>
              <button
                onClick={() => fetchStatus(true)}
                disabled={loading}
                className="px-4 py-2 rounded-md text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Refreshing..." : "Force Refresh"}
              </button>
            </div>
          </div>
        </div>

        {/* Status Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-400 font-medium">Error: {error}</p>
          </div>
        )}

        {loading && !status && (
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-8 text-center">
            <p className="text-gray-400">Loading status...</p>
          </div>
        )}

        {status && (
          <>
            {/* Current Status Card */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Current Status</h2>
                <DeployStatusBadge env={selectedEnv} showLabel={true} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-400 mb-1">Status</p>
                  <p className={`text-2xl font-bold ${statusColors[status.status]}`}>
                    {status.status}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">Observed At</p>
                  <p className="text-sm text-gray-200">{formatTimestamp(status.observedAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">Staleness</p>
                  <p className="text-sm text-gray-200">{status.stalenessSeconds}s ago</p>
                </div>
              </div>

              {/* Recommendation */}
              <div className="mt-4 p-4 bg-gray-800 rounded-md border border-gray-700">
                <p className="text-sm font-medium text-gray-300 mb-1">
                  Self-Propelling Mode Recommendation
                </p>
                <p className={`font-bold ${statusColors[status.status]}`}>
                  {getRecommendation(status.status)}
                </p>
              </div>
            </div>

            {/* Last Verification Run */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Last Verification Run</h2>

              {!verificationRun && (
                <p className="text-sm text-gray-400">
                  No post-deploy verification run found for this environment.
                </p>
              )}

              {verificationRun && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-400">Run Status</p>
                      <p className="text-sm text-gray-200">{verificationRun.status}</p>
                    </div>
                    <a
                      className="text-sm text-purple-300 hover:text-purple-200 underline"
                      href={API_ROUTES.playbooks.runs.get(verificationRun.runId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View run details
                    </a>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-gray-400">Run ID</p>
                      <p className="text-xs text-gray-200 break-all">{verificationRun.runId}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Started</p>
                      <p className="text-sm text-gray-200">
                        {verificationRun.startedAt ? formatTimestamp(verificationRun.startedAt) : "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Completed</p>
                      <p className="text-sm text-gray-200">
                        {verificationRun.completedAt
                          ? formatTimestamp(verificationRun.completedAt)
                          : "N/A"}
                      </p>
                    </div>
                  </div>

                  <details className="mt-2">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                      Verification run payload
                    </summary>
                    <pre className="mt-2 text-xs text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto">
                      {JSON.stringify(verificationRun, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>

            {/* Reasons */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Status Reasons</h2>
              <div className="space-y-3">
                {status.reasons.map((reason, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-md border ${
                      reason.severity === "error"
                        ? "bg-red-900/10 border-red-500/30"
                        : reason.severity === "warning"
                        ? "bg-yellow-900/10 border-yellow-500/30"
                        : "bg-green-900/10 border-green-500/30"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <span
                            className={`text-xs font-bold uppercase ${
                              reason.severity === "error"
                                ? "text-red-400"
                                : reason.severity === "warning"
                                ? "text-yellow-400"
                                : "text-green-400"
                            }`}
                          >
                            {reason.severity}
                          </span>
                          <span className="text-gray-400 text-xs">•</span>
                          <code className="text-xs text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
                            {reason.code}
                          </code>
                        </div>
                        <p className="text-sm text-gray-200">{reason.message}</p>
                        {reason.evidence && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                              Evidence
                            </summary>
                            <pre className="mt-2 text-xs text-gray-300 bg-gray-800 p-2 rounded overflow-x-auto">
                              {JSON.stringify(reason.evidence, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Signals (raw) */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Signals</h2>

              <details>
                <summary className="text-sm text-gray-300 cursor-pointer hover:text-gray-200">
                  Raw signals payload
                </summary>
                <pre className="mt-3 text-xs text-gray-300 bg-gray-800 p-3 rounded overflow-x-auto">
                  {JSON.stringify(status.signals, null, 2)}
                </pre>
              </details>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
