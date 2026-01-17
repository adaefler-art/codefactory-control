/**
 * CR (Change Request) Editor Component
 * Issue E74.3: CR Preview/Edit UI + Validation Gate
 * 
 * Provides JSON editor for CR drafts with validation and status tracking
 */

"use client";

import { useState, useEffect } from "react";
import { API_ROUTES } from "@/lib/api-routes";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";
import { EXAMPLE_MINIMAL_CR } from "@/lib/schemas/changeRequest";

interface CrDraft {
  id: string;
  session_id: string;
  created_at: string;
  updated_at: string;
  cr_json: unknown;
  cr_hash: string;
  status: "draft" | "valid" | "invalid";
}

interface ValidationError {
  code: string;
  message: string;
  path: string;
  severity: "error" | "warn";
  details?: Record<string, unknown>;
}

interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  meta: {
    crVersion?: string;
    validatedAt: string;
    validatorVersion: string;
    lawbookVersion?: string | null;
    hash?: string;
  };
}

interface CrEditorProps {
  sessionId: string;
}

export default function CrEditor({ sessionId }: CrEditorProps) {
  const [crText, setCrText] = useState("");
  const [draft, setDraft] = useState<CrDraft | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Load draft on mount
  useEffect(() => {
    loadDraft();
  }, [sessionId]);

  const loadDraft = async () => {
    try {
      const response = await fetch(API_ROUTES.intent.cr.get(sessionId), {
        credentials: "include",
        cache: "no-store",
      });
      const data = await safeFetch(response);
      if (typeof data === 'object' && data !== null && 'draft' in data && data.draft) {
        setDraft((data as { draft: CrDraft }).draft);
        setCrText(JSON.stringify((data as { draft: CrDraft }).draft.cr_json, null, 2));
        setHasUnsavedChanges(false);
      } else {
        // No draft yet - initialize with example
        setCrText(JSON.stringify(EXAMPLE_MINIMAL_CR, null, 2));
        setHasUnsavedChanges(false);
      }
    } catch (err) {
      console.error("Failed to load CR draft:", err);
      setError(formatErrorMessage(err));
      // Initialize with example on error
      setCrText(JSON.stringify(EXAMPLE_MINIMAL_CR, null, 2));
    }
  };

  const handleTextChange = (text: string) => {
    setCrText(text);
    setHasUnsavedChanges(true);
  };

  const saveDraft = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Parse JSON first
      let crJson: unknown;
      try {
        crJson = JSON.parse(crText);
      } catch (parseError) {
        setError(`Invalid JSON: ${parseError instanceof Error ? parseError.message : "Parse error"}`);
        setIsSaving(false);
        return;
      }

      const response = await fetch(API_ROUTES.intent.cr.save(sessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ crJson }),
      });

      const savedDraft = await safeFetch(response);
      if (typeof savedDraft === 'object' && savedDraft !== null && 'id' in savedDraft) {
        setDraft(savedDraft as CrDraft);
        setHasUnsavedChanges(false);
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      console.error("Failed to save CR draft:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const validateDraft = async () => {
    setIsValidating(true);
    setError(null);

    try {
      // Parse JSON first
      let crJson: unknown;
      try {
        crJson = JSON.parse(crText);
      } catch (parseError) {
        setError(`Invalid JSON: ${parseError instanceof Error ? parseError.message : "Parse error"}`);
        setIsValidating(false);
        return;
      }

      const response = await fetch(API_ROUTES.intent.cr.validate(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ crJson }),
      });

      const data = await safeFetch(response);
      if (typeof data === 'object' && data !== null && 'validation' in data) {
        setValidation((data as { validation: ValidationResult }).validation);
        if ('draft' in data && (data as any).draft) {
          setDraft((data as { draft: CrDraft }).draft);
          setHasUnsavedChanges(false);
        }
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      console.error("Failed to validate CR draft:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsValidating(false);
    }
  };

  const getStatusBadgeColor = () => {
    if (!draft) return "bg-gray-200 text-gray-700";
    switch (draft.status) {
      case "valid":
        return "bg-green-100 text-green-800 border-green-300";
      case "invalid":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
    }
  };

  const getStatusIcon = () => {
    if (!draft) return "○";
    switch (draft.status) {
      case "valid":
        return "✓";
      case "invalid":
        return "✗";
      default:
        return "○";
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Change Request</h3>
          <div className="flex items-center gap-3">
            {/* Status Badge */}
            {draft && (
              <div className={`px-3 py-1 rounded border text-sm font-medium ${getStatusBadgeColor()}`}>
                {getStatusIcon()} {draft.status.toUpperCase()}
              </div>
            )}
            
            {/* Unsaved Changes Indicator */}
            {hasUnsavedChanges && (
              <div className="text-xs text-orange-600 font-medium">
                Unsaved changes
              </div>
            )}
          </div>
        </div>
        
        {/* Hash Display */}
        {draft && (
          <div className="mt-2 text-xs text-gray-500 font-mono">
            Hash: {draft.cr_hash.substring(0, 16)}...
          </div>
        )}
      </div>

      {/* JSON Editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <textarea
          value={crText}
          onChange={(e) => handleTextChange(e.target.value)}
          className="flex-1 w-full p-4 font-mono text-sm border-0 focus:outline-none resize-none"
          placeholder="Enter CR JSON here..."
          spellCheck={false}
        />
      </div>

      {/* Validation Results */}
      {validation && (
        <div className="border-t border-gray-200 p-4 bg-gray-50 max-h-64 overflow-y-auto">
          <div className="mb-2 font-semibold text-sm">
            Validation Results:
            {validation.ok ? (
              <span className="ml-2 text-green-600">✓ Valid</span>
            ) : (
              <span className="ml-2 text-red-600">✗ Invalid</span>
            )}
          </div>
          
          {/* Errors */}
          {validation.errors.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold text-red-700 mb-1">
                Errors ({validation.errors.length}):
              </div>
              <div className="space-y-1">
                {validation.errors.map((err, idx) => (
                  <div key={idx} className="text-xs bg-red-50 border border-red-200 rounded p-2">
                    <div className="font-mono text-red-900">{err.path}</div>
                    <div className="text-red-700 mt-1">{err.message}</div>
                    <div className="text-red-600 mt-1">Code: {err.code}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Warnings */}
          {validation.warnings.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-yellow-700 mb-1">
                Warnings ({validation.warnings.length}):
              </div>
              <div className="space-y-1">
                {validation.warnings.map((warn, idx) => (
                  <div key={idx} className="text-xs bg-yellow-50 border border-yellow-200 rounded p-2">
                    <div className="font-mono text-yellow-900">{warn.path}</div>
                    <div className="text-yellow-700 mt-1">{warn.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Validation Gate Message */}
          {!validation.ok && (
            <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
              <strong>⚠ Validation Gate:</strong> Cannot generate issue until CR is valid. 
              Fix all errors above and re-validate.
            </div>
          )}
          
          {/* Meta Information */}
          <div className="mt-3 text-xs text-gray-500">
            Validated at: {new Date(validation.meta.validatedAt).toLocaleString()} | 
            Validator: v{validation.meta.validatorVersion}
            {validation.meta.hash && ` | Hash: ${validation.meta.hash.substring(0, 12)}...`}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="border-t border-gray-200 px-4 py-3 bg-white flex gap-2">
        <button
          onClick={saveDraft}
          disabled={isSaving || !hasUnsavedChanges}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {isSaving ? "Saving..." : "Save Draft"}
        </button>
        
        <button
          onClick={validateDraft}
          disabled={isValidating}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {isValidating ? "Validating..." : "Validate"}
        </button>
        
        <button
          onClick={loadDraft}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors text-sm font-medium"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
