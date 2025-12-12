"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AlarmSummary {
  total: number;
  ok: number;
  alarm: number;
  insufficientData: number;
}

interface Alarm {
  alarmName: string;
  alarmDescription?: string;
  stateValue: string;
  stateReason?: string;
  stateUpdatedTimestamp?: Date;
  metricName?: string;
  namespace?: string;
  threshold?: number;
}

interface LogEvent {
  timestamp: number;
  message: string;
  logStreamName?: string;
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
  };
}

export default function ObservabilityPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [alarmSummary, setAlarmSummary] = useState<AlarmSummary | null>(null);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [health, setHealth] = useState<InfrastructureHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLogGroup, setSelectedLogGroup] = useState('/ecs/afu9/control-center');
  const [selectedHours, setSelectedHours] = useState(1);

  useEffect(() => {
    fetchObservabilityData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchObservabilityData, 30000);
    return () => clearInterval(interval);
  }, [selectedLogGroup, selectedHours]);

  async function fetchObservabilityData() {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch alarms
      const alarmsRes = await fetch('/api/observability/alarms');
      const alarmsData = await alarmsRes.json();

      if (alarmsData.status === 'success') {
        setAlarms(alarmsData.data.alarms);
        setAlarmSummary(alarmsData.data.summary);
      }

      // Fetch logs
      const logsRes = await fetch(
        `/api/observability/logs?logGroup=${encodeURIComponent(selectedLogGroup)}&hours=${selectedHours}&limit=50`
      );
      const logsData = await logsRes.json();

      if (logsData.status === 'success') {
        setLogs(logsData.data.events);
      }

      // Fetch infrastructure health
      const healthRes = await fetch('/api/infrastructure/health');
      const healthData = await healthRes.json();
      setHealth(healthData);

      setIsLoading(false);
    } catch (err) {
      console.error('Error fetching observability data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  }

  function getAlarmStateColor(state: string): string {
    switch (state) {
      case 'OK':
        return 'text-green-600 bg-green-50';
      case 'ALARM':
        return 'text-red-600 bg-red-50';
      case 'INSUFFICIENT_DATA':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function getLatestMetricValue(datapoints?: Array<{ timestamp: Date; average?: number }>): number | null {
    if (!datapoints || datapoints.length === 0) return null;
    const latest = datapoints[datapoints.length - 1];
    return latest.average || null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Observability</h1>
              <p className="text-gray-600 mt-2">
                Infrastructure monitoring, alarms, and logs
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={fetchObservabilityData}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              <Link
                href="/dashboard"
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        {/* Alarm Summary Cards */}
        {alarmSummary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Total Alarms</h3>
              <p className="text-3xl font-bold text-gray-900">{alarmSummary.total}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">OK</h3>
              <p className="text-3xl font-bold text-green-600">{alarmSummary.ok}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">In Alarm</h3>
              <p className="text-3xl font-bold text-red-600">{alarmSummary.alarm}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Insufficient Data</h3>
              <p className="text-3xl font-bold text-yellow-600">
                {alarmSummary.insufficientData}
              </p>
            </div>
          </div>
        )}

        {/* Infrastructure Health */}
        {health && health.status === 'ok' && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Infrastructure Health</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Service</h3>
                <p className="text-lg font-semibold text-gray-900">
                  {health.cluster}/{health.service}
                </p>
              </div>
              {health.metrics?.cpu && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">CPU Utilization</h3>
                  <p className="text-lg font-semibold text-gray-900">
                    {getLatestMetricValue(health.metrics.cpu.datapoints)?.toFixed(1) || 'N/A'}%
                  </p>
                </div>
              )}
              {health.metrics?.memory && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-2">Memory Utilization</h3>
                  <p className="text-lg font-semibold text-gray-900">
                    {getLatestMetricValue(health.metrics.memory.datapoints)?.toFixed(1) || 'N/A'}%
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* CloudWatch Alarms */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">CloudWatch Alarms</h2>
            {alarms.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No alarms configured</p>
            ) : (
              <div className="space-y-3">
                {alarms.map((alarm, idx) => (
                  <div
                    key={idx}
                    className="border border-gray-200 rounded-lg p-4 hover:border-gray-300"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-gray-900">{alarm.alarmName}</h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${getAlarmStateColor(
                          alarm.stateValue
                        )}`}
                      >
                        {alarm.stateValue}
                      </span>
                    </div>
                    {alarm.alarmDescription && (
                      <p className="text-sm text-gray-600 mb-2">{alarm.alarmDescription}</p>
                    )}
                    {alarm.stateReason && alarm.stateValue === 'ALARM' && (
                      <p className="text-sm text-red-600 bg-red-50 rounded p-2 mb-2">
                        {alarm.stateReason}
                      </p>
                    )}
                    <div className="text-xs text-gray-500">
                      {alarm.namespace} / {alarm.metricName}
                      {alarm.threshold && ` (threshold: ${alarm.threshold})`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Error Logs */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Recent Error Logs</h2>
              <div className="flex gap-2">
                <select
                  value={selectedLogGroup}
                  onChange={(e) => setSelectedLogGroup(e.target.value)}
                  className="px-2 py-1 text-sm border border-gray-300 rounded"
                >
                  <option value="/ecs/afu9/control-center">Control Center</option>
                  <option value="/ecs/afu9/mcp-github">MCP GitHub</option>
                  <option value="/ecs/afu9/mcp-deploy">MCP Deploy</option>
                  <option value="/ecs/afu9/mcp-observability">MCP Observability</option>
                </select>
                <select
                  value={selectedHours}
                  onChange={(e) => setSelectedHours(parseInt(e.target.value))}
                  className="px-2 py-1 text-sm border border-gray-300 rounded"
                >
                  <option value={1}>Last 1 hour</option>
                  <option value={6}>Last 6 hours</option>
                  <option value={24}>Last 24 hours</option>
                </select>
              </div>
            </div>
            {logs.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No error logs found</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {logs.map((log, idx) => (
                  <div key={idx} className="border border-gray-200 rounded p-3 text-sm">
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs text-gray-500">{formatTimestamp(log.timestamp)}</span>
                      {log.logStreamName && (
                        <span className="text-xs text-gray-400 truncate ml-2">
                          {log.logStreamName.split('/').pop()}
                        </span>
                      )}
                    </div>
                    <pre className="text-xs text-gray-800 whitespace-pre-wrap break-words">
                      {log.message}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          Data refreshes automatically every 30 seconds
        </div>
      </div>
    </div>
  );
}
