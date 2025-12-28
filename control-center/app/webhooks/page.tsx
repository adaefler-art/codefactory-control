"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface WebhookEvent {
  id: string;
  event_id: string;
  event_type: string;
  event_action?: string;
  received_at: string;
  processed: boolean;
  processed_at?: string;
  workflow_execution_id?: string;
  error?: string;
  payload: Record<string, unknown>;
}

interface WebhookStats {
  total: number;
  processed: number;
  failed: number;
  by_type: Record<string, number>;
}

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [stats, setStats] = useState<WebhookStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);

  useEffect(() => {
    loadWebhookData();
    // Refresh every 10 seconds
    const interval = setInterval(loadWebhookData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadWebhookData() {
    try {
      const [eventsRes, statsRes] = await Promise.all([
        fetch("/api/webhooks/events?limit=50", { credentials: "include" }),
        fetch("/api/webhooks/events?stats=true", { credentials: "include" }),
      ]);

      if (!eventsRes.ok || !statsRes.ok) {
        throw new Error("Failed to load webhook data");
      }

      const eventsData = await eventsRes.json();
      const statsData = await statsRes.json();

      setEvents(eventsData.events || []);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(event: WebhookEvent) {
    if (event.error) {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400">
          Failed
        </span>
      );
    }
    if (event.processed) {
      return (
        <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
          Processed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
        Pending
      </span>
    );
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleString();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-black p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="text-gray-600 dark:text-gray-400">Loading webhook data...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-black dark:text-white">
                GitHub Webhooks
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Monitor incoming webhook events and their processing status
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Home
            </Link>
          </div>

          {/* Statistics Cards */}
          {stats && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="text-sm text-blue-600 dark:text-blue-400 font-medium">Total Events</div>
                <div className="text-3xl font-bold text-blue-900 dark:text-blue-100 mt-1">
                  {stats.total}
                </div>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="text-sm text-green-600 dark:text-green-400 font-medium">Processed</div>
                <div className="text-3xl font-bold text-green-900 dark:text-green-100 mt-1">
                  {stats.processed}
                </div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <div className="text-sm text-red-600 dark:text-red-400 font-medium">Failed</div>
                <div className="text-3xl font-bold text-red-900 dark:text-red-100 mt-1">
                  {stats.failed}
                </div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <div className="text-sm text-purple-600 dark:text-purple-400 font-medium">Event Types</div>
                <div className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-1">
                  {Object.keys(stats.by_type).length}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}
        </div>

        {/* Events List */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Event
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Received
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Workflow
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                      No webhook events received yet
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr
                      key={event.event_id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {event.event_type}
                        </div>
                        {event.event_action && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {event.event_action}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(event)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(event.received_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {event.workflow_execution_id ? (
                          <Link
                            href={`/workflows/executions/${event.workflow_execution_id}`}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View Execution
                          </Link>
                        ) : (
                          <span className="text-sm text-gray-400 dark:text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEvent(event);
                          }}
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Event Detail Modal */}
        {selectedEvent && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={() => setSelectedEvent(null)}
          >
            <div
              className="bg-white dark:bg-gray-900 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Webhook Event Details
                  </h2>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Event ID</label>
                    <p className="mt-1 text-sm text-gray-900 dark:text-gray-100 font-mono">{selectedEvent.event_id}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Event Type</label>
                    <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                      {selectedEvent.event_type}
                      {selectedEvent.event_action && ` (${selectedEvent.event_action})`}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Status</label>
                    <div className="mt-1">{getStatusBadge(selectedEvent)}</div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Received At</label>
                    <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formatDate(selectedEvent.received_at)}</p>
                  </div>

                  {selectedEvent.processed_at && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Processed At</label>
                      <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">{formatDate(selectedEvent.processed_at)}</p>
                    </div>
                  )}

                  {selectedEvent.workflow_execution_id && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Workflow Execution</label>
                      <Link
                        href={`/workflows/executions/${selectedEvent.workflow_execution_id}`}
                        className="mt-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {selectedEvent.workflow_execution_id}
                      </Link>
                    </div>
                  )}

                  {selectedEvent.error && (
                    <div>
                      <label className="block text-sm font-medium text-red-700 dark:text-red-400">Error</label>
                      <p className="mt-1 text-sm text-red-900 dark:text-red-100 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                        {selectedEvent.error}
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payload</label>
                    <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-4 rounded overflow-x-auto">
                      {JSON.stringify(selectedEvent.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
