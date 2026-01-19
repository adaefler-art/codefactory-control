/// <reference types="react" />

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

import React, { useEffect, useRef, useState } from "react";
import { safeFetch, formatErrorMessage } from "../../../src/lib/api/safe-fetch";
import { API_ROUTES } from "../../../src/lib/api-routes";
import type { IssueDraft } from "../../../src/lib/schemas/issueDraft.js";

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

// Explicit states for draft panel (R1)
type DraftPanelState = 
  | "LOADING"      // Initial load or refresh in progress
  | "NO_DRAFT"     // Session exists but no draft created yet
  | "LOADED"       // Draft successfully loaded
  | "ERROR"        // API error or network failure
  | "SCHEMA_ERROR"; // Draft exists but invalid shape

interface IssueDraftPanelProps {
  sessionId: string | null;
  refreshKey?: number;
  onDraftUpdated?: () => void; // Callback for when draft is updated (e.g., from PATCH)
}

export default function IssueDraftPanel({ sessionId, refreshKey, onDraftUpdated }: IssueDraftPanelProps) {
  const [draft, setDraft] = useState<IssueDraftData | null>(null);
  const [panelState, setPanelState] = useState<DraftPanelState>("LOADING");
  const [isValidating, setIsValidating] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [showPublishResult, setShowPublishResult] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fetchSequenceRef = useRef(0); // R2: Sequence ID for race condition guard
  const showDebug = process.env.NODE_ENV !== "production";
  const debugSessionId = sessionId ? sessionId.substring(0, 8) : "none";
  const debugRefreshKey = typeof refreshKey === "number" ? String(refreshKey) : "n/a";
  // --- AFU-9 Issue Creation ---
  const [isCreatingAfu9Issue, setIsCreatingAfu9Issue] = useState(false);
  const [afu9IssueResult, setAfu9IssueResult] = useState<any>(null);
  const isDev = process.env.NODE_ENV === "development";
  const viewDraft = draft?.issue_json ?? null;

  // --- Handlers and helpers ---
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
      const data = (await safeFetch(response)) as { validation: ValidationResult };
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
        setRequestId(String((err as any).requestId));
      }
    } finally {
      setIsValidating(false);
    }
  };

  // R3: Validate draft shape to avoid blank/broken UI
  const validateDraftShape = (draftData: IssueDraftData | null): boolean => {
    if (!draftData) return true; // null is valid (NO_DRAFT state)
    
    // Check required fields
    if (!draftData.id || !draftData.session_id) {
      console.error("[IssueDraftPanel] Invalid draft shape: missing id or session_id");
      return false;
    }
    
    // Check issue_json exists and has minimal shape
    if (!draftData.issue_json || typeof draftData.issue_json !== "object") {
      console.error("[IssueDraftPanel] Invalid draft shape: missing or invalid issue_json");
      return false;
    }
    
    return true;
  };

  const loadDraft = async () => {
    if (!sessionId) {
      setPanelState("NO_DRAFT");
      return;
    }

    // R2: Abort previous request and track sequence
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    
    const currentSequence = ++fetchSequenceRef.current;

    setPanelState("LOADING");
    setError(null);
    setRequestId(null);

    try {
      const response = await fetch(API_ROUTES.intent.issueDraft.get(sessionId), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      const data = await safeFetch(response);

      // R2: Ignore late responses
      if (currentSequence !== fetchSequenceRef.current) {
        console.log("[IssueDraftPanel] Ignoring late response", { currentSequence, latest: fetchSequenceRef.current });
        return;
      }

      if (typeof data === "object" && data !== null && "success" in data) {
        const success = (data as { success: boolean }).success;
        if (success && "draft" in data) {
          const draftData = (data as { draft: IssueDraftData | null }).draft;
          
          // R3: Validate draft shape
          if (!validateDraftShape(draftData)) {
            setPanelState("SCHEMA_ERROR");
            setError("Draft has invalid structure");
            setDraft(draftData);
            setLastRefreshed(new Date().toISOString());
            return;
          }
          
          setDraft(draftData ?? null);
          setLastUpdatedAt(draftData?.updated_at ?? null);
          setLastRefreshed(new Date().toISOString());
          
          // R1: Set appropriate state
          if (draftData === null) {
            setPanelState("NO_DRAFT");
          } else {
            setPanelState("LOADED");
          }
          return;
        }
      }

      setPanelState("ERROR");
      setError("Invalid response from server");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Don't change state on abort
        return;
      }
      console.error("Failed to load issue draft:", err);
      setPanelState("ERROR");
      setError(formatErrorMessage(err));
    }
  };

  useEffect(() => {
    void loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, refreshKey]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // --- AFU-9 Issue Creation Handler ---
  const handleCreateAfu9Issue = async () => {
    if (!sessionId || !draft) return;
    setIsCreatingAfu9Issue(true);
    setError(null);
    setRequestId(null);
    setAfu9IssueResult(null);
    try {
      const route = `/api/intent/sessions/${sessionId}/issues/create`;
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ issueDraftId: draft.id }),
      });
      const data = await safeFetch(response);
      setAfu9IssueResult(data);
    } catch (err) {
      setError("Failed to create AFU-9 Issue");
    } finally {
      setIsCreatingAfu9Issue(false);
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
      const response = await fetch(
        API_ROUTES.intent.issueDraft.publish(sessionId),
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
      setPublishResult(data as PublishResult);
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
    // R1: Show appropriate badge based on panel state
    if (panelState === "LOADING") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300 border border-gray-600">
          <span className="w-2 h-2 bg-gray-400 rounded-full mr-1.5 animate-pulse"></span>
          LOADING
        </span>
      );
    }

    if (panelState === "NO_DRAFT") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300 border border-gray-600">
          NO DRAFT
        </span>
      );
    }

    if (panelState === "ERROR" || panelState === "SCHEMA_ERROR") {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-red-900/30 text-red-300 border border-red-700">
          <span className="w-2 h-2 bg-red-400 rounded-full mr-1.5"></span>
          ERROR
        </span>
      );
    }

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
  const canValidate = hasActions && draft && panelState === "LOADED" && !isValidating && !isCommitting && !isPublishing;
  const canCommit = hasActions && draft && draft.last_validation_status === "valid" && panelState === "LOADED" && !isValidating && !isCommitting && !isPublishing;
  const canPublish = hasActions && draft && draft.last_validation_status === "valid" && panelState === "LOADED" && !isValidating && !isCommitting && !isPublishing;
  const canCopy = Boolean(draft) && panelState === "LOADED";
  // Get errors and warnings (deterministic - already sorted from validator)

  return (
    <div className="w-[700px] border-l border-gray-800 bg-gray-900 flex flex-col shrink-0">
      {/* Header */}
      <div className="border-b border-gray-800 px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-100">Issue Draft</h3>
          <div className="flex items-center gap-3">
            {renderValidationBadge()}
            {isDev && (
              <span className="text-[10px] text-gray-400 border border-gray-700 rounded px-1.5 py-0.5">
                [draft] sid={sessionId ? sessionId.substring(0, 8) : "null"} state={panelState}
              </span>
            )}
            {draft && lastUpdatedAt && (
              <span className="text-xs text-gray-400">
                Updated: {new Date(lastUpdatedAt).toLocaleTimeString()}
                {lastRequestId && <span className="ml-1">({lastRequestId.substring(0, 8)})</span>}
              </span>
            )}
          </div>
        </div>
        {/* R4: Dev-only metadata for debuggability */}
        {isDev && draft && panelState === "LOADED" && (
          <div className="mb-2 text-[10px] text-gray-500 space-y-0.5">
            <div>Session: {sessionId?.substring(0, 16)}...</div>
            {draft.created_at && <div>Created: {new Date(draft.created_at).toLocaleString()}</div>}
            {draft.updated_at && <div>Updated: {new Date(draft.updated_at).toLocaleString()}</div>}
            {lastRefreshed && <div>Last refreshed: {new Date(lastRefreshed).toLocaleTimeString()}</div>}
          </div>
        )}
        {/* Action Buttons */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={handleValidate} disabled={!canValidate} className="flex-1 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors">{isValidating ? "Validating..." : "Validate"}</button>
            <button onClick={handleCommit} disabled={!canCommit} className="flex-1 px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors">{isCommitting ? "Committing..." : "Commit Version"}</button>
            <button onClick={handleCopySnippet} disabled={!canCopy} className="flex-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors" title="Copy as AFU9 Import snippet">{copySuccess ? "Copied!" : "Copy Snippet"}</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCreateAfu9Issue} disabled={!canPublish || isCreatingAfu9Issue} className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors" title="Create AFU-9 Issue from committed draft">{isCreatingAfu9Issue ? "Creating AFU-9 Issue..." : "🗂 Create AFU-9 Issue"}</button>
            <button onClick={handlePublish} disabled={!canPublish} className="flex-1 px-3 py-1.5 bg-orange-600 text-white text-sm font-medium rounded hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors" title="Publish committed version(s) to GitHub">{isPublishing ? "Publishing to GitHub..." : "📤 Publish to GitHub"}</button>
          </div>
          {afu9IssueResult && (
            <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700 rounded">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-semibold text-blue-300">AFU-9 Issue Created!</h4>
                <button onClick={() => setAfu9IssueResult(null)} className="text-blue-400 hover:text-blue-300 text-xs">✕</button>
              </div>
              <div className="space-y-2 text-xs">
                <div><span className="text-gray-400">Issue ID:</span> <span className="ml-2 font-mono text-blue-300">{afu9IssueResult.issueId}</span></div>
                <div><span className="text-gray-400">Public ID:</span> <span className="ml-2 font-mono text-blue-300">{afu9IssueResult.publicId}</span></div>
                <div><span className="text-gray-400">Canonical ID:</span> <span className="ml-2 font-mono text-purple-300">{afu9IssueResult.canonicalId}</span></div>
                <div><span className="text-gray-400">State:</span> <span className="ml-2 text-blue-200">{afu9IssueResult.state}</span></div>
                <div className="mt-2"><a href="/issues" className="text-blue-400 hover:underline">Open Issues Page →</a></div>
              </div>
            </div>
          )}
          {showPublishResult && publishResult && (
            <div className="mt-3 p-3 bg-green-900/20 border border-green-700 rounded">
              <div className="flex items-start justify-between mb-2">
                <h4 className="text-sm font-semibold text-green-300">Published Successfully!</h4>
                <button onClick={() => setShowPublishResult(false)} className="text-green-400 hover:text-green-300 text-xs">✕</button>
              </div>
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-gray-400">Batch ID:</span> <span className="ml-2 font-mono text-green-300">{publishResult.batch_id?.substring(0, BATCH_ID_DISPLAY_LENGTH)}...</span></div>
                  <div><span className="text-gray-400">Total:</span> <span className="ml-2 text-green-200">{publishResult.summary?.total || 0}</span></div>
                  <div><span className="text-gray-400">Created:</span> <span className="ml-2 text-green-200">{publishResult.summary?.created || 0}</span></div>
                  <div><span className="text-gray-400">Updated:</span> <span className="ml-2 text-blue-200">{publishResult.summary?.updated || 0}</span></div>
                  <div><span className="text-gray-400">Skipped:</span> <span className="ml-2 text-gray-400">{publishResult.summary?.skipped || 0}</span></div>
                  <div><span className="text-gray-400">Failed:</span> <span className="ml-2 text-red-300">{publishResult.summary?.failed || 0}</span></div>
                </div>
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
          {error && (
            <div className="mt-3 p-2 bg-red-900/20 border border-red-700 rounded text-xs">
              <p className="text-red-300">{error}</p>
              {requestId && (<p className="text-red-400 mt-1 font-mono">Request ID: {requestId}</p>)}
            </div>
          )}
        </div>
      </div>
      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* R1: Explicit state rendering - LOADING */}
        {panelState === "LOADING" && (
          <div className="text-center text-gray-400 py-8">
            <div className="animate-pulse">Loading draft...</div>
          </div>
        )}
        
        {/* R1: Explicit state rendering - NO_DRAFT */}
        {panelState === "NO_DRAFT" && (
          <div className="text-center text-gray-400 py-8">
            <p className="mb-2">No draft yet</p>
            <p className="text-xs">INTENT will create a draft when generating issue content</p>
          </div>
        )}
        
        {/* R1: Explicit state rendering - ERROR */}
        {panelState === "ERROR" && (
          <div className="text-center py-8">
            <div className="text-red-300 mb-2">Failed to load draft</div>
            {error && <p className="text-xs text-gray-400">{error}</p>}
            {requestId && <p className="text-xs text-gray-500 mt-1 font-mono">Request ID: {requestId}</p>}
          </div>
        )}
        
        {/* R1 & R3: Explicit state rendering - SCHEMA_ERROR */}
        {panelState === "SCHEMA_ERROR" && (
          <div className="py-4">
            <div className="bg-red-900/20 border border-red-700 rounded p-4">
              <div className="text-red-300 font-semibold mb-2">Draft Shape Invalid</div>
              <p className="text-xs text-gray-400 mb-3">
                The draft exists but has an invalid structure. This may indicate a data corruption issue.
              </p>
              {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
              {isDev && draft && (
                <details className="mt-3">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                    Show raw JSON (dev mode)
                  </summary>
                  <pre className="mt-2 p-2 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300 overflow-auto max-h-64">
                    {JSON.stringify(draft, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}
        
        {/* R1: Explicit state rendering - LOADED (with draft content) */}
        {panelState === "LOADED" && draft && !viewDraft && (
          <div className="text-xs text-yellow-300 bg-yellow-900/20 border border-yellow-700 rounded p-2">
            Draft loaded but issue content is missing.
          </div>
        )}
        {panelState === "LOADED" && viewDraft && (
          <div className="bg-gray-800 border border-gray-700 rounded">
            <div className="px-3 py-2 border-b border-gray-700">
              <h4 className="text-sm font-medium text-gray-100">Preview</h4>
            </div>
            <div className="p-4 space-y-4 text-sm">
              {/* Metadata */}
              {(() => {
                const issueHash = draft?.issue_hash;
                return (
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <span className="text-gray-400">Canonical ID:</span>
                  <span className="font-mono text-purple-300">{viewDraft.canonicalId}</span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-gray-400">Type:</span>
                  <span className="text-gray-200">{viewDraft.type}</span>
                </div>
                <div className="flex items-start justify-between">
                  <span className="text-gray-400">Priority:</span>
                  <span className="text-gray-200">{viewDraft.priority}</span>
                </div>
                {issueHash && (
                  <div className="flex items-start justify-between">
                    <span className="text-gray-400">Hash:</span>
                    <span className="font-mono text-xs text-gray-500" title={issueHash}>
                      {issueHash.substring(0, 12)}...
                    </span>
                  </div>
                )}
              </div>
                );
              })()}
              {/* Title */}
              <div>
                <h5 className="text-xs font-semibold text-gray-400 mb-1">Title</h5>
                <p className="text-gray-100 font-medium">{viewDraft.title}</p>
              </div>
              {/* Labels (sorted deterministically) */}
              {viewDraft.labels.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-2">Labels</h5>
                  <div className="flex flex-wrap gap-1">
                    {viewDraft.labels.map((label) => (
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
              {viewDraft.dependsOn.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-400 mb-2">Dependencies</h5>
                  <div className="flex flex-wrap gap-1">
                    {viewDraft.dependsOn.map((dep) => (
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
                    {viewDraft.body.length > 500
                      ? viewDraft.body.substring(0, 500) + "..."
                      : viewDraft.body}
                  </pre>
                </div>
              </div>
              {/* Acceptance Criteria */}
              <div>
                <h5 className="text-xs font-semibold text-gray-400 mb-2">
                  Acceptance Criteria ({viewDraft.acceptanceCriteria.length})
                </h5>
                <ul className="space-y-1 list-disc list-inside text-gray-300">
                  {viewDraft.acceptanceCriteria.slice(0, 5).map((ac, idx) => (
                    <li key={idx} className="text-xs">
                      {ac.length > 100 ? ac.substring(0, 100) + "..." : ac}
                    </li>
                  ))}
                  {viewDraft.acceptanceCriteria.length > 5 && (
                    <li className="text-xs text-gray-500">
                      ... and {viewDraft.acceptanceCriteria.length - 5} more
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
                    <span className="text-gray-200">{viewDraft.guards.env}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Prod Blocked:</span>
                    <span className="text-gray-200">
                      {viewDraft.guards.prodBlocked ? "Yes" : "No"}
                    </span>
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

