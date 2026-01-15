"use client";

import { useEffect, useState, useCallback } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

// ========================================
// Type Definitions
// ========================================

interface KpiMetric {
  name: string;
  value: number | null;
  unit: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
}

interface TouchpointBreakdown {
  type: string;
  count: number;
  percentage: number;
}

interface KpiDashboardData {
  summary: {
    d2d: KpiMetric;
    hsh: KpiMetric;
    dcu: KpiMetric;
    automationCoverage: KpiMetric;
  };
  touchpointBreakdown: TouchpointBreakdown[];
  filters: {
    period: string;
    cycleId: string | null;
    from: string | null;
    to: string | null;
  };
  metadata: {
    calculatedAt: string;
    dataVersion: string;
  };
}

export default function AutomationKpiPage() {
  const [data, setData] = useState<KpiDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [period, setPeriod] = useState<string>("7d");

  const fetchKpis = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("period", period);

      const url = `/api/ops/kpis?${params.toString()}`;

      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });

      const result = await safeFetch(response);
      setData(result);
    } catch (err) {
      console.error("Error fetching automation KPIs:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  const getTrendIcon = (trend?: string) => {
    switch (trend) {
      case 'up':
        return <span className="text-green-400">↑</span>;
      case 'down':
        return <span className="text-red-400">↓</span>;
      case 'stable':
      default:
        return <span className="text-gray-400">→</span>;
    }
  };

  const getTrendColor = (trend?: string) => {
    switch (trend) {
      case 'up':
        return 'text-green-400';
      case 'down':
        return 'text-red-400';
      case 'stable':
      default:
        return 'text-gray-400';
    }
  };

  const formatValue = (value: number | null, unit: string): string => {
    if (value === null) return '-';
    
    if (unit === '%') {
      return `${value.toFixed(1)}%`;
    } else if (unit === 'hours') {
      return `${value.toFixed(2)}h`;
    } else if (unit === 'deploys') {
      return value.toFixed(0);
    }
    
    return value.toFixed(2);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-blue-400">Automation KPI Dashboard</h1>
              <p className="text-sm text-gray-400 mt-2">
                E88.2 - Decision → Deploy, Human Steering Hours, Delivered Capability Units, Automation Coverage
              </p>
            </div>
            <button
              onClick={fetchKpis}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white rounded-md text-sm transition-colors"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {/* Filters */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Period Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Time Period
                </label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="cycle">Last Cycle</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-4 text-gray-400">Loading automation KPIs...</p>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-red-300 mb-2">Error Loading KPIs</h3>
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* KPI Summary Cards */}
        {!isLoading && !error && data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              {/* D2D Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-gray-400">D2D</div>
                  {getTrendIcon(data.summary.d2d.trend)}
                </div>
                <div className="text-3xl font-bold text-blue-400 mb-1">
                  {formatValue(data.summary.d2d.value, data.summary.d2d.unit)}
                </div>
                <div className="text-xs text-gray-500">{data.summary.d2d.name}</div>
              </div>

              {/* HSH Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-gray-400">HSH</div>
                  {getTrendIcon(data.summary.hsh.trend)}
                </div>
                <div className="text-3xl font-bold text-yellow-400 mb-1">
                  {formatValue(data.summary.hsh.value, data.summary.hsh.unit)}
                </div>
                <div className="text-xs text-gray-500">{data.summary.hsh.name}</div>
              </div>

              {/* DCU Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-gray-400">DCU</div>
                  {getTrendIcon(data.summary.dcu.trend)}
                </div>
                <div className="text-3xl font-bold text-purple-400 mb-1">
                  {formatValue(data.summary.dcu.value, data.summary.dcu.unit)}
                </div>
                <div className="text-xs text-gray-500">{data.summary.dcu.name}</div>
              </div>

              {/* Automation Coverage Card */}
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm text-gray-400">Coverage</div>
                  {getTrendIcon(data.summary.automationCoverage.trend)}
                </div>
                <div className={`text-3xl font-bold mb-1 ${getTrendColor(data.summary.automationCoverage.trend)}`}>
                  {formatValue(data.summary.automationCoverage.value, data.summary.automationCoverage.unit)}
                </div>
                <div className="text-xs text-gray-500">{data.summary.automationCoverage.name}</div>
              </div>
            </div>

            {/* Touchpoint Breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                Manual Touchpoints Breakdown
              </h2>

              {data.touchpointBreakdown.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No manual touchpoints recorded in this period
                </div>
              )}

              {data.touchpointBreakdown.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-700">
                    <thead className="bg-gray-800">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Count
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Percentage
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                          Bar
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-gray-900 divide-y divide-gray-800">
                      {data.touchpointBreakdown.map((tp) => (
                        <tr key={tp.type}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                            {tp.type.replace(/_/g, ' ')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200 text-right">
                            {tp.count}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200 text-right">
                            {tp.percentage.toFixed(1)}%
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                            <div className="w-full bg-gray-800 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full"
                                style={{ width: `${tp.percentage}%` }}
                              ></div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* KPI Formulas & Definitions */}
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold text-gray-200 mb-4">
                KPI Definitions
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-blue-400 mb-2">D2D (Decision → Deploy)</h3>
                  <p className="text-sm text-gray-400">
                    Average time from first manual touchpoint (decision) to deployment
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-yellow-400 mb-2">HSH (Human Steering Hours)</h3>
                  <p className="text-sm text-gray-400">
                    Total manual intervention time = touchpoints × 0.25 hours
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-purple-400 mb-2">DCU (Delivered Capability Units)</h3>
                  <p className="text-sm text-gray-400">
                    Count of successful deployments
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-green-400 mb-2">Automation Coverage %</h3>
                  <p className="text-sm text-gray-400">
                    Formula: automated_steps / (automated_steps + manual_touchpoints)
                  </p>
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-800">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div>
                    Data Version: {data.metadata.dataVersion}
                  </div>
                  <div>
                    Calculated at: {new Date(data.metadata.calculatedAt).toLocaleString('de-DE')}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
