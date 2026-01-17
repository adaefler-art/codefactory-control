"use client";

/**
 * Issue Draft Panel Component
 * Issue E81.3: INTENT UI Issue Draft Panel (Preview + Validate + Commit)
 * Issue I907: In-App Flow for Issue Creation and Publishing
 * 
 * Features:
 * - Draft preview with rendered markdown
 * - Validation status badge (VALID / INVALID / DRAFT)
 * - Errors/warnings list (bounded, collapsible)
 * - Actions: Validate, Commit, Copy AFU9 snippet, Publish to GitHub
 * - Auto-load draft per session
 * - Disable actions while pending
 * - Show requestId on failure
 */

import { useEffect, useState } from "react";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { API_ROUTES } from "@/lib/api-routes";
import type { IssueDraft } from "@/lib/schemas/issueDraft";

// Configuration constants
const DEFAULT_GITHUB_OWNER = "adaefler-art";
const DEFAULT_GITHUB_REPO = "codefactory-control";
const BATCH_ID_DISPLAY_LENGTH = 12;

interface ValidationError {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warning";
  details?: Record<string, unknown>;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  meta: {
    issueDraftVersion?: string;
    validatedAt: string;
    validatorVersion: string;
    hash?: string;
  };
}

interface PublishResultItem {
  canonical_id: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  status: 'success' | 'failed';
  github_issue_number?: number;
  github_issue_url?: string;
  error_message?: string;
  rendered_issue_hash?: string;
  labels_applied?: string[];
}

interface PublishResult {
  success: boolean;
  batch_id: string;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  items: PublishResultItem[];
  links: {
    batch_id: string;
    request_id: string;
  };
  warnings?: string[];
  message?: string;
}

interface IssueDraftData {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  issue_json: IssueDraft;
  issue_hash: string | null;
  last_validation_status: "valid" | "invalid" | "draft" | null;
  last_validation_at: string | null;
  last_validation_result: ValidationResult | null;
}

interface IssueDraftPanelProps {
  sessionId: string | null;
  issueId?: string | null; // AFU-9 issue ID for direct orchestrator path
  refreshKey?: number;
  onDraftUpdated?: () => void; // Callback for when draft is updated (e.g., from PATCH)
}

