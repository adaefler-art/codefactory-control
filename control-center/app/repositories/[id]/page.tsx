"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface Label {
  name: string;
  color: string | null;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  draft: boolean;
  head: string;
  base: string;
  labels: Label[];
  automated: boolean;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  labels: Label[];
  comments: number;
  important: boolean;
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
  executionsCount: number;
}

interface RepositoryDetails {
  repository: Repository;
  pullRequests: PullRequest[];
  issues: Issue[];
}

export default function RepositoryDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  
  const [data, setData] = useState<RepositoryDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "prs" | "issues">("overview");

  useEffect(() => {
    async function fetchRepositoryDetails() {
      if (!id) return;
      
      try {
        const response = await fetch(`/api/repositories/${id}`);
        const result = await response.json();

        if (response.ok) {
          setData(result);
        } else {
          setError(result.error || "Fehler beim Laden der Repository-Details");
        }
      } catch (err) {
        console.error("Error fetching repository details:", err);
        setError("Fehler beim Laden der Repository-Details");
      } finally {
        setIsLoading(false);
      }
    }

    fetchRepositoryDetails();
  }, [id]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Heute";
    if (diffDays === 1) return "Gestern";
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    if (diffDays < 30) return `vor ${Math.floor(diffDays / 7)} Wochen`;
    return formatDate(dateString);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-center text-gray-400">Lädt Repository-Details...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0d1117] text-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
          <button
            onClick={() => router.push("/repositories")}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
          >
            Zurück zur Übersicht
          </button>
        </div>
      </div>
    );
  }

  const { repository, pullRequests, issues } = data;
  const automatedPRs = pullRequests.filter((pr) => pr.automated);
  const importantIssues = issues.filter((issue) => issue.important);

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <button
            onClick={() => router.push("/repositories")}
            className="text-sm text-gray-400 hover:text-gray-300 mb-3 flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Zurück
          </button>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <h1 className="text-3xl font-semibold text-gray-200">{repository.fullName}</h1>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    repository.enabled
                      ? "bg-green-900/30 text-green-400"
                      : "bg-gray-900/30 text-gray-400"
                  }`}
                >
                  {repository.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12M8 12h12M8 17h12M3 7h.01M3 12h.01M3 17h.01" />
                  </svg>
                  Default: {repository.defaultBranch}
                </span>
                <span>•</span>
                <span>{repository.executionsCount} Workflows ausgeführt</span>
              </div>
            </div>
            <a
              href={`https://github.com/${repository.fullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2"
            >
              <span>GitHub öffnen</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("overview")}
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "overview"
                  ? "border-blue-500 text-gray-200"
                  : "border-transparent text-gray-400 hover:text-gray-300"
              }`}
            >
              Übersicht
            </button>
            <button
              onClick={() => setActiveTab("prs")}
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "prs"
                  ? "border-blue-500 text-gray-200"
                  : "border-transparent text-gray-400 hover:text-gray-300"
              }`}
            >
              Pull Requests ({pullRequests.length})
            </button>
            <button
              onClick={() => setActiveTab("issues")}
              className={`py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "issues"
                  ? "border-blue-500 text-gray-200"
                  : "border-transparent text-gray-400 hover:text-gray-300"
              }`}
            >
              Issues ({issues.length})
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-sm font-medium text-gray-400">Pull Requests</h3>
                </div>
                <p className="text-3xl font-bold text-gray-200">{pullRequests.length}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {automatedPRs.length} automatisiert
                </p>
              </div>

              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-sm font-medium text-gray-400">Issues</h3>
                </div>
                <p className="text-3xl font-bold text-gray-200">{issues.length}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {importantIssues.length} wichtig
                </p>
              </div>

              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-2">
                  <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-sm font-medium text-gray-400">Workflows</h3>
                </div>
                <p className="text-3xl font-bold text-gray-200">{repository.executionsCount}</p>
                <p className="text-xs text-gray-500 mt-1">Ausführungen</p>
              </div>
            </div>

            {/* Automated PRs Section */}
            {automatedPRs.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  Automatisierte Pull Requests
                </h3>
                <div className="space-y-3">
                  {automatedPRs.slice(0, 5).map((pr) => (
                    <a
                      key={pr.number}
                      href={pr.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-200">#{pr.number}</span>
                            <span className="text-sm text-gray-300">{pr.title}</span>
                            {pr.draft && (
                              <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                Draft
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {pr.author} • {formatRelativeTime(pr.createdAt)}
                          </div>
                        </div>
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Important Issues Section */}
            {importantIssues.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Wichtige Issues
                </h3>
                <div className="space-y-3">
                  {importantIssues.slice(0, 5).map((issue) => (
                    <a
                      key={issue.number}
                      href={issue.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-gray-800/50 border border-gray-700 rounded-lg p-4 hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-gray-200">#{issue.number}</span>
                            <span className="text-sm text-gray-300">{issue.title}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>{issue.author}</span>
                            <span>•</span>
                            <span>{formatRelativeTime(issue.createdAt)}</span>
                            {issue.comments > 0 && (
                              <>
                                <span>•</span>
                                <span>{issue.comments} Kommentare</span>
                              </>
                            )}
                          </div>
                          {issue.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {issue.labels.slice(0, 3).map((label, idx) => (
                                <span
                                  key={idx}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: label.color ? `#${label.color}20` : '#374151',
                                    color: label.color ? `#${label.color}` : '#9ca3af',
                                  }}
                                >
                                  {label.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "prs" && (
          <div className="space-y-3">
            {pullRequests.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
                <p className="text-gray-400">Keine offenen Pull Requests</p>
              </div>
            ) : (
              pullRequests.map((pr) => (
                <div
                  key={pr.number}
                  className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <a
                            href={pr.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-lg font-medium text-gray-200 hover:text-blue-400 transition-colors"
                          >
                            {pr.title}
                          </a>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                            <span>#{pr.number}</span>
                            <span>•</span>
                            <span>{pr.author}</span>
                            <span>•</span>
                            <span>{formatRelativeTime(pr.createdAt)}</span>
                            {pr.draft && (
                              <>
                                <span>•</span>
                                <span className="text-xs px-2 py-0.5 bg-gray-700 text-gray-300 rounded">
                                  Draft
                                </span>
                              </>
                            )}
                            {pr.automated && (
                              <>
                                <span>•</span>
                                <span className="text-xs px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded">
                                  Automatisiert
                                </span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                            <span className="font-mono">{pr.head}</span>
                            <span>→</span>
                            <span className="font-mono">{pr.base}</span>
                          </div>
                          {pr.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {pr.labels.map((label, idx) => (
                                <span
                                  key={idx}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: label.color ? `#${label.color}20` : '#374151',
                                    color: label.color ? `#${label.color}` : '#9ca3af',
                                  }}
                                >
                                  {label.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <a
                          href={pr.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition-colors flex-shrink-0"
                        >
                          GitHub öffnen
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === "issues" && (
          <div className="space-y-3">
            {issues.length === 0 ? (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
                <p className="text-gray-400">Keine offenen Issues</p>
              </div>
            ) : (
              issues.map((issue) => (
                <div
                  key={issue.number}
                  className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                        <path fillRule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <a
                              href={issue.htmlUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-lg font-medium text-gray-200 hover:text-blue-400 transition-colors"
                            >
                              {issue.title}
                            </a>
                            {issue.important && (
                              <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-400 rounded">
                                Wichtig
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-sm text-gray-400">
                            <span>#{issue.number}</span>
                            <span>•</span>
                            <span>{issue.author}</span>
                            <span>•</span>
                            <span>{formatRelativeTime(issue.createdAt)}</span>
                            {issue.comments > 0 && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                                    <path d="M2.678 11.894a1 1 0 01.287.801 10.97 10.97 0 01-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 01.71-.074A8.06 8.06 0 008 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 01-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 00.244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 01-2.347-.306c-.52.263-1.639.742-3.468 1.105z" />
                                  </svg>
                                  {issue.comments}
                                </span>
                              </>
                            )}
                          </div>
                          {issue.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {issue.labels.map((label, idx) => (
                                <span
                                  key={idx}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{
                                    backgroundColor: label.color ? `#${label.color}20` : '#374151',
                                    color: label.color ? `#${label.color}` : '#9ca3af',
                                  }}
                                >
                                  {label.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <a
                          href={issue.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition-colors flex-shrink-0"
                        >
                          GitHub öffnen
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
