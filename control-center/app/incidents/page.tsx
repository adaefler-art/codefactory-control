"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";

interface Incident {
  id: string;
  incident_key: string;
  severity: "YELLOW" | "RED";
  status: "OPEN" | "ACKED" | "MITIGATED" | "CLOSED";
  title: string;
  summary: string | null;
  classification: any;
  lawbook_version: string | null;
  source_primary: any;
  tags: string[];
  created_at: string;
  updated_at: string;
  first_seen_at: string;
  last_seen_at: string;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("");

  const fetchIncidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (severityFilter) params.append("severity", severityFilter);

      const query = params.toString();
      const url = query.length > 0 ? `${API_ROUTES.incidents.list}?${query}` : API_ROUTES.incidents.list;

      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store"
      });

      const data = await safeFetch(response);
      setIncidents(data.incidents || []);
    } catch (err) {
      console.error("Error fetching incidents:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

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

  // Count links in classification or default to 0
  const getLinksCount = (incident: Incident) => {
    // This is a placeholder - in reality we'd need to fetch this from the API
    // For now, return 0 as we don't have this data in the list view
    return 0;
  };

  const getCategory = (incident: Incident) => {
    if (incident.classification?.category) {
      return incident.classification.category;
    }
    return "-";
  };

  const getConfidence = (incident: Incident) => {
    if (incident.classification?.confidence) {
      return incident.classification.confidence;
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-red-400">Incidents</h1>
          </div>

          {/* Filters */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">All Statuses</option>
                  <option value="OPEN">OPEN</option>
                  <option value="ACKED">ACKED</option>
                  <option value="MITIGATED">MITIGATED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
              </div>

              {/* Severity Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Severity
                </label>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">All Severities</option>
                  <option value="RED">RED</option>
                  <option value="YELLOW">YELLOW</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
            <p className="mt-4 text-gray-400">Loading incidents...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-300">Error: {error}</p>
          </div>
        )}

        {/* Incidents Table */}
        {!isLoading && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {incidents.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg">No incidents found</p>
                <p className="text-gray-500 mt-2">
                  Try adjusting your filters
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
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
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Title
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Links
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-900 divide-y divide-gray-800">
                    {incidents.map((incident) => (
                      <tr
                        key={incident.id}
                        className="hover:bg-gray-800/50 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {formatDate(incident.last_seen_at)}
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
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-md ${getStatusBadgeColor(
                              incident.status
                            )}`}
                          >
                            {incident.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <Link
                            href={`/incidents/${incident.id}`}
                            className="text-sm font-medium text-red-400 hover:text-red-300"
                          >
                            {incident.title}
                          </Link>
                          {incident.summary && (
                            <p className="text-xs text-gray-500 mt-1 truncate max-w-md">
                              {incident.summary}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-300">
                            {getCategory(incident)}
                          </div>
                          {getConfidence(incident) && (
                            <div className="text-xs text-gray-500">
                              {getConfidence(incident)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {getLinksCount(incident) || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer Info */}
        {!isLoading && !error && incidents.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {incidents.length} incident{incidents.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
