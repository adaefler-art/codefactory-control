"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { FactoryStatusResponse, FactoryRunSummary, VerdictSummary } from "../../src/lib/types/factory-status";

export default function FactoryPage() {
  const [factoryStatus, setFactoryStatus] = useState<FactoryStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    fetchFactoryStatus();
    
    // Auto-refresh every 30 seconds if enabled
    const interval = setInterval(() => {
      if (autoRefresh && document.visibilityState === 'visible') {
        fetchFactoryStatus();
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

  async function fetchFactoryStatus() {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch('/api/v1/factory/status?limit=20&errorLimit=10&kpiPeriodHours=24');
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      setFactoryStatus(data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Error fetching factory status:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-blue-500";
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "pending":
        return "bg-yellow-500";
      case "cancelled":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case "running":
        return "text-blue-400";
      case "completed":
        return "text-green-400";
      case "failed":
        return "text-red-400";
      case "pending":
        return "text-yellow-400";
      case "cancelled":
        return "text-gray-400";
      default:
        return "text-gray-400";
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "WAIT_AND_RETRY":
        return "text-blue-400";
      case "OPEN_ISSUE":
        return "text-yellow-400";
      case "HUMAN_REQUIRED":
        return "text-red-400";
      default:
        return "text-gray-400";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("de-DE");
  };

  const formatDuration = (durationMs: number | null) => {
    if (!durationMs) return "N/A";
    
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    } else if (durationMs < 60000) {
      return `${Math.round(durationMs / 1000)}s`;
    } else if (durationMs < 3600000) {
      return `${Math.round(durationMs / 60000)}m`;
    } else {
      return `${Math.round(durationMs / 3600000)}h`;
    }
  };

  const formatTimeSince = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-200">
                Factory Status
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Read-only view of Factory runs, verdicts, and KPIs
              </p>
            </div>
            <div className="flex gap-3 items-center">
              <div className="text-xs text-gray-500">
                Last refresh: {formatTimeSince(lastRefresh)}
              </div>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  autoRefresh 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {autoRefresh ? '✓ Auto-refresh' : 'Auto-refresh OFF'}
              </button>
              <button
                onClick={fetchFactoryStatus}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {isLoading ? 'Refreshing...' : 'Refresh Now'}
              </button>
              <Link
                href="/dashboard"
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && !factoryStatus && (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading factory status...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {factoryStatus && (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Mean Time to Insight */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Mean Time to Insight</h3>
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-gray-200 mb-2">
                  {formatDuration(factoryStatus.kpis.meanTimeToInsightMs)}
                </div>
                <div className="text-xs text-gray-400">
                  Average time to completion
                </div>
              </div>

              {/* Success Rate */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Success Rate</h3>
                  <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-gray-200 mb-2">
                  {factoryStatus.kpis.successRate.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-400">
                  {factoryStatus.kpis.completedExecutions} / {factoryStatus.kpis.totalExecutions} completed
                </div>
              </div>

              {/* Total Executions */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Total Executions</h3>
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-gray-200 mb-2">
                  {factoryStatus.kpis.totalExecutions}
                </div>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span className="text-blue-400">{factoryStatus.kpis.runningExecutions} running</span>
                  <span className="text-red-400">{factoryStatus.kpis.failedExecutions} failed</span>
                </div>
              </div>

              {/* Verdicts */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">Verdicts</h3>
                  <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-gray-200 mb-2">
                  {factoryStatus.verdicts.kpis?.totalVerdicts || 0}
                </div>
                <div className="text-xs text-gray-400">
                  Avg confidence: {factoryStatus.verdicts.kpis?.avgConfidence || 0}%
                </div>
              </div>
            </div>

            {/* Verdict Summary */}
            {factoryStatus.verdicts.enabled && factoryStatus.verdicts.kpis && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 mb-8">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">Verdict Statistics</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* By Action */}
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Actions Proposed</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-400">Wait & Retry</span>
                        <span className="text-sm font-semibold text-gray-200">
                          {factoryStatus.verdicts.kpis.byAction.waitAndRetry}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-yellow-400">Open Issue</span>
                        <span className="text-sm font-semibold text-gray-200">
                          {factoryStatus.verdicts.kpis.byAction.openIssue}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-red-400">Human Required</span>
                        <span className="text-sm font-semibold text-gray-200">
                          {factoryStatus.verdicts.kpis.byAction.humanRequired}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Consistency */}
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Verdict Quality</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-300">Consistency Score</span>
                        <span className="text-sm font-semibold text-gray-200">
                          {factoryStatus.verdicts.kpis.consistencyScore}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-300">Avg Confidence</span>
                        <span className="text-sm font-semibold text-gray-200">
                          {factoryStatus.verdicts.kpis.avgConfidence}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Top Errors */}
                  <div className="bg-gray-800/50 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-gray-400 mb-3">Top Error Classes</h3>
                    <div className="space-y-2">
                      {factoryStatus.verdicts.kpis.topErrorClasses.slice(0, 3).map((error, idx) => (
                        <div key={idx} className="flex justify-between items-center">
                          <span className="text-xs text-gray-300 truncate max-w-[180px]" title={error.errorClass}>
                            {error.errorClass}
                          </span>
                          <span className="text-xs font-semibold text-gray-200">
                            {error.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Factory Runs and Verdicts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Factory Runs */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-200">Recent Factory Runs</h2>
                  <span className="text-xs text-gray-500">
                    {factoryStatus.runs.recent.length} of {factoryStatus.runs.total}
                  </span>
                </div>
                
                {factoryStatus.runs.recent.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No factory runs found</p>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {factoryStatus.runs.recent.map((run) => (
                      <div
                        key={run.id}
                        className="p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-2 h-2 rounded-full mt-1.5 ${getStatusColor(run.status)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-gray-300 truncate">
                                {run.workflowId || 'Unknown Workflow'}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                run.status === "completed"
                                  ? "bg-green-900/30 text-green-400"
                                  : run.status === "failed"
                                  ? "bg-red-900/30 text-red-400"
                                  : run.status === "running"
                                  ? "bg-blue-900/30 text-blue-400"
                                  : "bg-gray-900/30 text-gray-400"
                              }`}>
                                {run.status}
                              </span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Started: {formatDate(run.startedAt)}
                            </div>
                            {run.completedAt && (
                              <div className="text-xs text-gray-500">
                                Duration: {formatDuration(run.durationMs)}
                              </div>
                            )}
                            {run.error && (
                              <div className="text-xs text-red-400 mt-2 p-2 bg-red-900/20 rounded">
                                {run.error}
                              </div>
                            )}
                            {run.policyVersion && (
                              <div className="text-xs text-gray-500 mt-1">
                                Policy: {run.policyVersion}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Verdicts */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-200">Recent Verdicts</h2>
                  <span className="text-xs text-gray-500">
                    {factoryStatus.verdicts.summary?.length || 0} recent
                  </span>
                </div>
                
                {!factoryStatus.verdicts.summary || factoryStatus.verdicts.summary.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No verdicts found</p>
                ) : (
                  <div className="space-y-3 max-h-[600px] overflow-y-auto">
                    {factoryStatus.verdicts.summary.map((verdict) => (
                      <div
                        key={verdict.id}
                        className="p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-300">
                              {verdict.errorClass}
                            </span>
                            <span className="text-xs text-gray-500">
                              {verdict.service}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium ${getActionColor(verdict.proposedAction)}`}>
                              {verdict.proposedAction.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-gray-500">•</span>
                            <span className="text-xs text-gray-400">
                              Confidence: {verdict.confidenceScore}%
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDate(verdict.createdAt)}
                          </div>
                          <div className="text-xs text-gray-600 font-mono">
                            Policy: {verdict.policyVersion}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Errors */}
            {factoryStatus.errors.recent.length > 0 && (
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 mt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-200">Recent Errors</h2>
                  <span className="text-xs text-gray-500">
                    {factoryStatus.errors.recent.length} of {factoryStatus.errors.total}
                  </span>
                </div>
                <div className="space-y-3">
                  {factoryStatus.errors.recent.map((error, idx) => (
                    <div
                      key={idx}
                      className="p-4 bg-red-900/10 border border-red-800/30 rounded-lg"
                    >
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-red-300 mb-1">
                            {error.error}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDate(error.timestamp)} • Execution: {error.executionId.substring(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* API Info Footer */}
            <div className="mt-8 p-4 bg-gray-800/30 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  API Version: {factoryStatus.api.version} • 
                  Snapshot: {formatDate(factoryStatus.timestamp)}
                </div>
                <div>
                  Read-only mode • No mutations allowed
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
