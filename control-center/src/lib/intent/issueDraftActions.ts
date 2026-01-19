import { API_ROUTES } from "../api-routes.js";
import { safeFetch } from "../api/safe-fetch.js";

export type IssueDraftAction = "validate" | "commit" | "publishGithub" | "createIssue";

export interface IssueDraftActionDraft {
  id?: string;
  issue_json?: unknown;
}

export interface IssueDraftActionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  requestId?: string;
}

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

async function fetchDraft(sessionId: string): Promise<IssueDraftActionDraft | null> {
  const response = await fetch(API_ROUTES.intent.issueDraft.get(sessionId), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const data = await safeFetch(response);
  if (typeof data === "object" && data !== null && "success" in data) {
    const success = (data as { success: boolean }).success;
    if (success && "draft" in data) {
      return (data as { draft: IssueDraftActionDraft | null }).draft;
    }
  }

  return null;
}

export async function executeIssueDraftAction(
  action: IssueDraftAction,
  sessionId: string,
  options?: { draft?: IssueDraftActionDraft | null; owner?: string; repo?: string }
): Promise<IssueDraftActionResult> {
  try {
    const draft = options?.draft ?? (await fetchDraft(sessionId));

    if (action === "validate") {
      if (!draft?.issue_json) {
        return { ok: false, error: "NO_DRAFT" };
      }

      const response = await fetch(API_ROUTES.intent.issueDraft.validate(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ issue_json: draft.issue_json }),
      });
      const data = await safeFetch(response);
      return { ok: true, data };
    }

    if (action === "commit") {
      const response = await fetch(API_ROUTES.intent.issueDraft.commit(sessionId), {
        method: "POST",
        credentials: "include",
      });
      const data = await safeFetch(response);
      return { ok: true, data };
    }

    if (action === "publishGithub") {
      const owner = options?.owner;
      const repo = options?.repo;
      const response = await fetch(API_ROUTES.intent.issueDraft.publish(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          owner,
          repo,
          issue_set_id: sessionId,
        }),
      });
      const data = await safeFetch(response);
      return { ok: true, data };
    }

    if (action === "createIssue") {
      const response = await fetch(API_ROUTES.intent.issues.create(sessionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ issueDraftId: draft?.id }),
      });
      const data = await safeFetch(response);
      return { ok: true, data };
    }

    return { ok: false, error: "UNKNOWN_ACTION" };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "ACTION_FAILED";
    let requestId: string | undefined;
    if (typeof err === "object" && err !== null && "requestId" in err) {
      requestId = String((err as { requestId?: unknown }).requestId ?? "");
    }
    return { ok: false, error: errorMessage, requestId };
  }
}
