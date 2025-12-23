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
    errorRate: number;
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
  currentStep?: string;
  totalSteps?: number;
}

interface AgentRun {
  id: string;
  executionId: string;
  agentType: string;
  model: string;
  totalTokens: number;
  durationMs: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface DeployEvent {
  id: string;
  created_at: string;
  message: string | null;
}

interface InfrastructureHealth {
  status: string;
  cluster?: string;
  service?: string;
  metrics?: {
    cpu?: {
      datapoints?: Array<{ timestamp: Date; average?: number; maximum?: number }>;
    };
    memory?: {
      datapoints?: Array<{ timestamp: Date; average?: number; maximum?: number }>;
    };
    alb5xx?: {
      datapoints?: Array<{ timestamp: Date; sum?: number; average?: number }>;
    };
  };
  error?: string;
  message?: string;
}

interface AlarmSummary {
  total: number;
  ok: number;
  alarm: number;
  insufficientData: number;
}

interface AlarmStatus {
  status: string;
  data?: {
    summary: AlarmSummary;
  };
  error?: string;
  message?: string;
}

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<RecentExecution[]>([]);
  const [recentAgents, setRecentAgents] = useState<AgentRun[]>([]);
  const [latestDeployEvent, setLatestDeployEvent] = useState<DeployEvent | null>(null);
  const [deployEventStatus, setDeployEventStatus] = useState<"loading" | "loaded" | "unavailable">("loading");
  const [infrastructureHealth, setInfrastructureHealth] = useState<InfrastructureHealth | null>(null);
  const [alarmStatus, setAlarmStatus] = useState<AlarmStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setDeployEventStatus("loading");

        // Fetch executions
        const executionsRes = await fetch("/api/workflow/executions?limit=10", { credentials: "include" });
        const executionsData = await executionsRes.json();
        
        // Fetch workflows
        const workflowsRes = await fetch("/api/workflows", { credentials: "include" });
        const workflowsData = await workflowsRes.json();
        
        // Fetch agents
        const agentsRes = await fetch("/api/agents?limit=100", { credentials: "include" });
        const agentsData = await agentsRes.json();
        
        // Fetch repositories
        const reposRes = await fetch("/api/repositories", { credentials: "include" });
        const reposData = await reposRes.json();

        // Fetch infrastructure health
        const healthRes = await fetch("/api/infrastructure/health", { credentials: "include" });
        const healthData = await healthRes.json();

        // Fetch alarm status
        const alarmsRes = await fetch("/api/observability/alarms", { credentials: "include" });
        const alarmsData = await alarmsRes.json();

        // Fetch latest deploy event (AFU9-TL-001)
        try {
          const deployEventsRes = await fetch("/api/deploy-events?limit=1", { credentials: "include" });

          if (!deployEventsRes.ok) {
            setLatestDeployEvent(null);
            setDeployEventStatus("unavailable");
          } else {
            const deployEventsData = await deployEventsRes.json();
            const maybeEvent = Array.isArray(deployEventsData?.events) ? (deployEventsData.events[0] as DeployEvent | undefined) : undefined;

            setLatestDeployEvent(maybeEvent ?? null);
            setDeployEventStatus("loaded");
          }
        } catch {
          setLatestDeployEvent(null);
          setDeployEventStatus("unavailable");
        }

        // Calculate stats
        const executions = executionsData.executions || [];
        const workflows = workflowsData.workflows || [];
        const agents = agentsData.agents || [];
        const repositories = reposData.repositories || [];

        const executionStats = {
          total: executions.length,
          running: executions.filter((e: { status: string }) => e.status === 'running').length,
          completed: executions.filter((e: { status: string }) => e.status === 'completed').length,
          failed: executions.filter((e: { status: string }) => e.status === 'failed').length,
        };

        // Calculate agent error rate
        const agentsWithErrors = agents.filter((a: { error?: string }) => a.error).length;
        const errorRate = agents.length > 0 ? (agentsWithErrors / agents.length) * 100 : 0;
        const DECIMAL_PLACES = 10; // Multiplier for rounding to 1 decimal place

        const agentStats = {
          total: agents.length,
          totalTokens: agents.reduce((sum: number, a: { totalTokens?: number }) => sum + (a.totalTokens || 0), 0),
          avgDuration: agents.length > 0 
            ? Math.round(agents.reduce((sum: number, a: { durationMs?: number }) => sum + (a.durationMs || 0), 0) / agents.length)
            : 0,
          errorRate: Math.round(errorRate * DECIMAL_PLACES) / DECIMAL_PLACES,
        };

