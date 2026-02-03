/**
 * Example UI Component: Pick Issue Button
 * 
 * E9.2-CONTROL-01: Canonical S1 Pick Endpoint Wiring
 * 
 * This is an example component showing how to use the usePickIssue hook
 * to implement the canonical S1 pick flow in the UI.
 * 
 * @example
 * // In a page or component:
 * import { PickIssueButton } from '@/components/PickIssueButton';
 * 
 * function MyPage() {
 *   return (
 *     <PickIssueButton 
 *       repo="owner/repo" 
 *       issueNumber={42}
 *       canonicalId="E92.1"
 *     />
 *   );
 * }
 */

"use client";

import { useRouter } from "next/navigation";
import { usePickIssue } from "@/lib/ui/use-pick-issue";

interface PickIssueButtonProps {
  repo: string;           // Format: "owner/repo"
  issueNumber: number;    // GitHub issue number
  canonicalId?: string;   // Optional canonical ID (e.g., "E92.1")
  onSuccess?: (issueId: string) => void;  // Optional callback
}

/**
 * Button component that picks a GitHub issue and creates an AFU-9 issue
 * 
 * Features:
 * - Idempotent: Safe to click multiple times
 * - Error handling: Shows error messages
 * - Loading state: Disables button during operation
 * - Auto-navigation: Redirects to issue detail page on success
 */
export function PickIssueButton({
  repo,
  issueNumber,
  canonicalId,
  onSuccess,
}: PickIssueButtonProps) {
  const router = useRouter();
  const { pickIssue, loading, error } = usePickIssue();

  const handlePick = async () => {
    const result = await pickIssue({
      repo,
      issueNumber,
      canonicalId,
    });

    if (result) {
      // Call optional success callback
      onSuccess?.(result.issue.id);

      // Navigate to issue detail page
      router.push(`/issues/${result.issue.id}`);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handlePick}
        disabled={loading}
        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Picking Issue..." : "Pick Issue"}
      </button>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-3">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Alternative: Inline usage without separate component
 */
export function ExampleInlineUsage() {
  const { pickIssue, loading, error } = usePickIssue();

  const handleClick = async () => {
    const result = await pickIssue({
      repo: "adaefler-art/codefactory-control",
      issueNumber: 42,
      canonicalId: "E92.1",
    });

    if (result) {
      console.log("AFU-9 Issue created:", result.issue.public_id);
      console.log("Run ID:", result.run.id);
      console.log("Step ID:", result.step.id);
    }
  };

  return (
    <div>
      <button onClick={handleClick} disabled={loading}>
        {loading ? "Picking..." : "Pick Issue #42"}
      </button>
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Alternative: With custom success handling
 */
export function ExampleWithCallback() {
  const { pickIssue, loading, error, result } = usePickIssue();

  const handlePick = async () => {
    await pickIssue({
      repo: "owner/repo",
      issueNumber: 100,
    });
  };

  return (
    <div>
      <button onClick={handlePick} disabled={loading}>
        Pick Issue
      </button>
      
      {loading && <p>Processing...</p>}
      {error && <p className="text-red-500">Error: {error}</p>}
      
      {result && (
        <div className="mt-4 p-4 bg-green-900/20 border border-green-700 rounded-lg">
          <h3 className="font-semibold text-green-300">Success!</h3>
          <p className="text-sm text-green-200">
            Created AFU-9 issue: {result.issue.public_id}
          </p>
          <p className="text-sm text-gray-400">
            GitHub: #{result.issue.github_issue_number}
          </p>
          <a
            href={`/issues/${result.issue.id}`}
            className="text-purple-400 hover:text-purple-300 underline"
          >
            View Issue →
          </a>
        </div>
      )}
    </div>
  );
}
