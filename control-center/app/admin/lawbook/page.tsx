"use client";

import { useEffect, useState } from "react";
import { createMinimalLawbook } from "@/lawbook/schema";

interface LawbookVersion {
  id: string;
  lawbookVersion: string;
  createdAt: string;
  createdBy: string;
  lawbookHash: string;
  schemaVersion: string;
}

interface ValidationResult {
  ok: boolean;
  errors: Array<{ path: string; message: string; code: string }>;
  hash: string | null;
  lawbookId?: string;
  lawbookVersion?: string;
}

interface DiffChange {
  path: string;
  changeType: 'added' | 'removed' | 'modified';
  before: unknown;
  after: unknown;
}

interface DiffResult {
  version1: { id: string; lawbookVersion: string; lawbookHash: string };
  version2: { id: string; lawbookVersion: string; lawbookHash: string };
  changes: DiffChange[];
  changeCount: number;
}

export default function AdminLawbookPage() {
  const [versions, setVersions] = useState<LawbookVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editorText, setEditorText] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Diff view state
  const [showDiffView, setShowDiffView] = useState(false);
  const [diffVersion1, setDiffVersion1] = useState<string>("");
  const [diffVersion2, setDiffVersion2] = useState<string>("");
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  useEffect(() => {
    loadVersions();
    loadActiveVersion();
  }, []);

  const loadVersions = async () => {
    try {
      const response = await fetch("/api/lawbook/versions?limit=100", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load versions");
      }

      const data = await response.json();
      setVersions(data.versions || []);
    } catch (err) {
      console.error("Failed to load versions:", err);
      setError(err instanceof Error ? err.message : "Failed to load versions");
    }
  };

  const loadActiveVersion = async () => {
    try {
      const response = await fetch("/api/lawbook/active", {
        credentials: "include",
      });

      if (!response.ok) {
        // No active version configured
        setActiveVersionId(null);
        return;
      }

      const data = await response.json();
      setActiveVersionId(data.id);
    } catch (err) {
      console.error("Failed to load active version:", err);
    }
  };

  const loadVersionContent = async (versionId: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/lawbook/versions/${versionId}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to load version");
      }

      const data = await response.json();
      setEditorText(JSON.stringify(data.lawbook, null, 2));
      setSelectedVersionId(versionId);
      setValidation(null);
    } catch (err) {
      console.error("Failed to load version content:", err);
      setError(err instanceof Error ? err.message : "Failed to load version");
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setValidation(null);

    try {
      const lawbookJson = JSON.parse(editorText);

      const response = await fetch("/api/lawbook/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(lawbookJson),
      });

      const result = await response.json();
      setValidation(result);

      if (result.ok) {
        setSuccessMessage("Validation successful!");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to validate lawbook"
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const lawbookJson = JSON.parse(editorText);

      const response = await fetch("/api/lawbook/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(lawbookJson),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to publish lawbook");
      }

      const result = await response.json();
      setSuccessMessage(result.message || "Lawbook version published successfully!");
      
      // Reload versions list
      await loadVersions();
      
      // Auto-select the new version
      setSelectedVersionId(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish lawbook");
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (versionId: string) => {
    if (!confirm("Are you sure you want to activate this lawbook version?")) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/lawbook/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ lawbookVersionId: versionId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to activate lawbook");
      }

      const result = await response.json();
      setSuccessMessage(result.message || "Lawbook version activated successfully!");
      
      // Reload active version
      await loadActiveVersion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate lawbook");
    } finally {
      setLoading(false);
    }
  };

  const handleLoadExample = () => {
    const example = createMinimalLawbook();
    setEditorText(JSON.stringify(example, null, 2));
    setValidation(null);
    setSuccessMessage("Example lawbook loaded");
  };

  const handleShowDiff = async () => {
    if (!diffVersion1 || !diffVersion2) {
      setError("Please select two versions to compare");
      return;
    }

    setLoading(true);
    setError(null);
    setDiffResult(null);

    try {
      const response = await fetch("/api/lawbook/diff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ versionId1: diffVersion1, versionId2: diffVersion2 }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to compute diff");
      }

      const result = await response.json();
      setDiffResult(result);
      setShowDiffView(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compute diff");
    } finally {
      setLoading(false);
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === undefined) return "(undefined)";
    if (value === null) return "null";
    if (typeof value === "string") return `"${value}"`;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-purple-400">Lawbook Admin Editor</h1>
          <p className="mt-2 text-gray-400">
            Edit, validate, publish, and manage lawbook versions.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-700 rounded-lg p-4">
            <p className="text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-sm text-red-400 hover:text-red-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 bg-green-900/20 border border-green-700 rounded-lg p-4">
            <p className="text-green-300">{successMessage}</p>
            <button
              onClick={() => setSuccessMessage(null)}
              className="mt-2 text-sm text-green-400 hover:text-green-300"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Diff View Modal */}
        {showDiffView && diffResult && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center">
                <h2 className="text-xl font-semibold text-gray-100">Lawbook Diff</h2>
                <button
                  onClick={() => setShowDiffView(false)}
                  className="text-gray-400 hover:text-gray-300"
                >
                  Close
                </button>
              </div>

              <div className="px-6 py-4 border-b border-gray-800">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400">Version 1:</p>
                    <p className="font-mono text-gray-200">{diffResult.version1.lawbookVersion}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Version 2:</p>
                    <p className="font-mono text-gray-200">{diffResult.version2.lawbookVersion}</p>
                  </div>
                </div>
                <p className="mt-4 text-gray-400">
                  {diffResult.changeCount} change{diffResult.changeCount !== 1 ? "s" : ""} detected
                </p>
              </div>

              <div className="flex-1 overflow-auto px-6 py-4">
                {diffResult.changes.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No changes detected</p>
                ) : (
                  <div className="space-y-4">
                    {diffResult.changes.map((change, idx) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-lg border ${
                          change.changeType === "added"
                            ? "bg-green-900/20 border-green-700"
                            : change.changeType === "removed"
                            ? "bg-red-900/20 border-red-700"
                            : "bg-yellow-900/20 border-yellow-700"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              change.changeType === "added"
                                ? "bg-green-800 text-green-100"
                                : change.changeType === "removed"
                                ? "bg-red-800 text-red-100"
                                : "bg-yellow-800 text-yellow-100"
                            }`}
                          >
                            {change.changeType.toUpperCase()}
                          </span>
                          <span className="font-mono text-sm text-gray-300">{change.path}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-gray-400 mb-1">Before:</p>
                            <pre className="bg-gray-950 p-2 rounded text-gray-200 overflow-x-auto">
                              {formatValue(change.before)}
                            </pre>
                          </div>
                          <div>
                            <p className="text-gray-400 mb-1">After:</p>
                            <pre className="bg-gray-950 p-2 rounded text-gray-200 overflow-x-auto">
                              {formatValue(change.after)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar: Versions List */}
          <div className="lg:col-span-1">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-gray-100 mb-4">Versions</h2>

              {/* Diff Controls */}
              <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
                <p className="text-sm font-medium text-gray-300 mb-2">Compare Versions</p>
                <div className="space-y-2">
                  <select
                    value={diffVersion1}
                    onChange={(e) => setDiffVersion1(e.target.value)}
                    className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100"
                  >
                    <option value="">Select v1...</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.lawbookVersion}
                      </option>
                    ))}
                  </select>
                  <select
                    value={diffVersion2}
                    onChange={(e) => setDiffVersion2(e.target.value)}
                    className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-100"
                  >
                    <option value="">Select v2...</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.lawbookVersion}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleShowDiff}
                    disabled={!diffVersion1 || !diffVersion2 || loading}
                    className="w-full px-3 py-2 text-sm bg-blue-800 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded"
                  >
                    Show Diff
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className={`p-3 rounded-lg border cursor-pointer ${
                      selectedVersionId === version.id
                        ? "bg-purple-900/30 border-purple-700"
                        : "bg-gray-800/50 border-gray-700 hover:bg-gray-800"
                    }`}
                    onClick={() => loadVersionContent(version.id)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm text-gray-200">
                        {version.lawbookVersion}
                      </span>
                      {activeVersionId === version.id && (
                        <span className="px-2 py-0.5 bg-green-800 text-green-100 text-xs rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {new Date(version.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 font-mono truncate">
                      {version.lawbookHash.substring(0, 12)}...
                    </p>
                    {selectedVersionId === version.id && activeVersionId !== version.id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivate(version.id);
                        }}
                        className="mt-2 w-full px-2 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Editor Area */}
          <div className="lg:col-span-3">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <div className="mb-4 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-100">JSON Editor</h2>
                <button
                  onClick={handleLoadExample}
                  className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
                >
                  Load Example
                </button>
              </div>

              <textarea
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                className="w-full h-[400px] px-4 py-3 bg-gray-950 border border-gray-700 rounded-lg text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Enter lawbook JSON here..."
              />

              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleValidate}
                  disabled={loading || !editorText.trim()}
                  className="px-4 py-2 bg-blue-800 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded"
                >
                  {loading ? "Validating..." : "Validate"}
                </button>
                <button
                  onClick={handlePublish}
                  disabled={loading || !editorText.trim()}
                  className="px-4 py-2 bg-purple-800 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded"
                >
                  {loading ? "Publishing..." : "Publish New Version"}
                </button>
              </div>

              {/* Validation Results */}
              {validation && (
                <div className="mt-6">
                  {validation.ok ? (
                    <div className="bg-green-900/20 border border-green-700 rounded-lg p-4">
                      <p className="text-green-300 font-medium">✓ Validation Successful</p>
                      <p className="text-sm text-gray-400 mt-2">
                        Hash: <span className="font-mono">{validation.hash}</span>
                      </p>
                      {validation.lawbookId && (
                        <p className="text-sm text-gray-400">
                          ID: <span className="font-mono">{validation.lawbookId}</span>
                        </p>
                      )}
                      {validation.lawbookVersion && (
                        <p className="text-sm text-gray-400">
                          Version: <span className="font-mono">{validation.lawbookVersion}</span>
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                      <p className="text-red-300 font-medium mb-3">✗ Validation Failed</p>
                      <div className="space-y-2">
                        {validation.errors.map((err, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-red-950/30 border border-red-800 rounded"
                          >
                            <p className="text-sm font-mono text-red-200">{err.path}</p>
                            <p className="text-sm text-red-300 mt-1">{err.message}</p>
                            <p className="text-xs text-red-400 mt-1">Code: {err.code}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