export default function IssueDraftPanel({ sessionId, issueId, refreshKey, onDraftUpdated }: IssueDraftPanelProps) {
  const [draft, setDraft] = useState<IssueDraftData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [showPublishResult, setShowPublishResult] = useState(false);

  // Auto-load draft when session changes or refreshKey changes
  useEffect(() => {
    if (sessionId) {
      loadDraft();
    } else {
      setDraft(null);
      setError(null);
      setLastUpdatedAt(null);
      setLastRequestId(null);
    }
  }, [sessionId, refreshKey]);

  const loadDraft = async () => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);
    setRequestId(null);

    try {
      const response = await fetch(API_ROUTES.intent.issueDraft.get(sessionId), {
        credentials: "include",
        cache: "no-store",
      });

      const data = await safeFetch(response);
      
      // Handle new 200 response with success:true, draft:null for empty state
      if (data && typeof data === "object" && "success" in data && "draft" in data) {
        const apiResponse = data as { success: boolean; draft: IssueDraftData | null; reason?: string };
        
        if (apiResponse.success && apiResponse.draft === null) {
          // Empty state - no draft yet (not an error)
          setDraft(null);
          return;
        }
        
        if (apiResponse.success && apiResponse.draft) {
          setDraft(apiResponse.draft);
          return;
        }
      }
      
      // Unexpected response format
      console.error("Unexpected API response format:", data);
      setError("Unexpected response format from server");
    } catch (err) {
      console.error("Failed to load issue draft:", err);
      
      // Check for MIGRATION_REQUIRED error using error code
      if (typeof err === "object" && err !== null) {
        const apiError = err as { code?: string; details?: { code?: string }; requestId?: string };
        
        // Check for code field in details object or top-level
        const errorCode = apiError.code || (typeof apiError.details === "object" && apiError.details?.code);
        
        if (errorCode === "MIGRATION_REQUIRED") {
          setError("Database migration required. Please run migrations to enable issue draft functionality.");
          setRequestId(apiError.requestId || null);
          return;
        }
      }
      
      const errMsg = formatErrorMessage(err);
      setError(errMsg);
      
      // Try to extract requestId from error
      if (typeof err === "object" && err !== null && "requestId" in err) {
        setRequestId(String(err.requestId));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!sessionId || !draft) return;

    setIsValidating(true);
    setError(null);
    setRequestId(null);

    try {
      const response = await fetch(
        API_ROUTES.intent.issueDraft.validate(sessionId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ issue_json: draft.issue_json }),
        }
      );

      const data = await safeFetch(response);
      
      // Update local draft with validation result
      setDraft({
        ...draft,
        last_validation_status: data.validation.isValid ? "valid" : "invalid",
        last_validation_result: data.validation,
        last_validation_at: data.validation.meta.validatedAt,
        issue_hash: data.validation.meta.hash || draft.issue_hash,
      });
    } catch (err) {
      console.error("Failed to validate issue draft:", err);
      const errMsg = formatErrorMessage(err);
      setError(errMsg);
      
      if (typeof err === "object" && err !== null && "requestId" in err) {
        setRequestId(String(err.requestId));
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!sessionId || !draft) return;

    setIsCommitting(true);
    setError(null);
    setRequestId(null);

    try {
      const response = await fetch(
        API_ROUTES.intent.issueDraft.commit(sessionId),
        {
          method: "POST",
          credentials: "include",
        }
      );

      const data = await safeFetch(response);
      
      // Show success message
      setError(null);
      
      // Reload draft to get updated state
      await loadDraft();
    } catch (err) {
      console.error("Failed to commit issue draft:", err);
      const errMsg = formatErrorMessage(err);
      setError(errMsg);
      
      if (typeof err === "object" && err !== null && "requestId" in err) {
        setRequestId(String(err.requestId));
      }
    } finally {
      setIsCommitting(false);
    }
  };

  const handlePublish = async () => {
    if (!sessionId || !draft) return;

    // Get owner/repo from environment or use default
    // Note: NEXT_PUBLIC_* env vars are inlined at build time
    const owner = process.env.NEXT_PUBLIC_GITHUB_OWNER || DEFAULT_GITHUB_OWNER;
    const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || DEFAULT_GITHUB_REPO;

    setIsPublishing(true);
    setError(null);
    setRequestId(null);
    setPublishResult(null);
    setShowPublishResult(false);

    try {
      // Use canonical issue orchestrator if issueId is available
      // Otherwise fall back to session-based compatibility route
      const publishUrl = issueId
        ? API_ROUTES.intent.issues.publish(issueId)
        : API_ROUTES.intent.issueDraft.publish(sessionId);
      
      const response = await fetch(
        publishUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            owner,
            repo,
            issue_set_id: sessionId, // Publish all versions from this session
          }),
        }
      );

      const data = await safeFetch(response);
      
      // Show success with publish result
      setPublishResult(data);
      setShowPublishResult(true);
      setError(null);
      
    } catch (err) {
      console.error("Failed to publish issue draft:", err);
      const errMsg = formatErrorMessage(err);
      setError(errMsg);
      
      if (typeof err === "object" && err !== null && "requestId" in err) {
        setRequestId(String(err.requestId));
      }
    } finally {
      setIsPublishing(false);
    }
  };

  const handleCopySnippet = async () => {
    if (!draft) return;

    try {
      const snippet = formatAsAFU9Import(draft.issue_json);
      await navigator.clipboard.writeText(snippet);
      
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy snippet:", err);
      setError("Failed to copy to clipboard");
    }
  };

  // Format issue draft as AFU9-compatible import markdown
  const formatAsAFU9Import = (issue: IssueDraft): string => {
    const lines: string[] = [];
    
    lines.push(`# ${issue.title}`);
    lines.push("");
    lines.push(`**Canonical-ID:** ${issue.canonicalId}`);
    lines.push(`**Type:** ${issue.type}`);
    lines.push(`**Priority:** ${issue.priority}`);
    lines.push("");
    
    // Labels (sorted)
    if (issue.labels.length > 0) {
      lines.push(`**Labels:** ${issue.labels.join(", ")}`);
      lines.push("");
    }
    
    // Dependencies (sorted)
    if (issue.dependsOn.length > 0) {
      lines.push(`**Depends On:** ${issue.dependsOn.join(", ")}`);
      lines.push("");
    }
    
    // Body
    lines.push("## Description");
    lines.push("");
    lines.push(issue.body);
    lines.push("");
    
    // Acceptance Criteria
    lines.push("## Acceptance Criteria");
    lines.push("");
    issue.acceptanceCriteria.forEach((ac, idx) => {
      lines.push(`${idx + 1}. ${ac}`);
    });
    lines.push("");
    
    // Verification
    lines.push("## Verification");
    lines.push("");
    lines.push("### Commands");
    issue.verify.commands.forEach((cmd) => {
      lines.push(`- \`${cmd}\``);
    });
    lines.push("");
    lines.push("### Expected Results");
    issue.verify.expected.forEach((exp) => {
      lines.push(`- ${exp}`);
    });
    lines.push("");
    
    // Guards
    lines.push("## Guards");
    lines.push("");
    lines.push(`- **Environment:** ${issue.guards.env}`);
    lines.push(`- **Production Blocked:** ${issue.guards.prodBlocked ? "Yes" : "No"}`);
    lines.push("");
    
    // KPI (optional)
    if (issue.kpi) {
      lines.push("## KPI");
      lines.push("");
      if (issue.kpi.dcu !== undefined) {
        lines.push(`- **DCU:** ${issue.kpi.dcu}`);
      }
      if (issue.kpi.intent) {
        lines.push(`- **Intent:** ${issue.kpi.intent}`);
      }
      lines.push("");
    }
    
    return lines.join("\n");
  };

  const renderValidationBadge = () => {
    if (!draft) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300 border border-gray-600">
          NO DRAFT
        </span>
      );
    }

    const status = draft.last_validation_status || "draft";
    
    switch (status) {
      case "valid":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-300 border border-green-700">
            <span className="w-2 h-2 bg-green-400 rounded-full mr-1.5"></span>
            VALID
          </span>
        );
      case "invalid":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-300 border border-red-700">
            <span className="w-2 h-2 bg-red-400 rounded-full mr-1.5"></span>
            INVALID
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-yellow-900/30 text-yellow-300 border border-yellow-700">
            <span className="w-2 h-2 bg-yellow-400 rounded-full mr-1.5"></span>
            DRAFT
          </span>
        );
    }
  };

  const hasActions = Boolean(sessionId);
  const canValidate = hasActions && draft && !isValidating && !isCommitting && !isPublishing;
  const canCommit = hasActions && draft && draft.last_validation_status === "valid" && !isValidating && !isCommitting && !isPublishing;
  const canPublish = hasActions && draft && draft.last_validation_status === "valid" && !isValidating && !isCommitting && !isPublishing;
  const canCopy = Boolean(draft);

  // Get errors and warnings (deterministic - already sorted from validator)
  const errors = draft?.last_validation_result?.errors || [];
  const warnings = draft?.last_validation_result?.warnings || [];

  return (
    <div className="w-[700px] border-l border-gray-800 bg-gray-900 flex flex-col shrink-0">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-100">Issue Draft</h3>
          <div className="flex items-center gap-3">
            {renderValidationBadge()}
            {draft && lastUpdatedAt && (
              <span className="text-xs text-gray-400">
                Updated: {new Date(lastUpdatedAt).toLocaleTimeString()}
                {lastRequestId && <span className="ml-1">({lastRequestId.substring(0, 8)})</span>}
              </span>
            )}
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Row 1: Validate, Commit, Copy */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleValidate}
              disabled={!canValidate}
              className="flex-1 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
            >
              {isValidating ? "Validating..." : "Validate"}
            </button>
            
            <button
              onClick={handleCommit}
              disabled={!canCommit}
              className="flex-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
            >
              {isCommitting ? "Committing..." : "Commit Version"}
            </button>
            
            <button
              onClick={handleCopySnippet}
              disabled={!canCopy}
              className="flex-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
              title="Copy as AFU9 Import snippet"
            >
              {copySuccess ? "Copied!" : "Copy Snippet"}
            </button>
          </div>

          {/* Row 2: Publish to GitHub */}
          <button
            onClick={handlePublish}
            disabled={!canPublish}
            className="w-full px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
            title="Publish committed version(s) to GitHub"
          >
            {isPublishing ? "Publishing to GitHub..." : "📤 Publish to GitHub"}
          </button>
        </div>
        
        {/* Publish Result Display */}
        {showPublishResult && publishResult && (
          <div className="mt-3 p-3 bg-green-900/20 border border-green-700 rounded">
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-sm font-semibold text-green-300">Published Successfully!</h4>
              <button
                onClick={() => setShowPublishResult(false)}
                className="text-green-400 hover:text-green-300 text-xs"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-2 text-xs">
              {/* Summary */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-gray-400">Batch ID:</span>
                  <span className="ml-2 font-mono text-green-300">{publishResult.batch_id?.substring(0, BATCH_ID_DISPLAY_LENGTH)}...</span>
                </div>
                <div>
                  <span className="text-gray-400">Total:</span>
                  <span className="ml-2 text-green-200">{publishResult.summary?.total || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400">Created:</span>
                  <span className="ml-2 text-green-200">{publishResult.summary?.created || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400">Updated:</span>
                  <span className="ml-2 text-blue-200">{publishResult.summary?.updated || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400">Skipped:</span>
                  <span className="ml-2 text-gray-400">{publishResult.summary?.skipped || 0}</span>
                </div>
                <div>
                  <span className="text-gray-400">Failed:</span>
                  <span className="ml-2 text-red-300">{publishResult.summary?.failed || 0}</span>
                </div>
              </div>

              {/* GitHub Links */}
              {publishResult.items && publishResult.items.length > 0 && (
                <div className="mt-3 border-t border-green-700 pt-2">
                  <div className="text-gray-300 font-medium mb-1">GitHub Issues:</div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {publishResult.items.filter((item) => item.github_issue_url).map((item) => (
                      <a
                        key={item.canonical_id}
                        href={item.github_issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        {item.canonical_id} → #{item.github_issue_number} ({item.action})
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {publishResult.warnings && publishResult.warnings.length > 0 && (
                <div className="mt-2 text-yellow-300">
                  <div className="font-medium">Warnings:</div>
                  {publishResult.warnings.map((warning, idx) => (
                    <div key={idx} className="text-xs">{warning}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Error Display */}
        {error && (
          <div className="mt-3 p-2 bg-red-900/20 border border-red-700 rounded text-xs">
            <p className="text-red-300">{error}</p>
            {requestId && (
              <p className="text-red-400 mt-1 font-mono">
                Request ID: {requestId}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isLoading && (
          <div className="text-center text-gray-400 py-8">
            Loading draft...
          </div>
        )}

        {!isLoading && !draft && !error && (
          <div className="text-center text-gray-400 py-8">
            <p className="mb-2">No draft yet</p>
            <p className="text-xs">
              INTENT will create a draft when generating issue content
            </p>
          </div>
        )}

        {draft && (
          <>
            {/* Draft Summary - Compact Snapshot (V09-I03) */}
            <div className="bg-gray-800/50 border border-gray-700 rounded p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-gray-400 uppercase">Draft Snapshot</h4>
                {draft.issue_hash && (
                  <span className="font-mono text-xs text-gray-500" title={`Hash: ${draft.issue_hash}`}>
                    {draft.issue_hash.substring(0, 12)}
                  </span>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">ID:</span>
                  <span className="ml-2 font-mono text-purple-300">{draft.issue_json.canonicalId}</span>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>
                  <span className="ml-2">
                    {draft.last_validation_status === 'valid' && <span className="text-green-300">VALID</span>}
                    {draft.last_validation_status === 'invalid' && <span className="text-red-300">INVALID</span>}
                    {(!draft.last_validation_status || draft.last_validation_status === 'draft') && <span className="text-yellow-300">UNKNOWN</span>}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Title:</span>
                  <span className="ml-2 text-gray-200 truncate block">{draft.issue_json.title}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">Updated:</span>
                  <span className="ml-2 text-gray-400">{new Date(draft.updated_at).toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Validation Errors */}
            {errors.length > 0 && (
              <div className="bg-red-900/20 border border-red-700 rounded">
                <button
                  onClick={() => setShowErrors(!showErrors)}
                  className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-red-300 hover:bg-red-900/10 transition-colors"
                >
                  <span>Errors ({errors.length})</span>
                  <span>{showErrors ? "▼" : "▶"}</span>
                </button>
                
                {showErrors && (
                  <div className="px-3 pb-3 space-y-2">
                    {errors.slice(0, 20).map((err, idx) => (
                      <div
                        key={`${err.path}-${err.code}-${idx}`}
                        className="bg-red-950/30 p-2 rounded text-xs"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <span className="font-mono text-red-400">{err.path}</span>
                          <span className="text-red-500 text-xs">{err.code}</span>
                        </div>
                        <p className="text-red-200">{err.message}</p>
                      </div>
                    ))}
                    {errors.length > 20 && (
                      <p className="text-xs text-red-400 text-center">
                        ... and {errors.length - 20} more errors
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Validation Warnings */}
            {warnings.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-700 rounded">
                <button
                  onClick={() => setShowWarnings(!showWarnings)}
                  className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-yellow-300 hover:bg-yellow-900/10 transition-colors"
                >
                  <span>Warnings ({warnings.length})</span>
                  <span>{showWarnings ? "▼" : "▶"}</span>
                </button>
                
                {showWarnings && (
                  <div className="px-3 pb-3 space-y-2">
                    {warnings.slice(0, 20).map((warn, idx) => (
                      <div
                        key={`${warn.path}-${warn.code}-${idx}`}
                        className="bg-yellow-950/30 p-2 rounded text-xs"
                      >
                        <div className="flex items-start justify-between mb-1">
                          <span className="font-mono text-yellow-400">{warn.path}</span>
                          <span className="text-yellow-500 text-xs">{warn.code}</span>
                        </div>
                        <p className="text-yellow-200">{warn.message}</p>
                      </div>
                    ))}
                    {warnings.length > 20 && (
                      <p className="text-xs text-yellow-400 text-center">
                        ... and {warnings.length - 20} more warnings
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Draft Preview */}
            <div className="bg-gray-800 border border-gray-700 rounded">
              <div className="px-3 py-2 border-b border-gray-700">
                <h4 className="text-sm font-medium text-gray-100">Preview</h4>
              </div>
              
              <div className="p-4 space-y-4 text-sm">
                {/* Metadata */}
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <span className="text-gray-400">Canonical ID:</span>
                    <span className="font-mono text-purple-300">{draft.issue_json.canonicalId}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-400">Type:</span>
                    <span className="text-gray-200">{draft.issue_json.type}</span>
                  </div>
                  <div className="flex items-start justify-between">
                    <span className="text-gray-400">Priority:</span>
                    <span className="text-gray-200">{draft.issue_json.priority}</span>
                  </div>
                  {draft.issue_hash && (
                    <div className="flex items-start justify-between">
                      <span className="text-gray-400">Hash:</span>
                      <span className="font-mono text-xs text-gray-500" title={draft.issue_hash}>
                        {draft.issue_hash.substring(0, 12)}...
                      </span>
                    </div>
                  )}
                </div>

                {/* Title */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Title</h5>
                  <p className="text-gray-100 font-medium">{draft.issue_json.title}</p>
                </div>

                {/* Labels (sorted deterministically) */}
                {draft.issue_json.labels.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-400 mb-2">Labels</h5>
                    <div className="flex flex-wrap gap-1">
                      {draft.issue_json.labels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-900/30 text-blue-300 border border-blue-700"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dependencies (sorted deterministically) */}
                {draft.issue_json.dependsOn.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-gray-400 mb-2">Dependencies</h5>
                    <div className="flex flex-wrap gap-1">
                      {draft.issue_json.dependsOn.map((dep) => (
                        <span
                          key={dep}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-purple-900/30 text-purple-300 border border-purple-700"
                        >
                          {dep}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Body (truncated in preview) */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Body</h5>
                  <div className="bg-gray-900 border border-gray-700 rounded p-2 max-h-40 overflow-y-auto">
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">
                      {draft.issue_json.body.length > 500
                        ? draft.issue_json.body.substring(0, 500) + "..."
                        : draft.issue_json.body}
                    </pre>
                  </div>
                </div>

                {/* Acceptance Criteria */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-2">
                    Acceptance Criteria ({draft.issue_json.acceptanceCriteria.length})
                  </h5>
                  <ul className="space-y-1 list-disc list-inside text-gray-300">
                    {draft.issue_json.acceptanceCriteria.slice(0, 5).map((ac, idx) => (
                      <li key={idx} className="text-xs">
                        {ac.length > 100 ? ac.substring(0, 100) + "..." : ac}
                      </li>
                    ))}
                    {draft.issue_json.acceptanceCriteria.length > 5 && (
                      <li className="text-xs text-gray-500">
                        ... and {draft.issue_json.acceptanceCriteria.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>

                {/* Guards */}
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-1">Guards</h5>
                  <div className="bg-gray-900 border border-gray-700 rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-400">Environment:</span>
                      <span className="text-gray-200">{draft.issue_json.guards.env}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Prod Blocked:</span>
                      <span className="text-gray-200">
                        {draft.issue_json.guards.prodBlocked ? "Yes" : "No"}
                      </span>
                    </div>
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
