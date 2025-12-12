"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AgentRun {
  id: string;
  executionId: string;
  stepId: string;
  agentType: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  costUsd: number;
  startedAt: string;
  completedAt: string;
  error: string | null;
}

interface AgentSummary {
  agentType: string;
  runCount: number;
  models: string[];
  tools: string[];
  avgDurationMs: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
  lastRun: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRun[]>([]);
  const [agentSummaries, setAgentSummaries] = useState<AgentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentRun | null>(null);
  const [viewMode, setViewMode] = useState<"summary" | "runs">("summary");

  useEffect(() => {
    async function fetchAgents() {
      try {
        const response = await fetch("/api/agents?limit=1000");
        const data = await response.json();

        if (response.ok) {
          const runs = data.agents || [];
          setAgents(runs);
          
          // Group agents by type and calculate summaries
          const summaries = calculateAgentSummaries(runs);
          setAgentSummaries(summaries);
        } else {
          setError(data.error || "Fehler beim Laden der Agent Runs");
        }
      } catch (err) {
        console.error("Error fetching agents:", err);
        setError("Fehler beim Laden der Agent Runs");
      } finally {
        setIsLoading(false);
      }
    }

    fetchAgents();
  }, []);

  const calculateAgentSummaries = (runs: AgentRun[]): AgentSummary[] => {
    const grouped = runs.reduce((acc, run) => {
      const type = run.agentType || "unknown";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(run);
      return acc;
    }, {} as Record<string, AgentRun[]>);

    return Object.entries(grouped).map(([agentType, typeRuns]) => {
      const models = [...new Set(typeRuns.map((r) => r.model).filter(Boolean))];
      const successCount = typeRuns.filter((r) => !r.error).length;
      const totalDuration = typeRuns.reduce((sum, r) => sum + (r.durationMs || 0), 0);
      const totalTokens = typeRuns.reduce((sum, r) => sum + (r.totalTokens || 0), 0);
      const totalCost = typeRuns.reduce((sum, r) => sum + (r.costUsd || 0), 0);
      const sortedRuns = typeRuns.sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

      return {
        agentType,
        runCount: typeRuns.length,
        models,
        tools: [], // Will be populated from MCP tool calls in the future
        avgDurationMs: totalDuration / typeRuns.length,
        totalTokens,
        totalCost,
        successRate: (successCount / typeRuns.length) * 100,
        lastRun: sortedRuns[0]?.startedAt || "",
      };
    }).sort((a, b) => b.runCount - a.runCount);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("de-DE");
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const totalStats = agents.reduce(
    (acc, agent) => ({
      totalTokens: acc.totalTokens + (agent.totalTokens || 0),
      totalCost: acc.totalCost + (agent.costUsd || 0),
      totalDuration: acc.totalDuration + (agent.durationMs || 0),
    }),
    { totalTokens: 0, totalCost: 0, totalDuration: 0 }
  );

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Agenten</h1>
          <p className="text-sm text-gray-400 mt-1">
            Registrierte LLM-basierte Agenten und deren Ausführungsstatistiken
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Agenten...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* View Toggle */}
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={() => setViewMode("summary")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "summary"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Agenten-Übersicht
              </button>
              <button
                onClick={() => setViewMode("runs")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  viewMode === "runs"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Alle Runs
              </button>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Agenten-Typen</div>
                <div className="text-3xl font-bold text-gray-200">{agentSummaries.length}</div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Total Runs</div>
                <div className="text-3xl font-bold text-gray-200">{agents.length}</div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Total Cost</div>
                <div className="text-3xl font-bold text-gray-200">
                  ${totalStats.totalCost.toFixed(4)}
                </div>
              </div>
            </div>

            {viewMode === "summary" ? (
              /* Agent Summaries List */
              agentSummaries.length === 0 ? (
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
                  <p className="text-gray-400">Keine Agenten gefunden</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {agentSummaries.map((summary) => (
                    <Link
                      key={summary.agentType}
                      href={`/agents/${encodeURIComponent(summary.agentType)}`}
                      className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="text-xl font-semibold text-gray-200 mb-1">
                            {summary.agentType}
                          </h3>
                          <p className="text-sm text-gray-400">
                            {summary.runCount} Ausführungen • Zuletzt: {formatDate(summary.lastRun)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-medium ${
                              summary.successRate >= 95
                                ? "bg-green-900/30 text-green-400"
                                : summary.successRate >= 80
                                ? "bg-yellow-900/30 text-yellow-400"
                                : "bg-red-900/30 text-red-400"
                            }`}
                          >
                            {summary.successRate.toFixed(1)}% Erfolg
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div>
                          <div className="text-xs text-gray-400 mb-1">Modelle</div>
                          <div className="text-sm text-gray-300">
                            {summary.models.length > 0 ? summary.models.join(", ") : "N/A"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">Ø Dauer</div>
                          <div className="text-sm text-gray-300">
                            {formatDuration(summary.avgDurationMs)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">Total Tokens</div>
                          <div className="text-sm text-gray-300">
                            {summary.totalTokens.toLocaleString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400 mb-1">Total Kosten</div>
                          <div className="text-sm text-gray-300">
                            ${summary.totalCost.toFixed(4)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center text-sm text-purple-400 hover:text-purple-300">
                        Details ansehen →
                      </div>
                    </Link>
                  ))}
                </div>
              )
            ) : (
              /* All Agent Runs List */
              agents.length === 0 ? (
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-8 text-center">
                  <p className="text-gray-400">Keine Agent Runs gefunden</p>
                </div>
              ) : (
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/70">
                          <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase">
                            Agent Type
                          </th>
                          <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase">
                            Model
                          </th>
                          <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                            Tokens
                          </th>
                          <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                            Duration
                          </th>
                          <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                            Cost
                          </th>
                          <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase">
                            Started
                          </th>
                          <th className="py-3 px-4 text-center text-xs font-medium text-gray-400 uppercase">
                            Status
                          </th>
                          <th className="py-3 px-4 text-center text-xs font-medium text-gray-400 uppercase">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {agents.map((agent) => (
                          <tr
                            key={agent.id}
                            className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors"
                          >
                            <td className="py-3 px-4 text-sm text-gray-300">
                              <Link
                                href={`/agents/${encodeURIComponent(agent.agentType)}`}
                                className="text-purple-400 hover:text-purple-300"
                              >
                                {agent.agentType}
                              </Link>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-400">
                              {agent.model}
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-300 text-right">
                              <div className="flex flex-col items-end">
                                <span className="font-medium">{agent.totalTokens?.toLocaleString()}</span>
                                <span className="text-xs text-gray-500">
                                  {agent.promptTokens}↑ {agent.completionTokens}↓
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-300 text-right">
                              {formatDuration(agent.durationMs)}
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-300 text-right">
                              ${agent.costUsd?.toFixed(4) || "0.0000"}
                            </td>
                            <td className="py-3 px-4 text-sm text-gray-400">
                              {formatDate(agent.startedAt)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {agent.error ? (
                                <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-red-900/30 text-red-400">
                                  Error
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-green-900/30 text-green-400">
                                  Success
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => setSelectedAgent(agent)}
                                className="text-xs text-blue-400 hover:text-blue-300"
                              >
                                Details
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Agent Details Modal */}
      {selectedAgent && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-gray-200 mb-4">
              Agent Run Details
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Agent Type</label>
                <div className="text-gray-200">{selectedAgent.agentType}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Model</label>
                <div className="text-gray-200">{selectedAgent.model}</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Prompt Tokens
                  </label>
                  <div className="text-gray-200">{selectedAgent.promptTokens?.toLocaleString()}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Completion Tokens
                  </label>
                  <div className="text-gray-200">{selectedAgent.completionTokens?.toLocaleString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Duration</label>
                  <div className="text-gray-200">{formatDuration(selectedAgent.durationMs)}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Cost</label>
                  <div className="text-gray-200">${selectedAgent.costUsd?.toFixed(4)}</div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Started</label>
                <div className="text-gray-200">{formatDate(selectedAgent.startedAt)}</div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Completed</label>
                <div className="text-gray-200">
                  {selectedAgent.completedAt ? formatDate(selectedAgent.completedAt) : "N/A"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Execution ID</label>
                <div className="text-gray-200 font-mono text-sm">{selectedAgent.executionId}</div>
              </div>

              {selectedAgent.error && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Error</label>
                  <div className="text-red-400 bg-red-900/20 p-3 rounded text-sm">
                    {selectedAgent.error}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedAgent(null)}
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
