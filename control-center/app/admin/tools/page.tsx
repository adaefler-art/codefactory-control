"use client";

import { useEffect, useState } from "react";
import { API_ROUTES } from "@/lib/api-routes";

type DeploymentEnv = "production" | "staging" | "development" | "unknown";

type WhoamiData = {
  sub: string;
  isAdmin: boolean;
  deploymentEnv?: DeploymentEnv;
};

type ToolInfo = {
  toolId: string;
  description: string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  lastUsedAt: string | null;
  contractVersion: string;
};

type ServerInfo = {
  name: string;
  displayName: string;
  kind: string;
  version: string;
  env: string;
  port: number;
  health: 'OK' | 'DEGRADED' | 'UNREACHABLE';
  source: 'Registry' | 'Static';
  tools: ToolInfo[];
  toolCount: number;
};

type CatalogResponse = {
  ok: boolean;
  catalogVersion: string;
  generatedAt: string;
  servers: ServerInfo[];
  serverCount: number;
  totalToolCount: number;
  timestamp: string;
};

export default function AdminToolsPage() {
  const [whoami, setWhoami] = useState<WhoamiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<string>('all');
  const [serverFilter, setServerFilter] = useState<string>('all');
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Check auth first
      const whoRes = await fetch(API_ROUTES.ops.whoami, {
        credentials: "include",
        cache: "no-store",
      });

      if (!whoRes.ok) {
        setWhoami(null);
        setLoading(false);
        return;
      }

      const whoData = (await whoRes.json()) as WhoamiData;
      setWhoami(whoData);

      if (!whoData.isAdmin) {
        setLoading(false);
        return;
      }

      // Load catalog
      const catalogRes = await fetch(API_ROUTES.admin.tools.catalog, {
        credentials: "include",
        cache: "no-store",
      });

      if (!catalogRes.ok) {
        const errData = await catalogRes.json();
        throw new Error(errData?.details || errData?.error || 'Failed to load catalog');
      }

      const catalogData = (await catalogRes.json()) as CatalogResponse;
      setCatalog(catalogData);

      // Expand all servers by default
      setExpandedServers(new Set(catalogData.servers.map(s => s.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleServer = (serverName: string) => {
    const newExpanded = new Set(expandedServers);
    if (newExpanded.has(serverName)) {
      newExpanded.delete(serverName);
    } else {
      newExpanded.add(serverName);
    }
    setExpandedServers(newExpanded);
  };

  const filteredServers = catalog?.servers.filter((server) => {
    if (healthFilter !== 'all' && server.health !== healthFilter) {
      return false;
    }
    if (serverFilter !== 'all' && server.name !== serverFilter) {
      return false;
    }
    return true;
  }) || [];

  const healthStatusColor = (health: string) => {
    switch (health) {
      case 'OK':
        return 'text-green-400';
      case 'DEGRADED':
        return 'text-yellow-400';
      case 'UNREACHABLE':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools Catalog</h1>
        <div className="text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!whoami) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools Catalog</h1>
        <div className="text-gray-400">Authentication required.</div>
      </div>
    );
  }

  if (!whoami.isAdmin) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools Catalog</h1>
        <div className="text-gray-400">Admin access required.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools Catalog</h1>
        <div className="text-red-300 mb-4">{error}</div>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!catalog || catalog.servers.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
        <h1 className="text-2xl font-bold mb-4">Tools Catalog</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <div className="text-gray-400 text-lg mb-2">No MCP servers found</div>
          <div className="text-gray-500 text-sm">
            The MCP catalog is empty or not available.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 text-gray-200">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Tools Catalog</h1>
        <div className="text-sm text-gray-400">
          Catalog Version: {catalog.catalogVersion} • Generated: {new Date(catalog.generatedAt).toLocaleString()} • 
          {' '}{catalog.serverCount} servers, {catalog.totalToolCount} tools
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4 items-center">
        <div>
          <label className="text-sm text-gray-400 mr-2">Health:</label>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm"
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="OK">OK</option>
            <option value="DEGRADED">DEGRADED</option>
            <option value="UNREACHABLE">UNREACHABLE</option>
          </select>
        </div>

        <div>
          <label className="text-sm text-gray-400 mr-2">Server:</label>
          <select
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm"
            value={serverFilter}
            onChange={(e) => setServerFilter(e.target.value)}
          >
            <option value="all">All</option>
            {catalog.servers.map((s) => (
              <option key={s.name} value={s.name}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={loadData}
          className="ml-auto px-4 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm"
        >
          Refresh
        </button>
      </div>

      {/* Server List */}
      <div className="space-y-4">
        {filteredServers.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            <div className="text-gray-400">No servers match the current filters.</div>
          </div>
        ) : (
          filteredServers.map((server) => (
            <div
              key={server.name}
              className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
            >
              {/* Server Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-800"
                onClick={() => toggleServer(server.name)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-medium">{server.displayName}</span>
                    <span className="text-sm text-gray-500">({server.name})</span>
                    <span className={`text-sm font-medium ${healthStatusColor(server.health)}`}>
                      {server.health}
                    </span>
                    <span className="text-sm text-gray-400">
                      {server.toolCount} {server.toolCount === 1 ? 'tool' : 'tools'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">v{server.version}</span>
                    <span className="text-sm text-gray-500">{server.source}</span>
                    <span className="text-gray-400">
                      {expandedServers.has(server.name) ? '▼' : '▶'}
                    </span>
                  </div>
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {server.env}:{server.port}
                </div>
              </div>

              {/* Tools Table (expanded) */}
              {expandedServers.has(server.name) && (
                <div className="border-t border-gray-800">
                  {server.tools.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 text-sm">
                      No tools configured for this server.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-950 border-b border-gray-800">
                          <tr className="text-left text-gray-400">
                            <th className="py-2 px-4 font-medium">Tool ID</th>
                            <th className="py-2 px-4 font-medium">Description</th>
                            <th className="py-2 px-4 font-medium">Input Schema</th>
                            <th className="py-2 px-4 font-medium">Output Schema</th>
                            <th className="py-2 px-4 font-medium">Version</th>
                            <th className="py-2 px-4 font-medium">Last Used</th>
                          </tr>
                        </thead>
                        <tbody>
                          {server.tools.map((tool) => (
                            <tr
                              key={tool.toolId}
                              className="border-b border-gray-800 hover:bg-gray-800"
                            >
                              <td className="py-2 px-4 font-mono text-blue-300">
                                {tool.toolId}
                              </td>
                              <td className="py-2 px-4 text-gray-300 max-w-md">
                                {tool.description || '—'}
                              </td>
                              <td className="py-2 px-4 font-mono text-xs text-gray-500">
                                {tool.inputSchemaHash}
                              </td>
                              <td className="py-2 px-4 font-mono text-xs text-gray-500">
                                {tool.outputSchemaHash}
                              </td>
                              <td className="py-2 px-4 text-gray-400 text-xs">
                                {tool.contractVersion}
                              </td>
                              <td className="py-2 px-4 text-gray-500 text-xs">
                                {tool.lastUsedAt ? new Date(tool.lastUsedAt).toLocaleString() : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
