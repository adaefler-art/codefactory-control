"use client";

import { useEffect, useState } from "react";

interface McpServer {
  name: string;
  endpoint: string;
  healthy: boolean;
  error?: string;
}

export default function SettingsPage() {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMcpHealth() {
      try {
        const response = await fetch("/api/mcp/health");
        const data = await response.json();

        if (response.ok) {
          setMcpServers(data.servers || []);
        } else {
          setError(data.error || "Fehler beim Laden der MCP Server Status");
        }
      } catch (err) {
        console.error("Error fetching MCP health:", err);
        setError("Fehler beim Laden der MCP Server Status");
      } finally {
        setIsLoading(false);
      }
    }

    fetchMcpHealth();
  }, []);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Settings</h1>
          <p className="text-sm text-gray-400 mt-1">
            System-Konfiguration und MCP Server-Status
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* MCP Servers Section */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">MCP Servers</h2>
          
          {isLoading && (
            <div className="text-center py-12">
              <p className="text-gray-400">Lädt MCP Server Status...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-300">{error}</p>
            </div>
          )}

          {!isLoading && !error && (
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
              <div className="divide-y divide-gray-800">
                {mcpServers.map((server) => (
                  <div
                    key={server.name}
                    className="p-6 hover:bg-gray-900/70 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-medium text-gray-200">
                            {server.name}
                          </h3>
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              server.healthy
                                ? "bg-green-900/30 text-green-400"
                                : "bg-red-900/30 text-red-400"
                            }`}
                          >
                            {server.healthy ? "Healthy" : "Unhealthy"}
                          </span>
                        </div>
                        <div className="text-sm text-gray-400 font-mono">
                          {server.endpoint}
                        </div>
                        {server.error && (
                          <div className="mt-2 text-sm text-red-400">
                            Error: {server.error}
                          </div>
                        )}
                      </div>
                      <div>
                        <div
                          className={`w-3 h-3 rounded-full ${
                            server.healthy ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* System Information */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">System Information</h2>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-400">Version</span>
                <span className="text-gray-200">v0.2 (ECS)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Architecture</span>
                <span className="text-gray-200">AFU-9 (Ninefold)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Environment</span>
                <span className="text-gray-200">
                  {process.env.NODE_ENV || "development"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Environment Variables (Safe Display) */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            Environment Configuration
          </h2>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-400 mb-1">Database Connection</div>
                <div className="text-gray-200">
                  {process.env.NEXT_PUBLIC_DATABASE_HOST || "localhost"}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">GitHub Integration</div>
                <div className="text-gray-200">
                  {process.env.NEXT_PUBLIC_GITHUB_OWNER || "Not configured"}
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-4">
                Note: Sensitive values are hidden for security
              </div>
            </div>
          </div>
        </div>

        {/* Database Status */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">Database Status</h2>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400 mb-1">PostgreSQL Connection</div>
                <div className="text-gray-200">
                  Connected to {process.env.DATABASE_NAME || "afu9"}
                </div>
              </div>
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-200 mb-4">Actions</h2>
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
            <div className="space-y-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors text-left"
              >
                Refresh Page
              </button>
              <button
                onClick={() => {
                  fetch("/api/health")
                    .then((res) => res.json())
                    .then((data) => alert(JSON.stringify(data, null, 2)))
                    .catch((err) => alert("Error: " + err.message));
                }}
                className="w-full px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors text-left"
              >
                Check Health Endpoint
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