        const workflowStats = {
          total: workflows.length,
          enabled: workflows.filter((w: { enabled: boolean }) => w.enabled).length,
        };

        const repoStats = {
          total: repositories.length,
          enabled: repositories.filter((r: { enabled: boolean }) => r.enabled).length,
        };

        setStats({
          executions: executionStats,
          agents: agentStats,
          workflows: workflowStats,
          repositories: repoStats,
        });

        setRecentExecutions(executions.slice(0, 5));
        setRecentAgents(agents.slice(0, 5));
        setInfrastructureHealth(healthData);
        setAlarmStatus(alarmsData);
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

  const formatDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const durationMs = end - start;
    
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

  const getLatestMetricValue = (datapoints?: Array<{ timestamp: Date; average?: number; maximum?: number }>) => {
    if (!datapoints || datapoints.length === 0) return null;
    // Find the datapoint with the most recent timestamp without sorting
    return datapoints.reduce((latest, current) => {
      const latestTime = new Date(latest.timestamp).getTime();
      const currentTime = new Date(current.timestamp).getTime();
      return currentTime > latestTime ? current : latest;
    });
  };

  const getOverallHealthStatus = (): HealthStatus => {
    // Determine overall health based on alarms and infrastructure
    if (!alarmStatus || !infrastructureHealth) {
      return 'unknown';
    }

    // Critical if any alarms are in ALARM state
    if (alarmStatus.status === 'success' && alarmStatus.data?.summary.alarm > 0) {
      return 'critical';
    }

    // Warning if infrastructure is unavailable or has issues
    if (infrastructureHealth.status === 'unavailable' || infrastructureHealth.status === 'error') {
      return 'warning';
    }

    // Warning if insufficient data on alarms
    if (alarmStatus.status === 'success' && alarmStatus.data?.summary.insufficientData > 0) {
      return 'warning';
    }

    // Healthy if all alarms OK and infrastructure is OK
    if (alarmStatus.status === 'success' && infrastructureHealth.status === 'ok') {
      return 'healthy';
    }

    return 'unknown';
  };

