/**
 * Issue Draft Actions
 * 
 * Shared action handlers for INTENT Issue Draft operations.
 * Used by both button clicks in IssueDraftPanel and chat command routing.
 * 
 * Issue: I201.8 - INTENT Chat Command Router
 * Requirement R2: Dispatch über shared actions
 */

import { safeFetch, formatErrorMessage } from "../api/safe-fetch";
import { API_ROUTES } from "../api-routes";

// Configuration constants
const DEFAULT_GITHUB_OWNER = "adaefler-art";
const DEFAULT_GITHUB_REPO = "codefactory-control";

export interface ActionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

export interface ValidationError {
  code: string;
  message: string;
  path: string;
  severity: "error";
}

export interface ValidationWarning {
  code: string;
  message: string;
  path: string;
  severity: "warning";
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  meta: {
    issueDraftVersion?: string;
    validatedAt: string;
    validatorVersion: string;
    hash?: string;
  };
}

export interface PublishResult {
  success: boolean;
  batch_id: string;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  items: Array<{
    canonical_id: string;
    action: 'created' | 'updated' | 'skipped' | 'failed';
    status: 'success' | 'failed';
    github_issue_number?: number;
    github_issue_url?: string;
    error_message?: string;
  }>;
  warnings?: string[];
  message?: string;
}

/**
 * Extract requestId from error object if present
 */
function extractRequestId(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "requestId" in err 
    ? String((err as any).requestId) 
    : undefined;
}

/**
 * Validate the issue draft for the given session
 */
export async function validateIssueDraft(
  sessionId: string
): Promise<ActionResult<{ validation: ValidationResult }>> {
  try {
    const response = await fetch(
      API_ROUTES.intent.issueDraft.validate(sessionId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      }
    );
    
    const data = await safeFetch(response) as { validation: ValidationResult };
    
    return {
      success: true,
      data,
    };
  } catch (err) {
    console.error("Failed to validate issue draft:", err);
    return {
      success: false,
      error: formatErrorMessage(err),
      requestId: extractRequestId(err),
    };
  }
}

/**
 * Commit a version of the issue draft
 */
export async function commitIssueDraft(
  sessionId: string
): Promise<ActionResult> {
  try {
    const response = await fetch(
      API_ROUTES.intent.issueDraft.commit(sessionId),
      {
        method: "POST",
        credentials: "include",
      }
    );
    
    const data = await safeFetch(response);
    
    return {
      success: true,
      data,
    };
  } catch (err) {
    console.error("Failed to commit issue draft:", err);
    return {
      success: false,
      error: formatErrorMessage(err),
      requestId: extractRequestId(err),
    };
  }
}

/**
 * Publish committed draft versions to GitHub
 */
export async function publishIssueDraft(
  sessionId: string,
  owner?: string,
  repo?: string
): Promise<ActionResult<PublishResult>> {
  try {
    const finalOwner = owner || process.env.NEXT_PUBLIC_GITHUB_OWNER || DEFAULT_GITHUB_OWNER;
    const finalRepo = repo || process.env.NEXT_PUBLIC_GITHUB_REPO || DEFAULT_GITHUB_REPO;
    
    const response = await fetch(
      API_ROUTES.intent.issueDraft.publish(sessionId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          owner: finalOwner,
          repo: finalRepo,
          issue_set_id: sessionId,
        }),
      }
    );
    
    const data = await safeFetch(response) as PublishResult;
    
    return {
      success: true,
      data,
    };
  } catch (err) {
    console.error("Failed to publish issue draft:", err);
    return {
      success: false,
      error: formatErrorMessage(err),
      requestId: extractRequestId(err),
    };
  }
}

/**
 * Create an AFU-9 Issue from the committed draft
 */
export async function createAfu9Issue(
  sessionId: string,
  draftId: string
): Promise<ActionResult> {
  try {
    const route = `/api/intent/sessions/${sessionId}/issues/create`;
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ issueDraftId: draftId }),
    });
    
    const data = await safeFetch(response);
    
    return {
      success: true,
      data,
    };
  } catch (err) {
    console.error("Failed to create AFU-9 Issue:", err);
    return {
      success: false,
      error: formatErrorMessage(err),
      requestId: extractRequestId(err),
    };
  }
}
