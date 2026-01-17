"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";

interface ReadinessCheck {
  id: string;
  status: 'PASS' | 'FAIL';
  message: string;
  details?: Record<string, unknown>;
}

interface ReadinessData {
  status: 'PASS' | 'FAIL';
  checks: ReadinessCheck[];
  timestamp: string;
}

interface DashboardKpi {
  kpi_name: string;
  points: Array<{
    t: string;
    value: number | null;
  }>;
}

interface TopCategory {
  category: string;
  count: number;
  share: number;
}

interface PlaybookMetrics {
  playbookId: string;
  runs: number;
  successRate: number;
  medianTimeToVerify: number | null;
  medianTimeToMitigate: number | null;
}

interface RecentIncident {
  id: string;
  severity: string;
  category: string | null;
  lastSeenAt: string;
  status: string;
}

interface DashboardData {
  kpis: DashboardKpi[];
  topCategories: TopCategory[];
  playbooks: PlaybookMetrics[];
  recentIncidents: RecentIncident[];
  filters: {
    window: string;
    from: string | null;
    to: string | null;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReadinessData = (value: unknown): value is ReadinessData =>
  isRecord(value) &&
  (value.status === "PASS" || value.status === "FAIL") &&
  Array.isArray(value.checks) &&
  typeof value.timestamp === "string";

const isDashboardData = (value: unknown): value is DashboardData =>
  isRecord(value) &&
  Array.isArray(value.kpis) &&
  Array.isArray(value.topCategories) &&
  Array.isArray(value.playbooks) &&
  Array.isArray(value.recentIncidents) &&
  isRecord(value.filters) &&
  typeof value.filters.window === "string";

export default function OpsPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  // Filter states
  const [window, setWindow] = useState<string>("weekly");

  const fetchReadiness = useCallback(async () => {
    setIsLoadingReadiness(true);
    setReadinessError(null);

    try {
      const response = await fetch(API_ROUTES.ops.readiness, {
        credentials: "include",
        cache: "no-store",
      });

      const result = await safeFetch(response);
      if (isReadinessData(result)) {
        setReadiness(result);
      } else {
        setReadiness(null);
        setReadinessError("Invalid response from server");
      }
    } catch (err) {
      console.error("Error fetching readiness:", err);
      setReadinessError(formatErrorMessage(err));
    } finally {
      setIsLoadingReadiness(false);
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("window", window);

      const url = `${API_ROUTES.ops.dashboard}?${params.toString()}`;

      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });

      const result = await safeFetch(response);
      if (isDashboardData(result)) {
        setData(result);
      } else {
        setData(null);
        setError("Invalid response from server");
      }
    } catch (err) {
      console.error("Error fetching ops dashboard:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [window]);

  useEffect(() => {
    fetchDashboard();
    fetchReadiness();
  }, [fetchDashboard, fetchReadiness]);

  const formatDate = (dateString: string) => {
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

  const getSeverityBadgeColor = (severity: string) => {
    switch (severity) {
      case "RED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "YELLOW":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "OPEN":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "ACKED":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      case "MITIGATED":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "CLOSED":
        return "bg-green-900/30 text-green-200 border border-green-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatKpiName = (kpiName: string) => {
    switch (kpiName) {
      case "incident_rate":
        return "Incident Rate";
      case "mttr":
        return "MTTR";
      case "autofix_rate":
        return "Auto-fix Rate";
      default:
        return kpiName;
    }
  };

  const getLatestKpiValue = (kpi: DashboardKpi): number | null => {
    if (kpi.points.length === 0) return null;
    return kpi.points[0].value;
  };

  const formatKpiValue = (kpiName: string, value: number | null): string => {
    if (value === null) return "-";
    
    switch (kpiName) {
      case "incident_rate":
        return `${value.toFixed(2)}/day`;
      case "mttr":
        return `${value.toFixed(2)}h`;
      case "autofix_rate":
        return `${value.toFixed(1)}%`;
      default:
        return value.toFixed(2);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-blue-400">Ops Dashboard</h1>
          </div>

          {/* Filters */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Window Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Window
                </label>
                <select
                  value={window}
                  onChange={(e) => setWindow(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Integration Readiness Section (E86.3) */}
        <div className="mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-200">
                Integration Readiness
              </h2>
              <button
                onClick={fetchReadiness}
                disabled={isLoadingReadiness}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-md text-sm transition-colors"
              >
                {isLoadingReadiness ? "Checking..." : "Re-check"}
              </button>
            </div>

            {isLoadingReadiness && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                <p className="mt-2 text-gray-400 text-sm">Running integration checks...</p>
              </div>
            )}

            {readinessError && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                <p className="text-red-300">Error: {readinessError}</p>
              </div>
            )}

            {!isLoadingReadiness && !readinessError && readiness && (
              <div className="space-y-4">
                {/* Overall Status Banner */}
                <div className={`p-4 rounded-lg border ${
                  readiness.status === 'PASS'
                    ? 'bg-green-900/20 border-green-700'
                    : 'bg-red-900/20 border-red-700'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-2xl mr-3">
                        {readiness.status === 'PASS' ? '✅' : '❌'}
                      </span>
                      <div>
                        <div className={`text-lg font-semibold ${
                          readiness.status === 'PASS' ? 'text-green-200' : 'text-red-200'
                        }`}>
                          {readiness.status === 'PASS' ? 'GO' : 'NO-GO'}
                        </div>
                        <div className="text-sm text-gray-400">
                          {readiness.status === 'PASS' 
                            ? 'All integration checks passed' 
                            : 'Integration readiness checks failed'}
                        </div>
                      </div>
                    </div>
                    <div className="text-sm text-gray-400">
                      Last checked: {new Date(readiness.timestamp).toLocaleString('de-DE')}
                    </div>
                  </div>
                </div>

                {/* Checks Table */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-700">
                    <thead className="bg-gray-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-16">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Check
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Message
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-800/30 divide-y divide-gray-700">
                      {readiness.checks.map((check) => (
                        <tr key={check.id} className={
                          check.status === 'FAIL' ? 'bg-red-900/10' : ''
                        }>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <span className="text-xl">
                              {check.status === 'PASS' ? '✅' : '❌'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-200">
                              {check.id.split('_').map(word => 
                                word.charAt(0).toUpperCase() + word.slice(1)
                              ).join(' ')}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className={`text-sm ${
                              check.status === 'FAIL' ? 'text-red-200' : 'text-gray-300'
                            }`}>
                              {check.message}
                            </div>
                            {check.details && Object.keys(check.details).length > 0 && (
                              <details className="mt-2">
                                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                                  Show details
                                </summary>
                                <pre className="mt-2 text-xs text-gray-400 bg-gray-900 p-2 rounded overflow-x-auto">
                                  {JSON.stringify(check.details, null, 2)}
                                </pre>
                              </details>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-400">Loading dashboard...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-300">Error: {error}</p>
          </div>
        )}

        {/* Dashboard Content */}
        {!isLoading && !error && data && (
          <div className="space-y-8">
            {/* Section 1: KPI Cards */}
            <div>
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                Key Performance Indicators
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {data.kpis.map((kpi) => {
                  const latestValue = getLatestKpiValue(kpi);
                  return (
                    <div
                      key={kpi.kpi_name}
                      className="bg-gray-900 border border-gray-800 rounded-lg p-4"
                    >
                      <div className="text-sm text-gray-400 mb-1">
                        {formatKpiName(kpi.kpi_name)}
                      </div>
                      <div className="text-2xl font-bold text-blue-400">
                        {formatKpiValue(kpi.kpi_name, latestValue)}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {kpi.points.length} data points
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* KPI Trends Table */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-800">
                  <thead className="bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        KPI
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Latest Value
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Recent Trend (last 5)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-900 divide-y divide-gray-800">
                    {data.kpis.map((kpi) => (
                      <tr key={kpi.kpi_name}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">
                          {formatKpiName(kpi.kpi_name)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                          {formatKpiValue(kpi.kpi_name, getLatestKpiValue(kpi))}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-400">
                          {kpi.points.slice(0, 5).map((point, idx) => (
                            <span key={idx} className="mr-3">
                              {formatKpiValue(kpi.kpi_name, point.value)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 2: Top Failure Classes */}
            <div>
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                Top Failure Classes
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                {data.topCategories.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400">No incidents data available</p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Count
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Share
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-900 divide-y divide-gray-800">
                      {data.topCategories.map((cat) => (
                        <tr key={cat.category}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">
                            {cat.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {cat.count}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                            {cat.share.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Section 3: Playbook Effectiveness */}
            <div>
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                Playbook Effectiveness
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                {data.playbooks.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400">No playbook data available</p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Playbook ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Runs
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Success Rate
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Median Time to Mitigate
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-900 divide-y divide-gray-800">
                      {data.playbooks.map((pb) => (
                        <tr key={pb.playbookId}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-200">
                            {pb.playbookId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {pb.runs}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-md ${
                                pb.successRate >= 80
                                  ? "bg-green-900/30 text-green-200 border border-green-700"
                                  : pb.successRate >= 50
                                  ? "bg-yellow-900/30 text-yellow-200 border border-yellow-700"
                                  : "bg-red-900/30 text-red-200 border border-red-700"
                              }`}
                            >
                              {pb.successRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                            {pb.medianTimeToMitigate !== null
                              ? `${pb.medianTimeToMitigate.toFixed(1)}m`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Section 4: Recent Incidents */}
            <div>
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                Recent Incidents
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                {data.recentIncidents.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-gray-400">No recent incidents</p>
                  </div>
                ) : (
                  <table className="min-w-full divide-y divide-gray-800">
                    <thead className="bg-gray-800/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Last Seen
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Severity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-900 divide-y divide-gray-800">
                      {data.recentIncidents.map((incident) => (
                        <tr key={incident.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                            {formatDate(incident.lastSeenAt)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-md ${getSeverityBadgeColor(
                                incident.severity
                              )}`}
                            >
                              {incident.severity}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {incident.category || "-"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-md ${getStatusBadgeColor(
                                incident.status
                              )}`}
                            >
                              {incident.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <Link
                              href={`/incidents/${incident.id}`}
                              className="text-blue-400 hover:text-blue-300"
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
