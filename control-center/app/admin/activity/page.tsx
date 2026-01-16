"use client";

/**
 * Admin Activity Log Page
 * 
 * Displays a centralized activity log of all Steering/Automation actions.
 * Features:
 * - Event list with pagination (< 2s load for 200 events)
 * - Filter chips (sessionId, issueId, type, date range)
 * - Detail drawer for event inspection
 * - Displays: timestamp, type, actor, correlationId, entity ID
 * - Links to runbooks where applicable
 * 
 * Issue: I904 - Activity Log (UI + API)
 */

import { useEffect, useState, useMemo } from "react";

type ActivityEvent = {
  id: string;
  timestamp: string;
  type: string;
  actor: string;
  correlationId: string;
  sessionId: string | null;
  canonicalId: string | null;
  githubIssueNumber: number | null;
  prNumber: number | null;
  subjectType: string;
  subjectIdentifier: string;
  summary: string;
  links: Record<string, string>;
  details: Record<string, any>;
};

type ActivityResponse = {
  ok: boolean;
  schemaVersion: string;
  events: ActivityEvent[];
  pagination: {
    cursor: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextCursor: number | null;
  };
  filters: {
    sessionId: string | null;
    issueId: number | null;
    types: string[] | null;
    startDate: string | null;
    endDate: string | null;
  };
};

