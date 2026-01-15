"use client";

import { useEffect, useState, useCallback } from "react";
import { API_ROUTES } from "@/lib/api-routes";

type CapabilityEntry = {
  id: string;
  kind: string;
  source: string;
  description?: string;
  constraints?: string[];
  metadata?: Record<string, unknown>;
  lastProbeAt?: string;
  lastProbeStatus?: string;
  lastProbeLatencyMs?: number;
  lastProbeError?: string;
  enabled: boolean;
  requiresApproval?: boolean;
  version?: string;
};

type ManifestResponse = {
  version: string;
  hash: string;
  capabilities: CapabilityEntry[];
  sources: {
    intentTools: number;
    mcpTools: number;
    featureFlags: number;
    lawbookConstraints: number;
  };
  timestamp: string;
};

type ProbeSummary = {
  totalProbed: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  unreachableCount: number;
  probedAt: string;
};

type ProbeResponse = {
  ok: boolean;
  summary: ProbeSummary;
  environment: string;
  triggeredBy: string;
  timestamp: string;
};

export default function CapabilitiesPage() {
  const [manifest, setManifest] = useState<ManifestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResponse | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedHash, setCopiedHash] = useState(false);

  const loadManifest = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.ops.capabilities.manifest, {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData?.details || errData?.error || "Failed to load manifest");
      }

      const data = (await response.json()) as ManifestResponse;
      setManifest(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setManifest(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.ops.capabilities.probe, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData?.details || errData?.error || "Failed to trigger probe");
      }

      const data = (await response.json()) as ProbeResponse;
      setProbeResult(data);

      // Reload manifest to show updated probe results
      setTimeout(() => {
        loadManifest();
      }, 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  const copyHash = () => {
    if (manifest?.hash) {
      navigator.clipboard.writeText(manifest.hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  useEffect(() => {
    loadManifest();
  }, [loadManifest]);

  // Filter capabilities
  const filteredCapabilities = manifest?.capabilities.filter((cap) => {
    // Status filter
    if (statusFilter === "enabled" && !cap.enabled) return false;
    if (statusFilter === "disabled" && cap.enabled) return false;
    if (statusFilter === "ok" && cap.lastProbeStatus !== "ok") return false;
    if (statusFilter === "error" && cap.lastProbeStatus !== "error") return false;
    if (statusFilter === "timeout" && cap.lastProbeStatus !== "timeout") return false;
    if (statusFilter === "unreachable" && cap.lastProbeStatus !== "unreachable") return false;

    // Source filter
    if (sourceFilter !== "all" && cap.source !== sourceFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchesId = cap.id.toLowerCase().includes(query);
      const matchesDesc = cap.description?.toLowerCase().includes(query);
      if (!matchesId && !matchesDesc) return false;
    }

    return true;
  }) || [];

  const getProbeStatusBadge = (status?: string) => {
    switch (status) {
      case "ok":
        return "bg-green-900/30 text-green-200 border-green-700";
      case "error":
        return "bg-red-900/30 text-red-200 border-red-700";
      case "timeout":
        return "bg-yellow-900/30 text-yellow-200 border-yellow-700";
      case "unreachable":
        return "bg-gray-700/30 text-gray-200 border-gray-600";
      default:
        return "bg-gray-800/30 text-gray-400 border-gray-700";
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools & Capabilities</h1>
        <div className="text-gray-400">Loading manifest...</div>
      </div>
    );
  }

  if (error && !manifest) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools & Capabilities</h1>
        <div className="text-red-300 mb-4">{error}</div>
        <button
          onClick={loadManifest}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!manifest) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools & Capabilities</h1>
        <div className="text-gray-400">No manifest available</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Tools & Capabilities</h1>
        <div className="text-sm text-gray-400">
          Version: {manifest.version} • {manifest.capabilities.length} capabilities
        </div>
      </div>

      {/* Manifest Hash Card */}
      <div className="mb-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-400 mb-1">Manifest Hash</div>
            <div className="font-mono text-sm text-blue-300">{manifest.hash}</div>
          </div>
          <button
            onClick={copyHash}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm"
          >
            {copiedHash ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Probe Result Banner */}
      {probeResult && (
        <div className="mb-6 bg-green-900/20 border border-green-700 rounded-lg p-4">
          <div className="text-sm text-green-200 mb-2">
            ✅ Probe completed successfully
          </div>
          <div className="text-xs text-gray-400">
            Probed {probeResult.summary.totalProbed} capabilities • 
            Success: {probeResult.summary.successCount} • 
            Errors: {probeResult.summary.errorCount} • 
            Timeouts: {probeResult.summary.timeoutCount} • 
            Unreachable: {probeResult.summary.unreachableCount}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-700 rounded-lg p-4">
          <div className="text-sm text-red-300">{error}</div>
        </div>
      )}

      {/* Actions & Filters */}
      <div className="mb-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          {/* Search */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Search</label>
            <input
              type="text"
              placeholder="Filter by name..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Status</label>
            <select
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="ok">OK (Probed)</option>
              <option value="error">Error</option>
              <option value="timeout">Timeout</option>
              <option value="unreachable">Unreachable</option>
            </select>
          </div>

          {/* Source Filter */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Source</label>
            <select
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">All Sources</option>
              <option value="intent_registry">Intent Registry</option>
              <option value="mcp">MCP</option>
              <option value="flags">Feature Flags</option>
              <option value="lawbook">Lawbook</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-end gap-2">
            <button
              onClick={triggerProbe}
              disabled={probing}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded text-sm"
            >
              {probing ? "Probing..." : "Probe Now"}
            </button>
            <button
              onClick={loadManifest}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Source Counts */}
        <div className="flex gap-4 text-xs text-gray-400">
          <span>Intent Tools: {manifest.sources.intentTools}</span>
          <span>MCP Tools: {manifest.sources.mcpTools}</span>
          <span>Feature Flags: {manifest.sources.featureFlags}</span>
          <span>Lawbook: {manifest.sources.lawbookConstraints}</span>
        </div>
      </div>

      {/* Capabilities Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {filteredCapabilities.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No capabilities match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-950 border-b border-gray-800">
                <tr className="text-left text-gray-400">
                  <th className="py-3 px-4 font-medium">Capability</th>
                  <th className="py-3 px-4 font-medium">Kind</th>
                  <th className="py-3 px-4 font-medium">Source</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Last Probe</th>
                  <th className="py-3 px-4 font-medium">Latency</th>
                  <th className="py-3 px-4 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {filteredCapabilities.map((cap) => (
                  <tr
                    key={cap.id}
                    className="border-b border-gray-800 hover:bg-gray-800"
                  >
                    {/* Capability ID */}
                    <td className="py-3 px-4">
                      <div className="font-mono text-blue-300 text-sm">{cap.id}</div>
                      {cap.description && (
                        <div className="text-xs text-gray-500 mt-1 max-w-md">
                          {cap.description}
                        </div>
                      )}
                      {cap.lastProbeError && (
                        <div className="text-xs text-red-400 mt-1 max-w-md truncate">
                          Error: {cap.lastProbeError}
                        </div>
                      )}
                    </td>

                    {/* Kind */}
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {cap.kind}
                    </td>

                    {/* Source */}
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {cap.source}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs ${cap.enabled ? "text-green-400" : "text-gray-500"}`}>
                          {cap.enabled ? "Enabled" : "Disabled"}
                        </span>
                        {cap.lastProbeStatus && (
                          <span className={`px-2 py-0.5 text-xs font-medium rounded border ${getProbeStatusBadge(cap.lastProbeStatus)}`}>
                            {cap.lastProbeStatus.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Last Probe */}
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {cap.lastProbeAt
                        ? new Date(cap.lastProbeAt).toLocaleString("de-DE")
                        : "—"}
                    </td>

                    {/* Latency */}
                    <td className="py-3 px-4 text-gray-400 text-xs">
                      {cap.lastProbeLatencyMs !== undefined
                        ? `${cap.lastProbeLatencyMs}ms`
                        : "—"}
                    </td>

                    {/* Version */}
                    <td className="py-3 px-4 text-gray-500 text-xs">
                      {cap.version || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="mt-4 text-sm text-gray-400 text-center">
        Showing {filteredCapabilities.length} of {manifest.capabilities.length} capabilities
      </div>
    </div>
  );
}
