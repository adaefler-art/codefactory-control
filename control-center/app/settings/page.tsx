"use client";

import { useEffect, useState } from "react";

interface McpServer {
  name: string;
  endpoint: string;
  healthy: boolean;
  error?: string;
}

interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SystemConfig {
  integrations: {
    github: {
      configured: boolean;
      owner: string | null;
    };
    aws: {
      region: string;
    };
    llm: {
      provider: string;
      configured: boolean;
    };
  };
  system: {
    version: string;
    architecture: string;
    environment: string;
    database: string;
  };
}

export default function SettingsPage() {
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [newRepo, setNewRepo] = useState({ owner: "", name: "", defaultBranch: "main" });
  const [addRepoError, setAddRepoError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch MCP health
        const mcpResponse = await fetch("/api/mcp/health", { credentials: "include" });
        const mcpData = await mcpResponse.json();

        if (mcpResponse.ok) {
          const serversObj = mcpData.servers || {};
          const serversArray = Object.entries(serversObj).map(([name, health]) => {
            const healthData = health as { status?: string; endpoint?: string; error?: string };
            return {
              name,
              endpoint: healthData.endpoint || `http://localhost:${3001 + Object.keys(serversObj).indexOf(name)}`,
              healthy: healthData.status === 'ok',
              error: healthData.error,
            };
          });
          setMcpServers(serversArray);
        }

        // Fetch repositories
        const repoResponse = await fetch("/api/repositories", { credentials: "include" });
        const repoData = await repoResponse.json();

        if (repoResponse.ok) {
          setRepositories(repoData.repositories || []);
        }

        // Fetch system configuration
        const configResponse = await fetch("/api/system/config", { credentials: "include" });
        const configData = await configResponse.json();

        if (configResponse.ok) {
          setSystemConfig(configData);
        }
      } catch (err) {
        console.error("Error fetching settings data:", err);
        setError("Fehler beim Laden der Einstellungen");
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, []);

  const handleAddRepository = async () => {
    setAddRepoError(null);
    
    if (!newRepo.owner || !newRepo.name) {
      setAddRepoError("Owner und Name sind erforderlich");
      return;
    }

    try {
      const response = await fetch("/api/repositories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRepo),
      });

      const data = await response.json();

      if (response.ok) {
        setRepositories([...repositories, data.repository]);
        setShowAddRepo(false);
        setNewRepo({ owner: "", name: "", defaultBranch: "main" });
      } else {
        setAddRepoError(data.error || "Fehler beim Hinzufügen des Repositories");
      }
    } catch (err) {
      console.error("Error adding repository:", err);
      setAddRepoError("Fehler beim Hinzufügen des Repositories");
    }
  };

  const handleDeleteRepository = async (id: string) => {
    if (!confirm("Möchten Sie dieses Repository wirklich entfernen?")) {
      return;
    }

    try {
      const response = await fetch(`/api/repositories/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (response.ok) {
        setRepositories(repositories.filter(repo => repo.id !== id));
      } else {
        const data = await response.json();
        alert(data.error || "Fehler beim Löschen des Repositories");
      }
    } catch (err) {
      console.error("Error deleting repository:", err);
      alert("Fehler beim Löschen des Repositories");
    }
  };

  const handleToggleRepository = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/repositories/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (response.ok) {
        const data = await response.json();
        setRepositories(repositories.map(repo => 
          repo.id === id ? data.repository : repo
        ));
      } else {
        const data = await response.json();
        alert(data.error || "Fehler beim Aktualisieren des Repositories");
      }
    } catch (err) {
      console.error("Error updating repository:", err);
      alert("Fehler beim Aktualisieren des Repositories");
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Settings</h1>
          <p className="text-sm text-gray-400 mt-1">
            System-Konfiguration, MCP Server-Status und Repository-Verwaltung
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Einstellungen...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && (
          <>
            {/* MCP Servers Section */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-200">MCP Server</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    Überblick über konfigurierte MCP-Server und deren Status
                  </p>
                </div>
              </div>
              
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
                              {server.name.charAt(0).toUpperCase() + server.name.slice(1)}
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
                            Endpoint: {server.endpoint}
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
            </div>

            {/* Repositories Section */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-200">Registrierte Repositories</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    Verwaltung der GitHub-Repositories für AFU-9 Workflows
                  </p>
                </div>
                <button
                  onClick={() => setShowAddRepo(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                >
                  + Repository hinzufügen
                </button>
              </div>

              <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                {repositories.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-gray-400">Keine Repositories konfiguriert</p>
                    <p className="text-sm text-gray-500 mt-2">
                      Fügen Sie ein Repository hinzu, um es für AFU-9 Workflows zu verwenden
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-800">
                    {repositories.map((repo) => (
                      <div
                        key={repo.id}
                        className="p-6 hover:bg-gray-900/70 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <svg
                                className="w-5 h-5 text-gray-400"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                              </svg>
                              <h3 className="text-lg font-medium text-gray-200">
                                {repo.fullName}
                              </h3>
                              <span
                                className={`text-xs px-2 py-1 rounded ${
                                  repo.enabled
                                    ? "bg-green-900/30 text-green-400"
                                    : "bg-gray-900/30 text-gray-400"
                                }`}
                              >
                                {repo.enabled ? "Enabled" : "Disabled"}
                              </span>
                            </div>
                            <div className="text-sm text-gray-400">
                              Default Branch: <span className="font-mono">{repo.defaultBranch}</span>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleToggleRepository(repo.id, !repo.enabled)}
                              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                repo.enabled
                                  ? "bg-yellow-900/30 text-yellow-400 hover:bg-yellow-900/40"
                                  : "bg-green-900/30 text-green-400 hover:bg-green-900/40"
                              }`}
                            >
                              {repo.enabled ? "Deaktivieren" : "Aktivieren"}
                            </button>
                            <button
                              onClick={() => handleDeleteRepository(repo.id)}
                              className="px-3 py-1 bg-red-900/30 text-red-400 hover:bg-red-900/40 rounded text-xs font-medium transition-colors"
                            >
                              Entfernen
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Integrations Section */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-200">Integrationen</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Übersicht über konfigurierte externe Dienste
                </p>
              </div>
              
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                {systemConfig ? (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-200 mb-1">GitHub Integration</div>
                        <div className="text-xs text-gray-400">
                          Owner: {systemConfig.integrations.github.owner || "Nicht konfiguriert"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                          systemConfig.integrations.github.configured ? "bg-green-500" : "bg-gray-500"
                        }`} />
                        <span className="text-xs text-gray-400">
                          {systemConfig.integrations.github.configured ? "Aktiv" : "Inaktiv"}
                        </span>
                      </div>
                    </div>
                    
                    <div className="border-t border-gray-800 pt-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-200 mb-1">AWS Region</div>
                          <div className="text-xs text-gray-400">
                            {systemConfig.integrations.aws.region}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-xs text-gray-400">Konfiguriert</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-800 pt-4">
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-200 mb-1">LLM Provider</div>
                          <div className="text-xs text-gray-400">
                            {systemConfig.integrations.llm.provider}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            systemConfig.integrations.llm.configured ? "bg-green-500" : "bg-gray-500"
                          }`} />
                          <span className="text-xs text-gray-400">
                            {systemConfig.integrations.llm.configured ? "Aktiv" : "Inaktiv"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400">Lädt Konfiguration...</div>
                )}
              </div>

              <div className="mt-4 bg-blue-900/20 border border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h3 className="text-sm font-medium text-blue-300 mb-1">Sicherheitshinweis</h3>
                    <p className="text-xs text-blue-300/80">
                      Sensible Werte wie API-Keys, Tokens und Passwörter werden ausschließlich im AWS Secrets Manager gespeichert 
                      und können nicht über dieses UI verändert werden. Dies gewährleistet maximale Sicherheit für Ihre Credentials.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* System Information */}
            <div className="mb-8">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-200">System-Information</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Allgemeine System- und Umgebungsinformationen
                </p>
              </div>
              
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                {systemConfig ? (
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Version</span>
                      <span className="text-gray-200">{systemConfig.system.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Architektur</span>
                      <span className="text-gray-200">{systemConfig.system.architecture}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Umgebung</span>
                      <span className="text-gray-200">{systemConfig.system.environment}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Database</span>
                      <span className="text-gray-200 font-mono">{systemConfig.system.database}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4 text-gray-400">Lädt System-Informationen...</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add Repository Modal */}
      {showAddRepo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-lg w-full">
            <h3 className="text-xl font-semibold text-gray-200 mb-4">
              Repository hinzufügen
            </h3>
            
            {addRepoError && (
              <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 mb-4">
                <p className="text-red-300 text-sm">{addRepoError}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Owner *
                </label>
                <input
                  type="text"
                  value={newRepo.owner}
                  onChange={(e) => setNewRepo({ ...newRepo, owner: e.target.value })}
                  placeholder="z.B. adaefler-art"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Repository Name *
                </label>
                <input
                  type="text"
                  value={newRepo.name}
                  onChange={(e) => setNewRepo({ ...newRepo, name: e.target.value })}
                  placeholder="z.B. codefactory-control"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Default Branch
                </label>
                <input
                  type="text"
                  value={newRepo.defaultBranch}
                  onChange={(e) => setNewRepo({ ...newRepo, defaultBranch: e.target.value })}
                  placeholder="main"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="text-xs text-gray-500">
                * Pflichtfelder
              </div>
            </div>

            <div className="flex justify-end mt-6 gap-3">
              <button
                onClick={() => {
                  setShowAddRepo(false);
                  setAddRepoError(null);
                  setNewRepo({ owner: "", name: "", defaultBranch: "main" });
                }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAddRepository}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Hinzufügen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