  const getHealthStatusColor = (status: HealthStatus) => {
    switch (status) {
      case 'healthy':
        return {
          bg: 'bg-green-500',
          text: 'text-green-500',
          border: 'border-green-500',
          lightBg: 'bg-green-900/20',
          label: 'Healthy',
          icon: '✓',
        };
      case 'warning':
        return {
          bg: 'bg-yellow-500',
          text: 'text-yellow-500',
          border: 'border-yellow-500',
          lightBg: 'bg-yellow-900/20',
          label: 'Warning',
          icon: '⚠',
        };
      case 'critical':
        return {
          bg: 'bg-red-500',
          text: 'text-red-500',
          border: 'border-red-500',
          lightBg: 'bg-red-900/20',
          label: 'Critical',
          icon: '✕',
        };
      default:
        return {
          bg: 'bg-gray-500',
          text: 'text-gray-500',
          border: 'border-gray-500',
          lightBg: 'bg-gray-900/20',
          label: 'Unknown',
          icon: '?',
        };
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-200">
                AFU-9 Dashboard
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Übersicht über Workflows, Agents und System-Status
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href="/factory"
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium"
              >
                Factory Status
              </Link>
              <Link
                href="/observability"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Observability
              </Link>
              <Link
                href="/settings"
                className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium"
              >
                Settings
              </Link>
            </div>
          </div>
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
                  <div className="flex flex-col gap-1 text-xs text-gray-400">
                    <span>{stats.agents.totalTokens.toLocaleString()} tokens · {stats.agents.avgDuration}ms avg</span>
                    <span className={stats.agents.errorRate > 10 ? "text-red-400" : "text-green-400"}>
                      {stats.agents.errorRate}% error rate
                    </span>
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

            {/* Latest Deploy Event */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-lg font-semibold text-gray-200 mb-2">Latest Deploy Event</h2>
              <p className="text-sm text-gray-400 mb-4">
                Neuester Eintrag aus <span className="text-gray-300">deploy_events</span>
              </p>

              {deployEventStatus === "loading" ? (
                <div className="text-gray-400">Loading latest deploy event...</div>
              ) : latestDeployEvent ? (
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <div className="text-xs text-gray-500 mb-2">
                    {formatDate(latestDeployEvent.created_at)}
                  </div>
                  <div className="text-sm text-gray-200">
                    {latestDeployEvent.message ?? "—"}
                  </div>
                </div>
              ) : deployEventStatus === "unavailable" ? (
                <div className="text-gray-400">Deploy events unavailable</div>
              ) : (
                <div className="text-gray-400">No deploy events found</div>
              )}
            </div>

            {/* System Health Status Card */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 mb-8">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-gray-200 mb-2">System Health Status</h2>
                  <p className="text-sm text-gray-400 mb-4">
                    Overall infrastructure and monitoring status
                  </p>
                </div>
                <Link
                  href="/observability"
                  className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  View Details →
                </Link>
              </div>

              {alarmStatus && infrastructureHealth ? (
                (() => {
                  const healthStatus = getOverallHealthStatus();
                  const statusConfig = getHealthStatusColor(healthStatus);
                  return (
                    <div className={`${statusConfig.lightBg} border ${statusConfig.border} rounded-lg p-6`}>
                      <div className="flex items-center gap-6">
                        {/* Status Indicator */}
                        <div className="flex flex-col items-center">
                          <div className={`w-20 h-20 ${statusConfig.bg} rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-lg`}>
                            {statusConfig.icon}
                          </div>
                          <span className={`text-sm font-semibold mt-2 ${statusConfig.text}`}>
                            {statusConfig.label}
                          </span>
                        </div>

                        {/* Status Details */}
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Alarms */}
                          <div className="bg-gray-800/50 rounded-lg p-4">
                            <div className="text-xs text-gray-400 mb-1">CloudWatch Alarms</div>
                            {alarmStatus.status === 'success' && alarmStatus.data ? (
                              <div className="space-y-1">
                                <div className="text-sm text-gray-200">
                                  <span className={alarmStatus.data.summary.alarm > 0 ? 'text-red-400 font-semibold' : 'text-green-400'}>
                                    {alarmStatus.data.summary.alarm}
                                  </span>
                                  {' '}in ALARM
                                </div>
                                <div className="text-xs text-gray-500">
                                  {alarmStatus.data.summary.ok} OK · {alarmStatus.data.summary.insufficientData} no data
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-yellow-400">Unavailable</div>
                            )}
                          </div>

                          {/* Infrastructure */}
                          <div className="bg-gray-800/50 rounded-lg p-4">
                            <div className="text-xs text-gray-400 mb-1">Infrastructure</div>
                            {infrastructureHealth.status === 'ok' ? (
                              <div className="space-y-1">
                                <div className="text-sm text-green-400">Operational</div>
                                <div className="text-xs text-gray-500">
                                  {infrastructureHealth.cluster}/{infrastructureHealth.service}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="text-sm text-yellow-400">
                                  {infrastructureHealth.status === 'unavailable' ? 'Metrics Unavailable' : 'Degraded'}
                                </div>
                                {infrastructureHealth.message && (
                                  <div className="text-xs text-gray-500">{infrastructureHealth.message}</div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Recent Metrics */}
                          <div className="bg-gray-800/50 rounded-lg p-4">
                            <div className="text-xs text-gray-400 mb-1">Recent Metrics</div>
                            {infrastructureHealth.metrics ? (
                              <div className="space-y-1">
                                {(() => {
                                  const latestCpu = getLatestMetricValue(infrastructureHealth.metrics.cpu?.datapoints);
                                  const latestMemory = getLatestMetricValue(infrastructureHealth.metrics.memory?.datapoints);
                                  return (
                                    <>
                                      <div className="text-xs text-gray-300">
                                        CPU: {latestCpu ? `${latestCpu.average?.toFixed(1)}%` : 'N/A'}
                                      </div>
                                      <div className="text-xs text-gray-300">
                                        Memory: {latestMemory ? `${latestMemory.average?.toFixed(1)}%` : 'N/A'}
                                      </div>
                                    </>
                                  );
                                })()}
                              </div>
                            ) : (
                              <div className="text-sm text-gray-500">No data</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 text-center">
                  <div className="text-gray-400">Loading system health status...</div>
                </div>
              )}
            </div>

            {/* Grid layout for detailed sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Active & Recent Workflows */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">Active & Recent Workflows</h2>
                {recentExecutions.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">Keine Executions gefunden</p>
                ) : (
                  <div className="space-y-3">
                    {recentExecutions.map((execution) => (
                      <div
                        key={execution.id}
                        className="flex items-start justify-between p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-start gap-3 flex-1">
                          <div className={`w-2 h-2 rounded-full mt-1.5 ${getStatusColor(execution.status)}`} />
                          <div className="flex-1">
                            <div className="text-sm text-gray-300 font-medium">
                              {execution.workflowId || "Unknown Workflow"}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              Started: {formatDate(execution.startedAt)}
                            </div>
                            <div className="flex gap-3 mt-2 text-xs">
                              <span className={`px-2 py-0.5 rounded ${
                                execution.status === "completed"
                                  ? "bg-green-900/30 text-green-400"
                                  : execution.status === "failed"
                                  ? "bg-red-900/30 text-red-400"
                                  : "bg-blue-900/30 text-blue-400"
                              }`}>
                                {execution.status}
                              </span>
                              {execution.status === "running" && execution.currentStep && (
                                <span className="text-gray-500">
                                  Step {execution.currentStep}/{execution.totalSteps}
                                </span>
                              )}
                              {(execution.completedAt || execution.status === "running") && (
                                <span className="text-gray-500">
                                  {formatDuration(execution.startedAt, execution.completedAt)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <Link
                          href={`/workflow/execution/${execution.id}`}
                          className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2"
                        >
                          View →
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Agent Activity */}
              <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-gray-200 mb-4">Agent Activity</h2>
                {recentAgents.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">Keine Agent Runs gefunden</p>
                ) : (
                  <div className="space-y-3">
                    {recentAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="p-4 bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-300 font-medium">
                                {agent.agentType}
                              </span>
                              {agent.error && (
                                <span className="w-2 h-2 rounded-full bg-red-500" title="Error" />
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {agent.model}
                            </div>
                            <div className="flex gap-3 mt-2 text-xs text-gray-400">
                              <span>{agent.totalTokens.toLocaleString()} tokens</span>
                              <span>{agent.durationMs}ms</span>
                              <span className="text-gray-500">
                                {formatDate(agent.startedAt)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Infrastructure Health */}
            <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-200 mb-4">Infrastructure Health</h2>
              {infrastructureHealth ? (
                <div>
                  {infrastructureHealth.status === "ok" && infrastructureHealth.metrics ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* CPU Usage */}
                      <div className="p-4 bg-gray-800/50 rounded-lg">
                        <div className="text-sm text-gray-400 mb-2">CPU Utilization</div>
                        {(() => {
                          const latest = getLatestMetricValue(infrastructureHealth.metrics.cpu?.datapoints);
                          return latest ? (
                            <div>
                              <div className="text-2xl font-bold text-gray-200">
                                {latest.average?.toFixed(1)}%
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Max: {latest.maximum?.toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            <div className="text-gray-500 text-sm">No data</div>
                          );
                        })()}
                      </div>

                      {/* Memory Usage */}
                      <div className="p-4 bg-gray-800/50 rounded-lg">
                        <div className="text-sm text-gray-400 mb-2">Memory Utilization</div>
                        {(() => {
                          const latest = getLatestMetricValue(infrastructureHealth.metrics.memory?.datapoints);
                          return latest ? (
                            <div>
                              <div className="text-2xl font-bold text-gray-200">
                                {latest.average?.toFixed(1)}%
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Max: {latest.maximum?.toFixed(1)}%
                              </div>
                            </div>
                          ) : (
                            <div className="text-gray-500 text-sm">No data</div>
                          );
                        })()}
                      </div>

                      {/* ALB 5xx Errors */}
                      <div className="p-4 bg-gray-800/50 rounded-lg">
                        <div className="text-sm text-gray-400 mb-2">ALB 5xx Errors</div>
                        {infrastructureHealth.metrics.alb5xx?.datapoints?.length ? (
                          (() => {
                            const alb5xxDatapoints = infrastructureHealth.metrics.alb5xx.datapoints as Array<{ timestamp: Date; sum?: number; average?: number }>;
                            const latest = alb5xxDatapoints.reduce((latest, current) => {
                              const latestTime = new Date(latest.timestamp).getTime();
                              const currentTime = new Date(current.timestamp).getTime();
                              return currentTime > latestTime ? current : latest;
                            });
                            return latest ? (
                              <div>
                                <div className="text-2xl font-bold text-gray-200">
                                  {latest.sum || 0}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Last period
                                </div>
                              </div>
                            ) : (
                              <div className="text-gray-500 text-sm">No data</div>
                            );
                          })()
                        ) : (
                          <div className="text-gray-500 text-sm">Not configured</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="text-yellow-400 mb-2">
                        <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                      <p className="text-gray-400">
                        {infrastructureHealth.error || "Metrics unavailable"}
                      </p>
                      {infrastructureHealth.message && (
                        <p className="text-xs text-gray-500 mt-2">
                          {infrastructureHealth.message}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-400">Loading infrastructure metrics...</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
