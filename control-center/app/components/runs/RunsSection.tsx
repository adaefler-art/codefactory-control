/**
 * Runs Section Component
 * 
 * Displays runs for an issue with list, detail viewer, and run/rerun actions.
 * 
 * Reference: I633 (Issue UI Runs Tab)
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { safeFetch, formatErrorMessage, isApiError } from "@/lib/api/safe-fetch";

interface RunSummary {
  runId: string;
  title: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  playbookId: string | null;
  parentRunId: string | null;
}

interface StepResult {
  name: string;
  status: "pending" | "running" | "success" | "failed" | "timeout" | "skipped";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

interface ArtifactMetadata {
  id: string;
  kind: "log" | "file";
  name: string;
  ref: string;
  bytes?: number;
  stepIdx?: number;
}

interface RunResult {
  runId: string;
  issueId?: string;
  title: string;
  runtime: string;
  status: "created" | "running" | "success" | "failed" | "timeout" | "cancelled";
  steps: StepResult[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  artifacts?: ArtifactMetadata[];
}

interface Playbook {
  id: string;
  name: string;
  description?: string;
}

interface RunsSectionProps {
  issueId: string;
}

export function RunsSection({ issueId }: RunsSectionProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunResult | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isLoadingPlaybooks, setIsLoadingPlaybooks] = useState(false);
  const [isCreatingRun, setIsCreatingRun] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlaybookSelector, setShowPlaybookSelector] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  
  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Track polling interval for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clean up polling on unmount
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  // Fetch runs list
  const fetchRuns = useCallback(async () => {
    setIsLoadingRuns(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${issueId}/runs`, {
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeFetch<{ runs: RunSummary[] }>(response);
      setRuns(data.runs || []);
    } catch (err) {
      console.error("Error fetching runs:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoadingRuns(false);
    }
  }, [issueId]);

  // Fetch run details (without polling - polling managed by useEffect)
  const fetchRunDetail = useCallback(async (runId: string, signal?: AbortSignal) => {
    if (!isMountedRef.current) return;
    
    setIsLoadingDetail(true);
    setError(null);

    try {
      const response = await fetch(`/api/runs/${runId}`, {
        credentials: "include",
        cache: "no-store",
        signal,
      });

      const data = await safeFetch<RunResult>(response);
      
      if (!isMountedRef.current) return;
      
      setSelectedRun(data);
    } catch (err) {
      // Ignore AbortError (expected when component unmounts or selection changes)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      
      console.error("Error fetching run detail:", err);
      if (isMountedRef.current) {
        setError(formatErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoadingDetail(false);
      }
    }
  }, []);

  // Polling effect: polls selected run if it's in RUNNING status
  // Reference: I633, Merge-Blocker C (Polling/Unmount Cleanup)
  useEffect(() => {
    // Clear any existing interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Don't poll if no run selected or run is not running
    if (!selectedRunId || !selectedRun || selectedRun.status !== 'running') {
      return;
    }

    // Create AbortController for fetch cancellation
    const abortController = new AbortController();

    // Start polling interval
    pollingIntervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        fetchRunDetail(selectedRunId, abortController.signal);
      }
    }, 3000);

    // Cleanup function
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      abortController.abort();
    };
  }, [selectedRunId, selectedRun?.status, fetchRunDetail]);

  // Fetch playbooks
  const fetchPlaybooks = useCallback(async () => {
    setIsLoadingPlaybooks(true);

    try {
      const response = await fetch("/api/playbooks", {
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeFetch<{ playbooks: Playbook[] }>(response);
      setPlaybooks(data.playbooks || []);
    } catch (err) {
      console.error("Error fetching playbooks:", err);
    } finally {
      setIsLoadingPlaybooks(false);
    }
  }, []);

  // Create and execute run
  const handleRunPlaybook = async (playbookId: string) => {
    setIsCreatingRun(true);
    setError(null);
    setShowPlaybookSelector(false);

    try {
      const response = await fetch(`/api/issues/${issueId}/runs`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          playbookId,
          autoExecute: true,
        }),
      });

      const data = await safeFetch<{ runId: string }>(response);

      // Refresh runs list
      await fetchRuns();

      // Select and show the new run
      setSelectedRunId(data.runId);
      await fetchRunDetail(data.runId);
    } catch (err) {
      console.error("Error creating run:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsCreatingRun(false);
    }
  };

  // Re-run
  const handleRerun = async () => {
    if (!selectedRunId) return;

    setIsRerunning(true);
    setError(null);

    try {
      const response = await fetch(`/api/runs/${selectedRunId}/rerun`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          autoExecute: true,
        }),
      });

      const data = await safeFetch<{ newRunId: string }>(response);

      // Refresh runs list
      await fetchRuns();

      // Select and show the new run
      setSelectedRunId(data.newRunId);
      await fetchRunDetail(data.newRunId);
    } catch (err) {
      console.error("Error re-running:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsRerunning(false);
    }
  };

  // Toggle step expansion
  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  useEffect(() => {
    fetchRuns();
    fetchPlaybooks();
  }, [fetchRuns, fetchPlaybooks]);

  useEffect(() => {
    if (selectedRunId) {
      fetchRunDetail(selectedRunId);
    }
  }, [selectedRunId, fetchRunDetail]);

  // Helper functions
  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "QUEUED":
      case "created":
      case "pending":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      case "RUNNING":
      case "running":
        return "bg-blue-900/30 text-blue-200 border border-blue-700 animate-pulse";
      case "SUCCEEDED":
      case "success":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "FAILED":
      case "failed":
      case "timeout":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "CANCELLED":
      case "cancelled":
      case "skipped":
        return "bg-orange-900/30 text-orange-200 border border-orange-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-gray-800/30 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-purple-400">Runs</h2>
          <div className="relative">
            <button
              onClick={() => setShowPlaybookSelector(!showPlaybookSelector)}
              disabled={isCreatingRun}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCreatingRun ? "Starting..." : "Run Playbook"}
            </button>

            {showPlaybookSelector && (
              <div className="absolute right-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10">
                <div className="p-2">
                  <div className="text-xs text-gray-400 px-2 py-1">
                    Select a playbook to run:
                  </div>
                  {isLoadingPlaybooks ? (
                    <div className="px-2 py-3 text-sm text-gray-500">Loading...</div>
                  ) : playbooks.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-gray-500">No playbooks available</div>
                  ) : (
                    playbooks.map((playbook) => (
                      <button
                        key={playbook.id}
                        onClick={() => handleRunPlaybook(playbook.id)}
                        className="w-full text-left px-2 py-2 text-sm text-gray-200 hover:bg-gray-700 rounded transition-colors"
                      >
                        <div className="font-medium">{playbook.name}</div>
                        {playbook.description && (
                          <div className="text-xs text-gray-400 mt-0.5">{playbook.description}</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-gray-700 p-2">
                  <button
                    onClick={() => setShowPlaybookSelector(false)}
                    className="w-full px-2 py-1 text-xs text-gray-400 hover:text-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-6 mt-4 bg-red-900/20 border border-red-700 rounded-lg p-4">
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 divide-x divide-gray-800">
        {/* Runs List */}
        <div className="lg:col-span-1 p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Run History</h3>

          {isLoadingRuns ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
              <p className="mt-2 text-sm text-gray-400">Loading runs...</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400">No runs yet</p>
              <p className="text-xs text-gray-500 mt-1">Click "Run Playbook" to start</p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedRunId === run.runId
                      ? "bg-purple-900/30 border border-purple-700"
                      : "bg-gray-800/30 border border-gray-700 hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="text-sm font-medium text-gray-200 truncate flex-1">
                      {run.title}
                    </div>
                    <span
                      className={`ml-2 px-2 py-0.5 text-xs font-medium rounded ${getStatusBadgeColor(
                        run.status
                      )}`}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDate(run.createdAt)}
                  </div>
                  {run.parentRunId && (
                    <div className="text-xs text-purple-400 mt-1">
                      ↻ Re-run
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Run Detail */}
        <div className="lg:col-span-2 p-4">
          {!selectedRunId ? (
            <div className="text-center py-12 text-gray-400">
              Select a run to view details
            </div>
          ) : isLoadingDetail ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
              <p className="mt-2 text-sm text-gray-400">Loading run details...</p>
            </div>
          ) : !selectedRun ? (
            <div className="text-center py-12 text-red-400">
              Failed to load run details
            </div>
          ) : (
            <div className="space-y-4">
              {/* Run Header */}
              <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-purple-400">
                      {selectedRun.title}
                    </h3>
                    <div className="text-xs text-gray-500 mt-1">
                      Run ID: {selectedRun.runId}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 text-sm font-medium rounded-md ${getStatusBadgeColor(
                        selectedRun.status
                      )}`}
                    >
                      {selectedRun.status.toUpperCase()}
                    </span>
                    {selectedRun.status !== "running" && (
                      <button
                        onClick={handleRerun}
                        disabled={isRerunning}
                        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
                      >
                        {isRerunning ? "Re-running..." : "Re-run"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-gray-400">Created</div>
                    <div className="text-gray-200">{formatDate(selectedRun.createdAt)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Started</div>
                    <div className="text-gray-200">{formatDate(selectedRun.startedAt || null)}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Duration</div>
                    <div className="text-gray-200">{formatDuration(selectedRun.durationMs)}</div>
                  </div>
                </div>
              </div>

              {/* Steps */}
              <div>
                <h4 className="text-sm font-semibold text-gray-300 mb-2">Steps</h4>
                <div className="space-y-2">
                  {selectedRun.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="bg-gray-800/30 border border-gray-700 rounded-lg overflow-hidden"
                    >
                      <button
                        onClick={() => toggleStep(idx)}
                        className="w-full text-left p-3 hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-gray-500 text-sm">#{idx + 1}</span>
                            <span className="text-gray-200 font-medium">{step.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusBadgeColor(
                                step.status
                              )}`}
                            >
                              {step.status}
                            </span>
                            {step.exitCode !== undefined && (
                              <span className="text-xs text-gray-500">
                                exit: {step.exitCode}
                              </span>
                            )}
                            <span className="text-gray-500 text-sm">
                              {expandedSteps.has(idx) ? "▼" : "▶"}
                            </span>
                          </div>
                        </div>
                      </button>

                      {expandedSteps.has(idx) && (
                        <div className="border-t border-gray-700 p-3 bg-gray-900/50 space-y-2">
                          {step.durationMs !== undefined && (
                            <div className="text-xs text-gray-400">
                              Duration: {formatDuration(step.durationMs)}
                            </div>
                          )}

                          {step.stdout && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">Output:</div>
                              <pre className="text-xs bg-black/30 border border-gray-700 rounded p-2 overflow-x-auto text-green-300 font-mono">
                                {step.stdout}
                              </pre>
                            </div>
                          )}

                          {step.stderr && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">Errors:</div>
                              <pre className="text-xs bg-black/30 border border-gray-700 rounded p-2 overflow-x-auto text-red-300 font-mono">
                                {step.stderr}
                              </pre>
                            </div>
                          )}

                          {step.error && (
                            <div>
                              <div className="text-xs text-gray-400 mb-1">Error Message:</div>
                              <div className="text-xs bg-red-900/20 border border-red-700 rounded p-2 text-red-300">
                                {step.error}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Artifacts */}
              {selectedRun.artifacts && selectedRun.artifacts.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-300 mb-2">Artifacts</h4>
                  <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-3">
                    <div className="space-y-2">
                      {selectedRun.artifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 text-xs font-medium rounded ${
                                artifact.kind === "log"
                                  ? "bg-blue-900/30 text-blue-200 border border-blue-700"
                                  : "bg-purple-900/30 text-purple-200 border border-purple-700"
                              }`}
                            >
                              {artifact.kind}
                            </span>
                            <span className="text-gray-200">{artifact.name}</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {artifact.bytes ? `${(artifact.bytes / 1024).toFixed(1)} KB` : "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Error Summary */}
              {selectedRun.error && (
                <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-red-300 mb-2">Error</h4>
                  <div className="text-sm text-red-200">{selectedRun.error}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
