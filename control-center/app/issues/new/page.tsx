"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";
import { parseLabelsInput } from "@/lib/label-utils";

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
}

export default function NewIssuePage() {
  const router = useRouter();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit states
  const [editedTitle, setEditedTitle] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [editedStatus, setEditedStatus] = useState<Issue["status"]>("CREATED");
  const [editedLabels, setEditedLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchDraftIssue();
  }, []);

  useEffect(() => {
    if (issue) {
      setEditedTitle(issue.title);
      setEditedBody(issue.body || "");
      setEditedStatus(issue.status);
      setEditedLabels(issue.labels);
    }
  }, [issue]);

  const fetchDraftIssue = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(API_ROUTES.issues.new, {
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeFetch(response);
      if (typeof data === 'object' && data !== null && 'id' in data) {
        setIssue(data as Issue);
      } else {
        setIssue(null);
        setError('Invalid response from server');
      }
    } catch (err) {
      console.error("Error fetching draft issue:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (editedTitle.trim().length === 0) {
      setSaveError('Title is required');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const payload = {
        title: editedTitle,
        body: editedBody,
        status: editedStatus,
        labels: editedLabels,
      };

      const response = await fetch(API_ROUTES.issues.new, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const createdIssue = await safeFetch(response);
      if (typeof createdIssue === 'object' && createdIssue !== null && 'id' in createdIssue && typeof (createdIssue as any).id === 'string') {
        router.push(`/issues/${(createdIssue as any).id}`);
      } else {
        router.push('/issues');
      }
    } catch (err) {
      console.error("Error creating issue:", err);
      setSaveError(formatErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddLabel = () => {
    const trimmedLabel = newLabel.trim();
    if (!trimmedLabel) {
      return;
    }
    
    // Use centralized parsing function to support comma-separated input
    const newLabels = parseLabelsInput(trimmedLabel);
    
    // Add new labels, avoiding duplicates
    const uniqueNewLabels = newLabels.filter(label => !editedLabels.includes(label));
    if (uniqueNewLabels.length > 0) {
      setEditedLabels([...editedLabels, ...uniqueNewLabels]);
      setNewLabel("");
    } else {
      setNewLabel("");
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    setEditedLabels(editedLabels.filter((label) => label !== labelToRemove));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
            <p className="mt-4 text-gray-400">Loading...</p>
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

        {/* Error Message */}
        {saveError && (
          <div className="mb-6 bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">{saveError}</p>
          </div>
        )}

        {/* Main Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {/* Title Section */}
          <div className="p-6 border-b border-gray-800">
            <h1 className="text-3xl font-bold text-purple-400 mb-4">
              Create New Issue
            </h1>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-300">
                Title
              </label>
              <input
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                placeholder="Enter issue title..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
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
            </div>
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
                placeholder="Add labels (comma-separated: tag1, tag2)..."
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
                {isSaving ? "Creating..." : "Create Issue"}
              </button>
              <Link
                href="/issues"
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-medium transition-colors inline-block"
              >
                Cancel
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
