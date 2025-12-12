"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  toolCalls?: any[];
}

interface AgentDetails {
  agentType: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  models: string[];
  tools: string[];
  avgDurationMs: number;
  avgTokens: number;
  totalCost: number;
  runs: AgentRun[];
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentType = decodeURIComponent(params.agentType as string);
  
  const [agentDetails, setAgentDetails] = useState<AgentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "success" | "error">("all");

  useEffect(() => {
    async function fetchAgentDetails() {
      try {
        const response = await fetch(
          `/api/agents/${encodeURIComponent(agentType)}`
        );
        const data = await response.json();

        if (response.ok) {
          setAgentDetails(data);
        } else {
          setError(data.error || "Fehler beim Laden der Agent-Details");
        }
      } catch (err) {
        console.error("Error fetching agent details:", err);
        setError("Fehler beim Laden der Agent-Details");
      } finally {
        setIsLoading(false);
      }
    }

    fetchAgentDetails();
  }, [agentType]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("de-DE");
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const filteredRuns = agentDetails?.runs.filter((run) => {
    if (filterStatus === "all") return true;
    if (filterStatus === "success") return !run.error;
    if (filterStatus === "error") return !!run.error;
    return true;
  }) || [];

  const successRate = agentDetails
    ? (agentDetails.successfulRuns / agentDetails.totalRuns) * 100
    : 0;

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
            <Link href="/agents" className="hover:text-purple-400">
              Agenten
            </Link>
            <span>→</span>
            <span className="text-gray-300">{agentType}</span>
          </div>
          <h1 className="text-2xl font-semibold text-gray-200">{agentType}</h1>
          <p className="text-sm text-gray-400 mt-1">
            Detaillierte Statistiken und Ausführungshistorie
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Agent-Details...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && agentDetails && (
          <>
            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Total Runs</div>
                <div className="text-3xl font-bold text-gray-200">
                  {agentDetails.totalRuns}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {agentDetails.successfulRuns} erfolgreich, {agentDetails.failedRuns} fehlgeschlagen
                </div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Erfolgsrate</div>
                <div className="text-3xl font-bold text-gray-200">
                  {successRate.toFixed(1)}%
                </div>
                <div className={`text-xs mt-2 ${
                  successRate >= 95 ? "text-green-400" :
                  successRate >= 80 ? "text-yellow-400" : "text-red-400"
                }`}>
                  {successRate >= 95 ? "Sehr gut" :
                   successRate >= 80 ? "Gut" : "Verbesserung nötig"}
                </div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Ø Dauer</div>
                <div className="text-3xl font-bold text-gray-200">
                  {formatDuration(agentDetails.avgDurationMs)}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Durchschnittliche Ausführungszeit
                </div>
              </div>
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="text-sm text-gray-400 mb-1">Total Kosten</div>
                <div className="text-3xl font-bold text-gray-200">
                  ${agentDetails.totalCost.toFixed(4)}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  Ø {agentDetails.avgTokens.toLocaleString()} Tokens/Run
                </div>
              </div>
            </div>

            {/* Models and Tools Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-4">
                  Verwendete Modelle
                </h3>
                {agentDetails.models.length === 0 ? (
                  <p className="text-sm text-gray-400">Keine Modelle gefunden</p>
                ) : (
                  <div className="space-y-2">
                    {agentDetails.models.map((model) => (
                      <div
                        key={model}
                        className="bg-gray-800/50 px-3 py-2 rounded text-sm text-gray-300"
                      >
                        {model}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-gray-200 mb-4">
                  Verwendete Tools
                </h3>
                {agentDetails.tools.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Tool-Daten werden aus MCP Tool Calls geladen (noch keine verfügbar)
                  </p>
                ) : (
                  <div className="space-y-2">
                    {agentDetails.tools.map((tool) => (
                      <div
                        key={tool}
                        className="bg-gray-800/50 px-3 py-2 rounded text-sm text-gray-300 font-mono"
                      >
                        {tool}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Run History */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-200">
                  Ausführungshistorie
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFilterStatus("all")}
                    className={`px-3 py-1 rounded text-sm ${
                      filterStatus === "all"
                        ? "bg-purple-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Alle ({agentDetails.totalRuns})
                  </button>
                  <button
                    onClick={() => setFilterStatus("success")}
                    className={`px-3 py-1 rounded text-sm ${
                      filterStatus === "success"
                        ? "bg-green-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Erfolgreich ({agentDetails.successfulRuns})
                  </button>
                  <button
                    onClick={() => setFilterStatus("error")}
                    className={`px-3 py-1 rounded text-sm ${
                      filterStatus === "error"
                        ? "bg-red-600 text-white"
                        : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                    }`}
                  >
                    Fehler ({agentDetails.failedRuns})
                  </button>
                </div>
              </div>

              {filteredRuns.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">
                  Keine Runs gefunden
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase">
                          Gestartet
                        </th>
                        <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 uppercase">
                          Model
                        </th>
                        <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                          Dauer
                        </th>
                        <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                          Tokens
                        </th>
                        <th className="py-3 px-4 text-right text-xs font-medium text-gray-400 uppercase">
                          Kosten
                        </th>
                        <th className="py-3 px-4 text-center text-xs font-medium text-gray-400 uppercase">
                          Status
                        </th>
                        <th className="py-3 px-4 text-center text-xs font-medium text-gray-400 uppercase">
                          Aktionen
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((run) => (
                        <tr
                          key={run.id}
                          className="border-b border-gray-800 hover:bg-gray-800/30 transition-colors"
                        >
                          <td className="py-3 px-4 text-sm text-gray-400">
                            {formatDate(run.startedAt)}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-300">
                            {run.model}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-300 text-right">
                            {formatDuration(run.durationMs)}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-300 text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-medium">
                                {run.totalTokens?.toLocaleString()}
                              </span>
                              <span className="text-xs text-gray-500">
                                {run.promptTokens}↑ {run.completionTokens}↓
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-300 text-right">
                            ${run.costUsd?.toFixed(4) || "0.0000"}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {run.error ? (
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
                              onClick={() => setSelectedRun(run)}
                              className="text-xs text-purple-400 hover:text-purple-300"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Run Details Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold text-gray-200 mb-4">
              Run Details
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Run ID
                </label>
                <div className="text-gray-200 font-mono text-sm">
                  {selectedRun.id}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Execution ID
                </label>
                <div className="text-gray-200 font-mono text-sm">
                  {selectedRun.executionId}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Gestartet
                  </label>
                  <div className="text-gray-200">{formatDate(selectedRun.startedAt)}</div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Abgeschlossen
                  </label>
                  <div className="text-gray-200">
                    {selectedRun.completedAt ? formatDate(selectedRun.completedAt) : "N/A"}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Model
                </label>
                <div className="text-gray-200">{selectedRun.model}</div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Prompt Tokens
                  </label>
                  <div className="text-gray-200">
                    {selectedRun.promptTokens?.toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Completion Tokens
                  </label>
                  <div className="text-gray-200">
                    {selectedRun.completionTokens?.toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Total Tokens
                  </label>
                  <div className="text-gray-200">
                    {selectedRun.totalTokens?.toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Dauer
                  </label>
                  <div className="text-gray-200">
                    {formatDuration(selectedRun.durationMs)}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Kosten
                  </label>
                  <div className="text-gray-200">
                    ${selectedRun.costUsd?.toFixed(4)}
                  </div>
                </div>
              </div>

              {selectedRun.error && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Error
                  </label>
                  <div className="text-red-400 bg-red-900/20 p-3 rounded text-sm">
                    {selectedRun.error}
                  </div>
                </div>
              )}

              {selectedRun.toolCalls && selectedRun.toolCalls.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">
                    Tool Calls
                  </label>
                  <div className="bg-gray-800/50 p-3 rounded text-sm font-mono text-gray-300 max-h-64 overflow-y-auto">
                    <pre>{JSON.stringify(selectedRun.toolCalls, null, 2)}</pre>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedRun(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
