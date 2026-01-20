/**
 * Issue Draft Actions
 * 
 * Shared action handlers for INTENT Issue Draft operations.
 * Used by both button clicks in IssueDraftPanel and chat command routing.
 * 
 * Issue: I201.8 - INTENT Chat Command Router
 * Issue: I201.9 - Shared Draft Actions + Parser Tests
 * Requirement R2: Dispatch über shared actions + Zod typed responses
 */

import { z } from "zod";
import { API_ROUTES } from "@/lib/api-routes";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

// Configuration constants
const DEFAULT_GITHUB_OWNER = "adaefler-art";
const DEFAULT_GITHUB_REPO = "codefactory-control";

// ===================================================================
// R2: Zod Schemas for Typed Responses (I201.9)
// ===================================================================

export const ValidationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string(),
  severity: z.literal("error"),
});

export const ValidationWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string(),
  severity: z.literal("warning"),
});

export const ValidationResultSchema = z.object({
  isValid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
  meta: z.object({
    issueDraftVersion: z.string().optional(),
    validatedAt: z.string(),
    validatorVersion: z.string(),
    hash: z.string().optional(),
  }),
});

export const PublishResultItemSchema = z.object({
  canonical_id: z.string(),
  action: z.enum(["created", "updated", "skipped", "failed"]),
  status: z.enum(["success", "failed"]),
  github_issue_number: z.number().optional(),
  github_issue_url: z.string().optional(),
  error_message: z.string().optional(),
});

export const PublishResultSchema = z.object({
  success: z.boolean(),
  batch_id: z.string(),
  summary: z.object({
    total: z.number(),
    created: z.number(),
    updated: z.number(),
    skipped: z.number(),
    failed: z.number(),
  }),
  items: z.array(PublishResultItemSchema),
  warnings: z.array(z.string()).optional(),
  message: z.string().optional(),
});

export const ActionResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  requestId: z.string().optional(),
});

// ===================================================================
// TypeScript Types (derived from Zod schemas for backwards compat)
// ===================================================================

export type IssueDraftAction = "validate" | "commit" | "publishGithub" | "createIssue";

export interface IssueDraftActionDraftRef {
  id?: string;
}

export type ActionResult<T = any> = z.infer<typeof ActionResultSchema> & { data?: T };
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type ValidationWarning = z.infer<typeof ValidationWarningSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type PublishResult = z.infer<typeof PublishResultSchema>;
export type PublishResultItem = z.infer<typeof PublishResultItemSchema>;

/**
 * Extract requestId from error object if present
 */
function extractRequestId(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "requestId" in err 
    ? String((err as any).requestId) 
    : undefined;
}

/**
 * Parse chat command text to action type
 * From main branch (Current) - preserved for compatibility
 */
export function parseChatCommand(text: string): IssueDraftAction | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  if (["validate", "validiere", "prüfe", "pruefe"].includes(normalized)) {
    return "validate";
  }

  if (["commit", "committe", "commit version", "versioniere"].includes(normalized)) {
    return "commit";
  }

  if (["publish", "github", "handoff"].includes(normalized)) {
    return "publishGithub";
  }

  if (["create issue", "issue anlegen", "create afu9 issue"].includes(normalized)) {
    return "createIssue";
  }

  return null;
}

/**
 * Validate the issue draft for the given session
 * CRITICAL: Does NOT send request body (per I201.8 requirements)
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
    const response = await fetch(API_ROUTES.intent.issues.create(sessionId), {
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

/**
 * Unified action dispatcher for INTENT draft actions
 */
export async function executeIssueDraftAction(
  action: IssueDraftAction,
  sessionId: string,
  options?: { draft?: IssueDraftActionDraftRef | null; owner?: string; repo?: string }
): Promise<ActionResult> {
  switch (action) {
    case "validate":
      return validateIssueDraft(sessionId);
    case "commit":
      return commitIssueDraft(sessionId);
    case "publishGithub":
      return publishIssueDraft(sessionId, options?.owner, options?.repo);
    case "createIssue": {
      const draftId = options?.draft?.id;
      if (!draftId) {
        return { success: false, error: "NO_DRAFT" };
      }
      return createAfu9Issue(sessionId, draftId);
    }
    default:
      return { success: false, error: "UNKNOWN_ACTION" };
  }
}
