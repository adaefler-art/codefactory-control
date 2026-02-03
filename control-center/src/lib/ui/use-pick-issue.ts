/**
 * React Hook for S1 Pick Issue API
 * 
 * E9.2-CONTROL-01: Canonical S1 Pick Endpoint Wiring
 * 
 * This hook provides a type-safe, idempotent way to pick GitHub issues
 * and create AFU-9 issues. It encapsulates the API call pattern and
 * state management for the UI.
 * 
 * @see docs/contracts/s1-pick-api.v1.md
 */

"use client";

import { useState, useCallback } from "react";
import { API_ROUTES } from "@/lib/api-routes";

/**
 * S1S3 Issue returned from pick endpoint
 */
export interface S1S3Issue {
  id: string;
  public_id: string;
  repo_full_name: string;
  github_issue_number: number;
  github_issue_url: string;
  owner: string;
  canonical_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * S1S3 Run record
 */
export interface S1S3Run {
  id: string;
  type: string;
  issue_id: string;
  request_id: string;
  actor: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * S1S3 Run Step record
 */
export interface S1S3RunStep {
  id: string;
  run_id: string;
  step_id: string;
  step_name: string;
  status: string;
  evidence_refs: Record<string, unknown>;
  created_at: string;
}

/**
 * Pick endpoint response
 */
export interface PickIssueResult {
  issue: S1S3Issue;
  run: S1S3Run;
  step: S1S3RunStep;
}

/**
 * Pick issue request parameters
 */
export interface PickIssueParams {
  repo: string;           // Format: "owner/repo"
  issueNumber: number;    // GitHub issue number
  canonicalId?: string;   // Optional canonical ID (e.g., "E89.6")
  owner?: string;         // AFU-9 owner (default: "afu9")
}

/**
 * Hook for picking GitHub issues and creating AFU-9 issues
 * 
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { pickIssue, loading, error, result } = usePickIssue();
 * 
 *   const handlePick = async () => {
 *     const data = await pickIssue({
 *       repo: "owner/repo",
 *       issueNumber: 42,
 *       canonicalId: "E92.1"
 *     });
 *     
 *     if (data) {
 *       console.log("Picked issue:", data.issue.public_id);
 *     }
 *   };
 * 
 *   return (
 *     <button onClick={handlePick} disabled={loading}>
 *       {loading ? "Picking..." : "Pick Issue"}
 *     </button>
 *   );
 * }
 * ```
 */
export function usePickIssue() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PickIssueResult | null>(null);

  /**
   * Pick a GitHub issue and create an AFU-9 issue
   * 
   * This operation is idempotent - calling it multiple times with the same
   * repo and issueNumber will return the existing AFU-9 issue.
   * 
   * @param params - Pick parameters
   * @returns Promise resolving to pick result or null on error
   */
  const pickIssue = useCallback(
    async (params: PickIssueParams): Promise<PickIssueResult | null> => {
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        // Validate parameters
        if (!params.repo || !params.issueNumber) {
          throw new Error("Missing required parameters: repo and issueNumber");
        }

        // Validate repo format
        if (!params.repo.includes("/")) {
          throw new Error("Invalid repo format. Expected: owner/repo");
        }

        // Validate issue number
        if (params.issueNumber <= 0 || !Number.isInteger(params.issueNumber)) {
          throw new Error("Invalid issue number. Must be a positive integer");
        }

        // Call pick endpoint
        const response = await fetch(API_ROUTES.afu9.s1s3.pick, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repo: params.repo,
            issueNumber: params.issueNumber,
            owner: params.owner || "afu9",
            canonicalId: params.canonicalId,
          }),
        });

        // Handle error response
        if (!response.ok) {
          let errorMessage = `Pick failed: ${response.status}`;
          let errorDetails: string | undefined;
          let requestId: string | undefined;

          try {
            const errorData = await response.json();
            if (errorData.error) {
              errorMessage = errorData.error;
            }
            if (errorData.details) {
              errorDetails = errorData.details;
            }
            if (errorData.requestId) {
              requestId = errorData.requestId;
            }
          } catch {
            // Could not parse error response
            errorDetails = response.statusText;
          }

          // Build full error message
          let fullError = errorMessage;
          if (errorDetails) {
            fullError += ` - ${errorDetails}`;
          }
          if (requestId) {
            fullError += ` [Request ID: ${requestId}]`;
          }

          throw new Error(fullError);
        }

        // Parse success response
        const data: PickIssueResult = await response.json();
        setResult(data);
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error occurred";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Reset the hook state
   */
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    /**
     * Pick a GitHub issue and create AFU-9 issue
     */
    pickIssue,
    
    /**
     * Whether a pick operation is in progress
     */
    loading,
    
    /**
     * Error message if pick failed, null otherwise
     */
    error,
    
    /**
     * Last successful pick result, null if no successful pick yet
     */
    result,
    
    /**
     * Reset hook state to initial values
     */
    reset,
  };
}
