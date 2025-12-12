"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function RepositoriesPage() {
  const router = useRouter();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);

  useEffect(() => {
    async function fetchRepositories() {
      try {
        const response = await fetch("/api/repositories");
        const data = await response.json();

        if (response.ok) {
          setRepositories(data.repositories || []);
        } else {
          setError(data.error || "Fehler beim Laden der Repositories");
        }
      } catch (err) {
        console.error("Error fetching repositories:", err);
        setError("Fehler beim Laden der Repositories");
      } finally {
        setIsLoading(false);
      }
    }

    fetchRepositories();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE");
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Repositories</h1>
          <p className="text-sm text-gray-400 mt-1">
            Verbundene GitHub-Repositories für AFU-9 Workflows
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Repositories...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && repositories.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400 mb-4">Keine Repositories gefunden</p>
            <p className="text-sm text-gray-500">
              Repositories werden automatisch hinzugefügt, wenn Workflows ausgeführt werden.
            </p>
          </div>
        )}

        {!isLoading && !error && repositories.length > 0 && (
          <div className="space-y-4">
            {repositories.map((repo) => (
              <div
                key={repo.id}
                className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <svg
                        className="w-5 h-5 text-gray-400"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                      </svg>
                      <h2 className="text-xl font-semibold text-gray-200">
                        {repo.fullName}
                      </h2>
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
                    <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                      <span className="flex items-center gap-1">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7h12M8 12h12M8 17h12M3 7h.01M3 12h.01M3 17h.01"
                          />
                        </svg>
                        Default: {repo.defaultBranch}
                      </span>
                      <span>•</span>
                      <span>Created: {formatDate(repo.createdAt)}</span>
                    </div>
                    {repo.config && Object.keys(repo.config).length > 0 && (
                      <div className="text-xs text-gray-500">
                        Configuration: {Object.keys(repo.config).length} settings
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/repositories/${repo.id}`)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
                    >
                      Details & PRs
                    </button>
                    <button
                      onClick={() => setSelectedRepo(repo)}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors"
                    >
                      Info
                    </button>
                    <a
                      href={`https://github.com/${repo.fullName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <span>GitHub</span>
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Repository Details Modal */}
      {selectedRepo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-gray-200 mb-4">
              Repository Details
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Full Name
                </label>
                <div className="text-gray-200 font-mono">{selectedRepo.fullName}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Owner</label>
                  <div className="text-gray-200">{selectedRepo.owner}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Repository
                  </label>
                  <div className="text-gray-200">{selectedRepo.name}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Default Branch
                </label>
                <div className="text-gray-200">{selectedRepo.defaultBranch}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                <div className="text-gray-200">
                  {selectedRepo.enabled ? (
                    <span className="text-green-400">Enabled</span>
                  ) : (
                    <span className="text-gray-400">Disabled</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Created</label>
                  <div className="text-gray-200">{formatDate(selectedRepo.createdAt)}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Updated</label>
                  <div className="text-gray-200">{formatDate(selectedRepo.updatedAt)}</div>
                </div>
              </div>

              {selectedRepo.config && Object.keys(selectedRepo.config).length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Configuration
                  </label>
                  <pre className="text-gray-200 bg-gray-800/50 p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selectedRepo.config, null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Repository ID
                </label>
                <div className="text-gray-200 font-mono text-sm">{selectedRepo.id}</div>
              </div>
            </div>

            <div className="flex justify-end mt-6 gap-3">
              <a
                href={`https://github.com/${selectedRepo.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Open in GitHub
              </a>
              <button
                onClick={() => setSelectedRepo(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
