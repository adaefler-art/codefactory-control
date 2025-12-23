"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Issue {
  id: string;
  title: string;
  body: string | null;
  status: "CREATED" | "ACTIVE" | "BLOCKED" | "DONE";
  labels: string[];
  priority: "P0" | "P1" | "P2" | null;
  assignee: string | null;
  source: string;
  handoff_state: "NOT_SENT" | "SENT" | "SYNCED" | "FAILED";
  github_issue_number: number | null;
  github_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export default function IssuesPage() {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const fetchIssues = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      if (labelFilter) params.append("label", labelFilter);
      if (searchQuery) params.append("q", searchQuery);
      
      const response = await fetch(`/api/issues?${params.toString()}`, {
        credentials: "include"
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch issues");
      }
      
      const data = await response.json();
      setIssues(data.issues || []);
    } catch (err) {
      console.error("Error fetching issues:", err);
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, labelFilter, searchQuery]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "DONE":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "BLOCKED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "CREATED":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const getHandoffStateBadgeColor = (state: string) => {
    switch (state) {
      case "SYNCED":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "SENT":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      case "FAILED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "NOT_SENT":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Get unique labels from all issues
  const allLabels = Array.from(
    new Set(issues.flatMap((issue) => issue.labels))
  ).sort();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-purple-400">AFU9 Issues</h1>
            <Link
              href="/issues/new"
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors"
            >
              New Issue
            </Link>
          </div>
          
          {/* Filters */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">All Statuses</option>
                  <option value="CREATED">CREATED</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="BLOCKED">BLOCKED</option>
                  <option value="DONE">DONE</option>
                </select>
              </div>

              {/* Label Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Label
                </label>
                <select
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">All Labels</option>
                  {allLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Search
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title or body..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <p className="mt-4 text-gray-400">Loading issues...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mb-6">
            <p className="text-red-300">Error: {error}</p>
          </div>
        )}

        {/* Issues Table */}
        {!isLoading && !error && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {issues.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg">No issues found</p>
                <p className="text-gray-500 mt-2">
                  Try adjusting your filters or create a new issue
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-800">
                  <thead className="bg-gray-800/50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Title
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Labels
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Handoff State
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-900 divide-y divide-gray-800">
                    {issues.map((issue) => (
                      <tr
                        key={issue.id}
                        className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                        onClick={() => router.push(`/issues/${issue.id}`)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <div>
                              <div className="text-sm font-medium text-purple-400 hover:text-purple-300">
                                {issue.title}
                              </div>
                              {issue.priority && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {issue.priority}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded-md ${getStatusBadgeColor(
                              issue.status
                            )}`}
                          >
                            {issue.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {issue.labels.length === 0 ? (
                              <span className="text-xs text-gray-500">
                                No labels
                              </span>
                            ) : (
                              issue.labels.map((label) => (
                                <span
                                  key={label}
                                  className="px-2 py-1 text-xs font-medium rounded-md bg-blue-900/30 text-blue-200 border border-blue-700"
                                >
                                  {label}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-1 text-xs font-medium rounded-md ${getHandoffStateBadgeColor(
                                issue.handoff_state
                              )}`}
                            >
                              {issue.handoff_state}
                            </span>
                            {issue.handoff_state === "FAILED" && (
                              <span
                                className="text-red-400 text-xs"
                                title={issue.last_error || "Failed"}
                              >
                                ⚠️
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                          {formatDate(issue.updated_at)}
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
        {!isLoading && !error && issues.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
