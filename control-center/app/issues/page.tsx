"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { mapToCanonicalStatus, isLegacyStatus, getCanonicalStatuses } from "@/lib/utils/status-mapping";
import { Afu9IssueStatus } from "@/lib/contracts/afu9Issue";

interface Issue {
  id: string;
  publicId: string;
  title: string;
  body: string | null;
  status: string; // Can be canonical or legacy status
  labels: string[];
  priority: "P0" | "P1" | "P2" | null;
  assignee: string | null;
  source: string;
  handoff_state: "NOT_SENT" | "SENT" | "SYNCED" | "FAILED";
  github_issue_number: number | null;
  github_url: string | null;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deleted_at: string | null;
  deletedAt: string | null;
  // E7_extra: GitHub status parity fields
  github_status_raw?: string | null;
  status_source?: "manual" | "github_project" | "github_label" | "github_state" | null;
}

interface ImportError {
  line?: number;
  message: string;
}

interface ImportResult {
  success: boolean;
  runId?: string;
  status?: string;
  epics?: {
    created: number;
    updated: number;
    skipped: number;
    total: number;
  };
  issues?: {
    created: number;
    updated: number;
    skipped: number;
    total: number;
  };
  errors?: ImportError[];
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState<boolean>(false);
  
  // Sort states
  const [sortField, setSortField] = useState<"updatedAt" | "createdAt" | "priority" | "status">("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Import modal states
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<"text" | "repo">("text");
  const [importContent, setImportContent] = useState("");
  const [repoPath, setRepoPath] = useState("docs/roadmaps/afu9_v0_6_backlog.md");
  const [repoRef, setRepoRef] = useState("main");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Delete modal states
  const [deleteConfirmIssue, setDeleteConfirmIssue] = useState<Issue | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchIssues = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch all issues without status/label filtering (we'll filter client-side)
      const params = new URLSearchParams();
      if (searchQuery) params.append("q", searchQuery);
      
      const response = await fetch(`/api/issues?${params.toString()}`, {
        credentials: "include",
        cache: "no-store"
      });
      
      const data = await safeFetch(response);
      setIssues(data.issues || []);
    } catch (err) {
      console.error("Error fetching issues:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);
    setImportResult(null);

    try {
      if (importMode === "text") {
        if (!importContent.trim()) {
          setImportError("Please enter content to import");
          setIsImporting(false);
          return;
        }

        const response = await fetch("/api/issues/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ content: importContent }),
        });

        const data = await safeFetch(response);
        
        if (data.success) {
          setImportSuccess(`Successfully imported ${data.imported} of ${data.total} issues`);
          setImportContent("");
          
          // Refresh issues list
          await fetchIssues();
          
          // Close modal after 2 seconds
          setTimeout(() => {
            setShowImportModal(false);
            setImportSuccess(null);
          }, 2000);
        } else {
          setImportError(data.error || "Failed to import issues");
        }
      } else {
        // Repo file import
        if (!repoPath.trim()) {
          setImportError("Please enter a file path");
          setIsImporting(false);
          return;
        }

        const response = await fetch("/api/import/backlog-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ 
            path: repoPath,
            ref: repoRef || "main",
          }),
        });

        const data = await safeFetch(response);
        
        if (data.success) {
          setImportResult(data);
          setImportSuccess(
            `Import completed! Epics: ${data.epics.created} created, ${data.epics.updated} updated, ${data.epics.skipped} skipped. ` +
            `Issues: ${data.issues.created} created, ${data.issues.updated} updated, ${data.issues.skipped} skipped.`
          );
          
          // Refresh issues list
          await fetchIssues();
          
          // Close modal after 3 seconds
          setTimeout(() => {
            setShowImportModal(false);
            setImportSuccess(null);
            setImportResult(null);
          }, 3000);
        } else {
          setImportError(data.error || data.errors?.[0]?.message || "Failed to import from repository file");
          if (data.errors && data.errors.length > 0) {
            setImportResult(data);
          }
        }
      }
    } catch (err) {
      console.error("Error importing issues:", err);
      setImportError(formatErrorMessage(err));
    } finally {
      setIsImporting(false);
    }
  }, [importMode, importContent, repoPath, repoRef, fetchIssues]);

  const handleDeleteClick = useCallback((issue: Issue) => {
    setDeleteConfirmIssue(issue);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmIssue) return;

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/issues/${deleteConfirmIssue.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete issue");
      }

      // Refresh issues list
      await fetchIssues();
      setDeleteConfirmIssue(null);
    } catch (err) {
      console.error("Error deleting issue:", err);
      alert(formatErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteConfirmIssue, fetchIssues]);

  const canDeleteIssue = (issue: Issue) => {
    return issue.status === "CREATED" && issue.handoff_state === "NOT_SENT";
  };

  // Client-side filtering and sorting (memoized for performance)
  const filteredAndSortedIssues = useMemo(() => {
    let result = [...issues];

    // Apply status filter (on mapped canonical status)
    if (statusFilter) {
      result = result.filter((issue) => mapToCanonicalStatus(issue.status) === statusFilter);
    }

    // Apply Active-only filter (status === SPEC_READY)
    if (activeOnly) {
      result = result.filter((issue) => mapToCanonicalStatus(issue.status) === Afu9IssueStatus.SPEC_READY);
    }

    // Apply label filter
    if (labelFilter) {
      result = result.filter((issue) => issue.labels.includes(labelFilter));
    }

    // Sort issues
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "updatedAt": {
          const aTime = new Date(a.updatedAt ?? a.updated_at ?? 0).getTime();
          const bTime = new Date(b.updatedAt ?? b.updated_at ?? 0).getTime();
          comparison = aTime - bTime;
          break;
        }
        case "createdAt": {
          const aTime = new Date(a.createdAt ?? a.created_at ?? 0).getTime();
          const bTime = new Date(b.createdAt ?? b.created_at ?? 0).getTime();
          comparison = aTime - bTime;
          break;
        }
        case "priority": {
          // Custom priority order: P0 > P1 > P2 > null
          const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, "null": 3 };
          const aPriority = priorityOrder[a.priority ?? "null"];
          const bPriority = priorityOrder[b.priority ?? "null"];
          comparison = aPriority - bPriority;
          break;
        }
        case "status": {
          // Sort by canonical status alphabetically
          const aStatus = mapToCanonicalStatus(a.status);
          const bStatus = mapToCanonicalStatus(b.status);
          comparison = aStatus.localeCompare(bStatus);
          break;
        }
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [issues, statusFilter, activeOnly, labelFilter, sortField, sortOrder]);

  const getStatusBadgeColor = (canonicalStatus: string) => {
    switch (canonicalStatus) {
      case Afu9IssueStatus.CREATED:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      case Afu9IssueStatus.SPEC_READY:
        return "bg-cyan-900/30 text-cyan-200 border border-cyan-700";
      case Afu9IssueStatus.IMPLEMENTING:
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case Afu9IssueStatus.VERIFIED:
        return "bg-purple-900/30 text-purple-200 border border-purple-700";
      case Afu9IssueStatus.MERGE_READY:
        return "bg-indigo-900/30 text-indigo-200 border border-indigo-700";
      case Afu9IssueStatus.DONE:
        return "bg-emerald-900/30 text-emerald-200 border border-emerald-700";
      case Afu9IssueStatus.HOLD:
        return "bg-orange-900/30 text-orange-200 border border-orange-700";
      case Afu9IssueStatus.KILLED:
        return "bg-red-900/30 text-red-200 border border-red-700";
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

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
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

  // Get unique labels from all issues (memoized)
  const allLabels = useMemo(
    () => Array.from(new Set(issues.flatMap((issue) => issue.labels))).sort(),
    [issues]
  );

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-3xl font-bold text-purple-400">AFU9 Issues</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors"
              >
                Import Issues
              </button>
              <Link
                href="/issues/new"
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors"
              >
                New Issue
              </Link>
            </div>
          </div>
          
          {/* Filters */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
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
                  {getCanonicalStatuses().map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
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

              {/* Active Only Toggle */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Active Only
                </label>
                <button
                  onClick={() => setActiveOnly(!activeOnly)}
                  className={`w-full px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    activeOnly
                      ? "bg-cyan-900/30 text-cyan-200 border border-cyan-700"
                      : "bg-gray-800 border border-gray-700 text-gray-100 hover:bg-gray-700"
                  }`}
                >
                  {activeOnly ? "✓ Active Only" : "Show All"}
                </button>
              </div>
            </div>

            {/* Sort Controls */}
            <div className="flex gap-4 pt-4 border-t border-gray-800">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Sort By
                </label>
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as any)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="updatedAt">Updated</option>
                  <option value="createdAt">Created</option>
                  <option value="priority">Priority</option>
                  <option value="status">Status</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Order
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
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
            {filteredAndSortedIssues.length === 0 ? (
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
                        Priority
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Updated
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-900 divide-y divide-gray-800">
                    {filteredAndSortedIssues.map((issue) => {
                      const canonicalStatus = mapToCanonicalStatus(issue.status);
                      const isActive = canonicalStatus === Afu9IssueStatus.SPEC_READY;
                      const isLegacy = isLegacyStatus(issue.status);
                      
                      return (
                        <tr
                          key={issue.id}
                          className="hover:bg-gray-800/50 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {isActive && (
                                <span className="text-cyan-400 text-lg" title="Active (SPEC_READY)">
                                  ⚡
                                </span>
                              )}
                              <div>
                                <Link
                                  href={`/issues/${issue.id}`}
                                  className="text-sm font-medium text-purple-400 hover:text-purple-300"
                                >
                                  {issue.title}
                                </Link>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-1 text-xs font-medium rounded-md ${getStatusBadgeColor(
                                  canonicalStatus
                                )}`}
                              >
                                {canonicalStatus}
                              </span>
                              {isLegacy && (
                                <span
                                  className="text-xs text-gray-500"
                                  title={`Legacy status: ${issue.status} → ${canonicalStatus}`}
                                >
                                  📜
                                </span>
                              )}
                            </div>
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
                            {issue.priority ? (
                              <span className="text-sm text-gray-300 font-medium">
                                {issue.priority}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-500">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                            {formatDate(issue.updatedAt ?? issue.updated_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {canDeleteIssue(issue) && (
                              <button
                                onClick={() => handleDeleteClick(issue)}
                                className="text-red-400 hover:text-red-300 transition-colors"
                                title="Delete issue (only for CREATED + NOT_SENT)"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer Info */}
        {!isLoading && !error && issues.length > 0 && (
          <div className="mt-4 text-sm text-gray-500">
            Showing {filteredAndSortedIssues.length} of {issues.length} issue{issues.length !== 1 ? "s" : ""}
          </div>
        )}

        {/* Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-purple-400">Import Issues</h2>
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportContent("");
                    setRepoPath("docs/roadmaps/afu9_v0_6_backlog.md");
                    setRepoRef("main");
                    setImportError(null);
                    setImportSuccess(null);
                    setImportResult(null);
                    setImportMode("text");
                  }}
                  className="text-gray-400 hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              {/* Import Mode Selector */}
              <div className="mb-4">
                <div className="flex gap-2 border-b border-gray-800">
                  <button
                    onClick={() => setImportMode("text")}
                    className={`px-4 py-2 font-medium transition-colors ${
                      importMode === "text"
                        ? "text-purple-400 border-b-2 border-purple-400"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Text Import
                  </button>
                  <button
                    onClick={() => setImportMode("repo")}
                    className={`px-4 py-2 font-medium transition-colors ${
                      importMode === "repo"
                        ? "text-purple-400 border-b-2 border-purple-400"
                        : "text-gray-400 hover:text-gray-300"
                    }`}
                  >
                    Import from Repo File
                  </button>
                </div>
              </div>

              {importMode === "text" ? (
                <div className="mb-4">
                  <p className="text-sm text-gray-400 mb-2">
                    Paste or type issues below. Separate multiple issues with <code className="bg-gray-800 px-1 py-0.5 rounded">---</code>
                  </p>
                  <p className="text-xs text-gray-500 mb-4">
                    Format: First line = title, rest = body. Optional meta-lines: <code className="bg-gray-800 px-1 py-0.5 rounded">Labels: tag1, tag2</code> or <code className="bg-gray-800 px-1 py-0.5 rounded">Status: CREATED</code>
                  </p>

                  <textarea
                    value={importContent}
                    onChange={(e) => setImportContent(e.target.value)}
                    placeholder="Example:
Fix login bug
Labels: bug, urgent
Status: CREATED
User cannot login with valid credentials

---

Add dark mode
Labels: feature
Implement dark mode theme toggle"
                    className="w-full h-64 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
                  />
                </div>
              ) : (
                <div className="mb-4">
                  <p className="text-sm text-gray-400 mb-4">
                    Import epics and issues from a backlog file in the repository.
                  </p>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Repository File Path
                      </label>
                      <input
                        type="text"
                        value={repoPath}
                        onChange={(e) => setRepoPath(e.target.value)}
                        placeholder="docs/roadmaps/afu9_v0_6_backlog.md"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Path to the backlog file in the repository
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Git Ref (Branch/Tag)
                      </label>
                      <input
                        type="text"
                        value={repoRef}
                        onChange={(e) => setRepoRef(e.target.value)}
                        placeholder="main"
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Branch or tag to fetch the file from (default: main)
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {importError && (
                <div className="mb-4 bg-red-900/20 border border-red-700 rounded-lg p-3">
                  <p className="text-red-300 text-sm font-medium mb-2">{importError}</p>
                  {importResult && importResult.errors && importResult.errors.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-red-400 font-medium">Errors:</p>
                      {importResult.errors.slice(0, 5).map((err: ImportError, idx: number) => (
                        <p key={idx} className="text-xs text-red-300">
                          {err.line ? `Line ${err.line}: ` : ''}{err.message}
                        </p>
                      ))}
                      {importResult.errors.length > 5 && (
                        <p className="text-xs text-red-400">
                          ...and {importResult.errors.length - 5} more errors
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {importSuccess && (
                <div className="mb-4 bg-green-900/20 border border-green-700 rounded-lg p-3">
                  <p className="text-green-300 text-sm font-medium">{importSuccess}</p>
                  {importResult && importMode === "repo" && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-green-900/20 p-2 rounded">
                        <p className="text-green-400 font-medium">Epics</p>
                        <p className="text-green-300">Created: {importResult.epics.created}</p>
                        <p className="text-green-300">Updated: {importResult.epics.updated}</p>
                        <p className="text-green-300">Skipped: {importResult.epics.skipped}</p>
                      </div>
                      <div className="bg-green-900/20 p-2 rounded">
                        <p className="text-green-400 font-medium">Issues</p>
                        <p className="text-green-300">Created: {importResult.issues.created}</p>
                        <p className="text-green-300">Updated: {importResult.issues.updated}</p>
                        <p className="text-green-300">Skipped: {importResult.issues.skipped}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportContent("");
                    setRepoPath("docs/roadmaps/afu9_v0_6_backlog.md");
                    setRepoRef("main");
                    setImportError(null);
                    setImportSuccess(null);
                    setImportResult(null);
                    setImportMode("text");
                  }}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors"
                  disabled={isImporting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors disabled:opacity-50"
                  disabled={isImporting || (importMode === "text" && !importContent.trim()) || (importMode === "repo" && !repoPath.trim())}
                >
                  {isImporting ? "Importing..." : "Import"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmIssue && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-xl font-bold text-red-400 mb-4">Confirm Delete</h2>
              
              <p className="text-gray-300 mb-2">
                Are you sure you want to delete this issue?
              </p>
              <p className="text-sm text-gray-400 mb-4 bg-gray-800 p-3 rounded">
                <strong>{deleteConfirmIssue.title}</strong>
              </p>
              <p className="text-xs text-gray-500 mb-4">
                This action cannot be undone. The issue will be soft-deleted.
              </p>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirmIssue(null)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors disabled:opacity-50"
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