export default function AdminActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [pagination, setPagination] = useState({
    cursor: 0,
    limit: 50,
    total: 0,
    hasMore: false,
    nextCursor: null as number | null,
  });

  // Filter state
  const [sessionIdFilter, setSessionIdFilter] = useState("");
  const [issueIdFilter, setIssueIdFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");

  const loadEvents = async (cursor: number = 0) => {
    setLoading(true);
    setError(null);

    try {
      // Build query params
      const params = new URLSearchParams();
      params.set("cursor", cursor.toString());
      params.set("limit", "50");
      
      if (sessionIdFilter) params.set("sessionId", sessionIdFilter);
      if (issueIdFilter) params.set("issueId", issueIdFilter);
      if (typeFilter) params.set("types", typeFilter);
      if (startDateFilter) params.set("startDate", startDateFilter);
      if (endDateFilter) params.set("endDate", endDateFilter);

      const response = await fetch(`/api/admin/activity?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to load activity log");
      }

      const data: ActivityResponse = await response.json();
      
      if (data.ok) {
        setEvents(data.events);
        setPagination(data.pagination);
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents(0);
  }, [sessionIdFilter, issueIdFilter, typeFilter, startDateFilter, endDateFilter]);

  const handleNextPage = () => {
    if (pagination.nextCursor !== null) {
      loadEvents(pagination.nextCursor);
    }
  };

  const handlePrevPage = () => {
    const prevCursor = Math.max(0, pagination.cursor - pagination.limit);
    loadEvents(prevCursor);
  };

  const clearFilters = () => {
    setSessionIdFilter("");
    setIssueIdFilter("");
    setTypeFilter("");
    setStartDateFilter("");
    setEndDateFilter("");
  };

  const activeFilters = useMemo(() => {
    const filters = [];
    if (sessionIdFilter) filters.push({ label: `Session: ${sessionIdFilter}`, clear: () => setSessionIdFilter("") });
    if (issueIdFilter) filters.push({ label: `Issue: #${issueIdFilter}`, clear: () => setIssueIdFilter("") });
    if (typeFilter) filters.push({ label: `Type: ${typeFilter}`, clear: () => setTypeFilter("") });
    if (startDateFilter) filters.push({ label: `From: ${startDateFilter}`, clear: () => setStartDateFilter("") });
    if (endDateFilter) filters.push({ label: `To: ${endDateFilter}`, clear: () => setEndDateFilter("") });
    return filters;
  }, [sessionIdFilter, issueIdFilter, typeFilter, startDateFilter, endDateFilter]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Activity Log</h1>

        {/* Filters Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Session ID
              </label>
              <input
                type="text"
                value={sessionIdFilter}
                onChange={(e) => setSessionIdFilter(e.target.value)}
                placeholder="e.g., 19eacd15-4925..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issue Number
              </label>
              <input
                type="number"
                value={issueIdFilter}
                onChange={(e) => setIssueIdFilter(e.target.value)}
                placeholder="e.g., 123"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event Type
              </label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <option value="approval_submitted">Approval Submitted</option>
                <option value="approval_approved">Approval Approved</option>
                <option value="approval_denied">Approval Denied</option>
                <option value="automation_policy_allowed">Policy Allowed</option>
                <option value="automation_policy_denied">Policy Denied</option>
                <option value="pr_opened">PR Opened</option>
                <option value="pr_merged">PR Merged</option>
                <option value="pr_closed">PR Closed</option>
                <option value="checks_rerun">Checks Rerun</option>
                <option value="workflow_dispatched">Workflow Dispatched</option>
                <option value="issue_published">Issue Published</option>
                <option value="issue_updated">Issue Updated</option>
                <option value="deploy_executed">Deploy Executed</option>
                <option value="rollback_executed">Rollback Executed</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="datetime-local"
                value={startDateFilter}
                onChange={(e) => setStartDateFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="datetime-local"
                value={endDateFilter}
                onChange={(e) => setEndDateFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
              >
                Clear All Filters
              </button>
            </div>
          </div>

          {/* Active Filter Chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((filter, index) => (
                <div
                  key={index}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                >
                  <span>{filter.label}</span>
                  <button
                    onClick={filter.clear}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 mb-6">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <div className="animate-pulse">Loading activity log...</div>
          </div>
        )}

        {/* Events List */}
        {!loading && events.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Events ({pagination.total} total)
                </h2>
                <button
                  onClick={() => loadEvents(pagination.cursor)}
                  className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Timestamp
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actor
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Summary
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Correlation ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {events.map((event) => (
                      <tr key={event.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatTimestamp(event.timestamp)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                            {event.type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {event.actor}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-md truncate">
                          {event.summary}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                          {event.correlationId 
                            ? (event.correlationId.length > 8 
                                ? event.correlationId.substring(0, 8) + '...' 
                                : event.correlationId)
                            : 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => setSelectedEvent(event)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-200">
                <div className="text-sm text-gray-700">
                  Showing {pagination.cursor + 1} to {pagination.cursor + events.length} of {pagination.total}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={pagination.cursor === 0}
                    className={`px-4 py-2 border rounded-md ${
                      pagination.cursor === 0
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Previous
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!pagination.hasMore}
                    className={`px-4 py-2 border rounded-md ${
                      !pagination.hasMore
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No Results */}
        {!loading && events.length === 0 && (
          <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
            No events found. Try adjusting your filters.
          </div>
        )}

        {/* Detail Drawer */}
        {selectedEvent && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-end"
            onClick={() => setSelectedEvent(null)}
          >
            <div
              className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Event Details</h2>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-gray-400 hover:text-gray-600 text-2xl"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-500">ID</h3>
                    <p className="mt-1 text-sm text-gray-900 font-mono">{selectedEvent.id}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Timestamp</h3>
                    <p className="mt-1 text-sm text-gray-900">{formatTimestamp(selectedEvent.timestamp)}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Type</h3>
                    <p className="mt-1">
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                        {selectedEvent.type}
                      </span>
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Actor</h3>
                    <p className="mt-1 text-sm text-gray-900">{selectedEvent.actor}</p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Correlation ID</h3>
                    <p className="mt-1 text-sm text-gray-900 font-mono break-all">{selectedEvent.correlationId}</p>
                  </div>

                  {selectedEvent.sessionId && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Session ID</h3>
                      <p className="mt-1 text-sm text-gray-900 font-mono break-all">{selectedEvent.sessionId}</p>
                    </div>
                  )}

                  {selectedEvent.canonicalId && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">Canonical ID</h3>
                      <p className="mt-1 text-sm text-gray-900 font-mono">{selectedEvent.canonicalId}</p>
                    </div>
                  )}

                  {selectedEvent.githubIssueNumber && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">GitHub Issue</h3>
                      <p className="mt-1 text-sm text-gray-900">#{selectedEvent.githubIssueNumber}</p>
                    </div>
                  )}

                  {selectedEvent.prNumber && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500">PR Number</h3>
                      <p className="mt-1 text-sm text-gray-900">#{selectedEvent.prNumber}</p>
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Subject</h3>
                    <p className="mt-1 text-sm text-gray-900">
                      {selectedEvent.subjectType}: {selectedEvent.subjectIdentifier}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-500">Summary</h3>
                    <p className="mt-1 text-sm text-gray-900">{selectedEvent.summary}</p>
                  </div>

                  {/* Links */}
                  {Object.keys(selectedEvent.links).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Links</h3>
                      <div className="space-y-2">
                        {Object.entries(selectedEvent.links).map(([key, url]) => (
                          <div key={key}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 underline"
                            >
                              {key}: {url}
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Details */}
                  {Object.keys(selectedEvent.details).length > 0 && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-2">Additional Details</h3>
                      <pre className="mt-1 text-xs bg-gray-50 p-4 rounded overflow-auto max-h-96">
                        {JSON.stringify(selectedEvent.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
