"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notFound } from "next/navigation";
import { isValidUUID } from "@/lib/utils/uuid-validator";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

interface Issue {
  id: string;
  publicId: string | null;
  title: string;
  body: string | null;
  status: "CREATED" | "SPEC_READY" | "IMPLEMENTING" | "ACTIVE" | "BLOCKED" | "DONE" | "FAILED";
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
  execution_state: "IDLE" | "RUNNING" | "DONE" | "FAILED";
  execution_started_at: string | null;
  execution_completed_at: string | null;
  execution_output: Record<string, unknown> | null;
}

interface ActivityEvent {
  id: string;
  issue_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  old_status: string | null;
  new_status: string | null;
  old_handoff_state: string | null;
  new_handoff_state: string | null;
  created_at: string;
  created_by: string | null;
}

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams: { id: string } =
    // Next.js may pass params as a Promise in some client-page setups.
    typeof (params as any)?.then === "function" ? use(params as Promise<{ id: string }>) : (params as { id: string });
  const { id } = resolvedParams;
  
  // Validate that id is a valid UUID to prevent routing fallback issues
  // The "new" route is now handled by /issues/new/page.tsx
  if (!isValidUUID(id)) {
    notFound();
  }
  
  const router = useRouter();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Activity log state
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  // Activation warning state
  const [showActivationWarning, setShowActivationWarning] = useState(false);
  const [currentActiveIssue, setCurrentActiveIssue] = useState<{ publicId: string; title: string } | null>(null);

  // Edit states
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [editedStatus, setEditedStatus] = useState<Issue["status"]>("CREATED");
  const [editedLabels, setEditedLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Action states
  const [isActivating, setIsActivating] = useState(false);
  const [isHandingOff, setIsHandingOff] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchIssue();
  }, [id]);

  useEffect(() => {
    if (issue) {
      setEditedTitle(issue.title);
      setEditedBody(issue.body || "");
      setEditedStatus(issue.status);
      setEditedLabels(issue.labels);
    }
  }, [issue]);

  const fetchIssue = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/issues/${id}`, {
        credentials: "include",
      });

      const data = await safeFetch(response);
      setIssue(data);
    } catch (err) {
      console.error("Error fetching issue:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchActivityEvents = async () => {
    setIsLoadingEvents(true);
    try {
      const response = await fetch(`/api/issues/${id}/events`, {
        credentials: "include",
      });

      const data = await safeFetch(response);
      setActivityEvents(data.events || []);
    } catch (err) {
      console.error("Error fetching activity events:", err);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const checkActiveIssue = async () => {
    try {
      const response = await fetch(`/api/issues/active-check`, {
        credentials: "include",
      });

      const data = await safeFetch(response);
      if (data.hasActive && data.activeIssue && data.activeIssue.publicId !== id) {
        return {
          publicId: data.activeIssue.publicId,
          title: data.activeIssue.title,
        };
      }
      return null;
    } catch (err) {
      console.error("Error checking active issue:", err);
      return null;
    }
  };

  const refreshActivityLogIfVisible = () => {
    if (showActivityLog) {
      fetchActivityEvents().catch((err) => {
        console.error("Failed to refresh activity log:", err);
      });
    }
  };

  const truncateErrorMessage = (message: string, maxLength: number = 500): string => {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength) + '... (truncated)';
  };

  const handleSave = async () => {
    if (!issue) return;

    setIsSaving(true);
    setSaveError(null);
    setActionMessage(null);

    try {
      const updates: Partial<Pick<Issue, 'title' | 'body' | 'status' | 'labels'>> = {};

      if (editedTitle !== issue.title) {
        updates.title = editedTitle;
      }
      if (editedBody !== (issue.body || "")) {
        updates.body = editedBody;
      }
      if (editedStatus !== issue.status) {
        updates.status = editedStatus;
      }
      if (JSON.stringify(editedLabels) !== JSON.stringify(issue.labels)) {
        updates.labels = editedLabels;
      }

      if (Object.keys(updates).length === 0) {
        setSaveError("No changes to save");
        return;
      }

      const response = await fetch(`/api/issues/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      const updatedIssue = await safeFetch(response);
      setIssue(updatedIssue);
      setIsEditingTitle(false);
      setActionMessage('Issue updated successfully');

      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      console.error("Error updating issue:", err);
      setSaveError(formatErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!issue) return;

    // Check if another issue is active
    const activeIssue = await checkActiveIssue();
    if (activeIssue) {
      setCurrentActiveIssue(activeIssue);
      setShowActivationWarning(true);
      return;
    }

    // Proceed with activation
    await performActivation();
  };

  const performActivation = async () => {
    if (!issue) return;

    setIsActivating(true);
    setActionMessage(null);
    setSaveError(null);
    setShowActivationWarning(false);

    try {
      const response = await fetch(`/api/issues/${id}/activate`, {
        method: "POST",
        credentials: "include",
      });

      const data = await safeFetch(response);
      setIssue(data.issue);
      setActionMessage(
        data.deactivated
          ? `Issue activated. Previously active issue "${data.deactivated.title}" was deactivated.`
          : "Issue activated successfully"
      );
      
      // Refresh activity log
      refreshActivityLogIfVisible();
    } catch (err) {
      console.error("Error activating issue:", err);
      setSaveError(formatErrorMessage(err));
    } finally {
      setIsActivating(false);
    }
  };

  const handleHandoff = async () => {
    if (!issue) return;

    setIsHandingOff(true);
    setActionMessage(null);
    setSaveError(null);

    try {
      const response = await fetch(`/api/issues/${id}/handoff`, {
        method: "POST",
        credentials: "include",
      });

      const data = await safeFetch(response);
      setIssue(data.issue);
      setActionMessage(
        `Issue handed off to GitHub successfully! GitHub Issue #${data.github_issue_number}`
      );
      
      // Refresh activity log if visible
      refreshActivityLogIfVisible();
    } catch (err) {
      console.error("Error handing off issue:", err);
      setSaveError(formatErrorMessage(err));
      // Refresh issue to get updated error state
      fetchIssue();
    } finally {
      setIsHandingOff(false);
    }
  };

  const handleAddLabel = () => {
    const trimmedLabel = newLabel.trim();
    if (trimmedLabel && !editedLabels.includes(trimmedLabel)) {
      setEditedLabels([...editedLabels, trimmedLabel]);
      setNewLabel("");
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    setEditedLabels(editedLabels.filter((label) => label !== labelToRemove));
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "CREATED":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      case "SPEC_READY":
        return "bg-cyan-900/30 text-cyan-200 border border-cyan-700";
      case "IMPLEMENTING":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "ACTIVE":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "BLOCKED":
        return "bg-orange-900/30 text-orange-200 border border-orange-700";
      case "DONE":
        return "bg-emerald-900/30 text-emerald-200 border border-emerald-700";
      case "FAILED":
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

  const getExecutionStateBadgeColor = (state: string) => {
    switch (state) {
      case "RUNNING":
        return "bg-blue-900/30 text-blue-200 border border-blue-700 animate-pulse";
      case "DONE":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "FAILED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      case "IDLE":
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "—";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getEventTypeLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      CREATED: "Created",
      STATUS_CHANGED: "Status Changed",
      HANDOFF_STATE_CHANGED: "Handoff State Changed",
      GITHUB_SYNCED: "Synced to GitHub",
      ERROR_OCCURRED: "Error Occurred",
      FIELD_UPDATED: "Field Updated",
    };
    return labels[eventType] || eventType;
  };

  const getEventTypeBadgeColor = (eventType: string) => {
    switch (eventType) {
      case "CREATED":
        return "bg-blue-900/30 text-blue-200 border border-blue-700";
      case "STATUS_CHANGED":
        return "bg-purple-900/30 text-purple-200 border border-purple-700";
      case "HANDOFF_STATE_CHANGED":
        return "bg-yellow-900/30 text-yellow-200 border border-yellow-700";
      case "GITHUB_SYNCED":
        return "bg-green-900/30 text-green-200 border border-green-700";
      case "ERROR_OCCURRED":
        return "bg-red-900/30 text-red-200 border border-red-700";
      default:
        return "bg-gray-700/30 text-gray-200 border border-gray-600";
    }
  };

  const formatEventDetails = (event: ActivityEvent) => {
    const details: string[] = [];

    if (event.old_status && event.new_status) {
      details.push(`${event.old_status} → ${event.new_status}`);
    } else if (event.new_status) {
      details.push(`Status: ${event.new_status}`);
    }

    if (event.old_handoff_state && event.new_handoff_state) {
      details.push(`${event.old_handoff_state} → ${event.new_handoff_state}`);
    } else if (event.new_handoff_state) {
      details.push(`Handoff: ${event.new_handoff_state}`);
    }

    if (event.event_data && Object.keys(event.event_data).length > 0) {
      if (event.event_data.github_issue_number) {
        details.push(`GitHub Issue #${event.event_data.github_issue_number}`);
      }
      if (event.event_data.error) {
        details.push(`Error: ${event.event_data.error}`);
      }
    }

    return details.join(" | ");
  };

  const toggleActivityLog = () => {
    setShowActivityLog(!showActivityLog);
    if (!showActivityLog && activityEvents.length === 0) {
      fetchActivityEvents();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <p className="mt-4 text-gray-400">Loading issue...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">Error: {error}</p>
            <Link
              href="/issues"
              className="mt-4 inline-block text-purple-400 hover:text-purple-300"
            >
              ← Back to Issues
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!issue) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/issues"
            className="text-purple-400 hover:text-purple-300 mb-4 inline-block"
          >
            ← Back to Issues
          </Link>
        </div>

        {/* Success/Error Messages */}
        {actionMessage && (
          <div className="mb-6 bg-green-900/20 border border-green-700 rounded-lg p-4">
            <p className="text-green-300">{actionMessage}</p>
          </div>
        )}

        {saveError && (
          <div className="mb-6 bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">{saveError}</p>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {/* Title Section */}
          <div className="p-6 border-b border-gray-800">
            {isEditingTitle ? (
              <div className="space-y-3">
                <input
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 text-2xl font-bold focus:outline-none focus:ring-2 focus:ring-purple-500"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingTitle(false);
                      setEditedTitle(issue.title);
                    }}
                    disabled={isSaving}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <h1 className="text-3xl font-bold text-purple-400">
                  {issue.title}
                </h1>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
                >
                  Edit Title
                </button>
              </div>
            )}
            <div className="mt-2 text-sm text-gray-500">
              Issue #{(issue.publicId ?? issue.id.substring(0, 8))}
            </div>
          </div>

          {/* Metadata Section */}
          <div className="p-6 border-b border-gray-800 bg-gray-800/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={editedStatus}
                  onChange={(e) =>
                    setEditedStatus(e.target.value as Issue["status"])
                  }
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="CREATED">CREATED</option>
                  <option value="SPEC_READY">SPEC_READY</option>
                  <option value="IMPLEMENTING">IMPLEMENTING</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="BLOCKED">BLOCKED</option>
                  <option value="DONE">DONE</option>
                  <option value="FAILED">FAILED</option>
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Priority
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400">
                  {issue.priority || "No priority set"}
                </div>
              </div>

              {/* Handoff State */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Handoff State
                </label>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded-md ${getHandoffStateBadgeColor(
                      issue.handoff_state
                    )}`}
                  >
                    {issue.handoff_state}
                  </span>
                  {issue.handoff_state === "FAILED" && (
                    <span className="text-red-400 text-sm" title={issue.last_error || "Failed"}>
                      ⚠️
                    </span>
                  )}
                </div>
              </div>

              {/* Execution State */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Execution State
                </label>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded-md ${getExecutionStateBadgeColor(
                      issue.execution_state || "IDLE"
                    )}`}
                  >
                    {issue.execution_state || "IDLE"}
                  </span>
                </div>
              </div>

              {/* GitHub Link */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  GitHub Issue
                </label>
                {issue.github_url ? (
                  <a
                    href={issue.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-md text-purple-400 transition-colors"
                  >
                    #{issue.github_issue_number} ↗
                  </a>
                ) : (
                  <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-500">
                    Not handed off
                  </div>
                )}
              </div>

              {/* Dates */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Created
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400">
                  {formatDate(issue.createdAt ?? issue.created_at)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Updated
                </label>
                <div className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-400">
                  {formatDate(issue.updatedAt ?? issue.updated_at)}
                </div>
              </div>
            </div>

            {/* Execution Timestamps - show when execution has started */}
            {issue.execution_state && issue.execution_state !== "IDLE" && issue.execution_started_at && (
              <div className="mt-4 p-4 bg-blue-900/10 border border-blue-800/30 rounded-lg">
                <h3 className="text-sm font-semibold text-blue-300 mb-3">Execution Timeline</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      Started
                    </label>
                    <div className="text-sm text-gray-300">
                      {formatDate(issue.execution_started_at)}
                    </div>
                  </div>
                  {issue.execution_completed_at && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Completed
                      </label>
                      <div className="text-sm text-gray-300">
                        {formatDate(issue.execution_completed_at)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Last Error (if failed handoff) */}
            {issue.handoff_state === "FAILED" && issue.last_error && (
              <div className="mt-4 bg-red-900/20 border border-red-700 rounded-lg p-4">
                <label className="block text-sm font-medium text-red-300 mb-2">
                  Handoff Error
                </label>
                <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded-md text-red-200 text-sm mb-3 break-words">
                  {truncateErrorMessage(issue.last_error)}
                </div>
                <button
                  onClick={handleHandoff}
                  disabled={isHandingOff}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isHandingOff ? "Retrying..." : "Retry Handoff"}
                </button>
              </div>
            )}
          </div>

          {/* Labels Section */}
          <div className="p-6 border-b border-gray-800">
            <label className="block text-sm font-medium text-gray-300 mb-3">
              Labels
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {editedLabels.length === 0 ? (
                <span className="text-sm text-gray-500">No labels</span>
              ) : (
                editedLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium rounded-md bg-blue-900/30 text-blue-200 border border-blue-700"
                  >
                    {label}
                    <button
                      onClick={() => handleRemoveLabel(label)}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddLabel();
                  }
                }}
                placeholder="Add new label..."
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                onClick={handleAddLabel}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          {/* Body Section */}
          <div className="p-6 border-b border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-300">
                Description
              </label>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="px-3 py-1 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-md transition-colors"
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            </div>
            {showPreview ? (
              <div className="px-4 py-3 bg-gray-800 border border-gray-700 rounded-md text-gray-300 min-h-[200px] whitespace-pre-wrap">
                {editedBody || <span className="text-gray-500">No description</span>}
              </div>
            ) : (
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={10}
                placeholder="Enter issue description (Markdown supported)..."
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm"
              />
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-6 bg-gray-800/30">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>

              <button
                onClick={handleActivate}
                disabled={isActivating || issue.status === "ACTIVE"}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isActivating
                  ? "Activating..."
                  : issue.status === "ACTIVE"
                  ? "Already Active"
                  : "Activate"}
              </button>

              <button
                onClick={handleHandoff}
                disabled={
                  isHandingOff ||
                  issue.handoff_state === "SYNCED" ||
                  issue.handoff_state === "SENT" ||
                  issue.handoff_state === "FAILED"
                }
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isHandingOff
                  ? "Handing off..."
                  : issue.handoff_state === "SYNCED"
                  ? "Already Synced"
                  : issue.handoff_state === "SENT"
                  ? "Handoff in Progress"
                  : issue.handoff_state === "FAILED"
                  ? "Handoff Failed (See Error Panel)"
                  : "Handoff to GitHub"}
              </button>

              {issue.github_url && (
                <a
                  href={issue.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium transition-colors inline-flex items-center gap-2"
                >
                  Open GitHub Issue ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Activity Log Section */}
        <div className="mt-6 bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <button
            onClick={toggleActivityLog}
            className="w-full px-6 py-4 flex items-center justify-between bg-gray-800/30 hover:bg-gray-800/50 transition-colors"
          >
            <h2 className="text-xl font-semibold text-purple-400">
              Activity Log
            </h2>
            <span className="text-gray-400">
              {showActivityLog ? "▼" : "▶"}
            </span>
          </button>

          {showActivityLog && (
            <div className="p-6">
              {isLoadingEvents ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500"></div>
                  <p className="mt-2 text-gray-400">Loading activity log...</p>
                </div>
              ) : activityEvents.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-400">No activity events recorded</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activityEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-4 p-4 bg-gray-800/30 border border-gray-700 rounded-lg"
                    >
                      <div className="flex-shrink-0 pt-1">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-md ${getEventTypeBadgeColor(
                            event.event_type
                          )}`}
                        >
                          {getEventTypeLabel(event.event_type)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-300">
                          {formatEventDetails(event)}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {formatDate(event.created_at)}
                          {event.created_by && ` • by ${event.created_by}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Activation Warning Dialog */}
        {showActivationWarning && currentActiveIssue && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-yellow-700 rounded-lg p-6 max-w-md mx-4">
              <h3 className="text-xl font-bold text-yellow-400 mb-4">
                ⚠️ Single-Active Issue Mode
              </h3>
              <div className="text-gray-300 space-y-3">
                <p>
                  Another issue is currently ACTIVE:
                </p>
                <div className="p-3 bg-gray-800 border border-gray-700 rounded-md">
                  <p className="font-medium text-purple-400">
                    {currentActiveIssue.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    ID: {currentActiveIssue.publicId}
                  </p>
                </div>
                <p className="text-sm">
                  Only one issue can be ACTIVE at a time. Activating this issue
                  will automatically set the other issue to CREATED status.
                </p>
              </div>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={performActivation}
                  disabled={isActivating}
                  className="flex-1 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-md font-medium transition-colors disabled:opacity-50"
                >
                  {isActivating ? "Activating..." : "Proceed with Activation"}
                </button>
                <button
                  onClick={() => {
                    setShowActivationWarning(false);
                    setCurrentActiveIssue(null);
                  }}
                  disabled={isActivating}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
