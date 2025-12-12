"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardStats {
  executions: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  agents: {
    total: number;
    totalTokens: number;
    avgDuration: number;
  };
  workflows: {
    total: number;
    enabled: number;
  };
  repositories: {
    total: number;
    enabled: number;
  };
}

interface RecentExecution {
  id: string;
  workflowId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<RecentExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        // Fetch executions
        const executionsRes = await fetch("/api/workflow/executions?limit=10");
        const executionsData = await executionsRes.json();
        
        // Fetch workflows
        const workflowsRes = await fetch("/api/workflows");
        const workflowsData = await workflowsRes.json();
        
        // Fetch agents
        const agentsRes = await fetch("/api/agents?limit=100");
        const agentsData = await agentsRes.json();
        
        // Fetch repositories
        const reposRes = await fetch("/api/repositories");
        const reposData = await reposRes.json();

        // Calculate stats
        const executions = executionsData.executions || [];
        const workflows = workflowsData.workflows || [];
        const agents = agentsData.agents || [];
        const repositories = reposData.repositories || [];

        const executionStats = {
          total: executions.length,
          running: executions.filter((e: any) => e.status === 'running').length,
          completed: executions.filter((e: any) => e.status === 'completed').length,
          failed: executions.filter((e: any) => e.status === 'failed').length,
        };

        const agentStats = {
          total: agents.length,
          totalTokens: agents.reduce((sum: number, a: any) => sum + (a.totalTokens || 0), 0),
          avgDuration: agents.length > 0 
            ? Math.round(agents.reduce((sum: number, a: any) => sum + (a.durationMs || 0), 0) / agents.length)
            : 0,
        };

        const workflowStats = {
          total: workflows.length,
          enabled: workflows.filter((w: any) => w.enabled).length,
        };

        const repoStats = {
          total: repositories.length,
          enabled: repositories.filter((r: any) => r.enabled).length,
        };

        setStats({
          executions: executionStats,
          agents: agentStats,
          workflows: workflowStats,
          repositories: repoStats,
        });

        setRecentExecutions(executions.slice(0, 5));
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError("Fehler beim Laden der Dashboard-Daten");
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("de-DE");
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-blue-500";
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">
            AFU-9 Dashboard
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Übersicht über Workflows, Agents und System-Status
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Lädt Dashboard...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-300">{error}</p>
          </div>
        )}

        {!isLoading && !error && stats && (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* Workflow Executions */}
              <Link href="/workflows" className="block">
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-400">Workflow Executions</h3>
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-gray-200 mb-2">{stats.executions.total}</div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span className="text-blue-400">{stats.executions.running} running</span>
                    <span className="text-green-400">{stats.executions.completed} completed</span>
                    <span className="text-red-400">{stats.executions.failed} failed</span>
                  </div>
                </div>
              </Link>

              {/* Agent Runs */}
              <Link href="/agents" className="block">
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-400">Agent Runs</h3>
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-gray-200 mb-2">{stats.agents.total}</div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    <span>{stats.agents.totalTokens.toLocaleString()} tokens</span>
                    <span>{stats.agents.avgDuration}ms avg</span>
                  </div>
                </div>
              </Link>

              {/* Workflows */}
              <Link href="/workflows" className="block">
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-400">Workflows</h3>
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-gray-200 mb-2">{stats.workflows.total}</div>
                  <div className="text-xs text-gray-400">
                    {stats.workflows.enabled} enabled
                  </div>
                </div>
              </Link>

              {/* Repositories */}
              <Link href="/repositories" className="block">
                <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 hover:bg-gray-900/70 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-400">Repositories</h3>
                    <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <div className="text-3xl font-bold text-gray-200 mb-2">{stats.repositories.total}</div>
                  <div className="text-xs text-gray-400">
                    {stats.repositories.enabled} enabled
                  </div>
                </div>
              </Link>
            </div>

            {/* Recent Executions */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-200 mb-4">Recent Executions</h2>
              {recentExecutions.length === 0 ? (
                <p className="text-gray-400 text-center py-8">Keine Executions gefunden</p>
              ) : (
                <div className="space-y-3">
                  {recentExecutions.map((execution) => (
                    <div
                      key={execution.id}
                      className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(execution.status)}`} />
                        <div className="flex-1">
                          <div className="text-sm text-gray-300 font-medium">
                            {execution.workflowId || "Unknown Workflow"}
                          </div>
                          <div className="text-xs text-gray-500">
                            Started: {formatDate(execution.startedAt)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs px-2 py-1 rounded ${
                          execution.status === "completed"
                            ? "bg-green-900/30 text-green-400"
                            : execution.status === "failed"
                            ? "bg-red-900/30 text-red-400"
                            : "bg-blue-900/30 text-blue-400"
                        }`}>
                          {execution.status}
                        </span>
                        <Link
                          href={`/workflow/execution/${execution.id}`}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          View →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
