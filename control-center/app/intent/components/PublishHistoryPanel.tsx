/**
 * Publish History Panel Component
 * 
 * Displays publish batches for a session with expandable items view
 * Issue E89.7: Publish Audit Trail (DB table + session-scoped UI view; append-only, bounded result_json)
 */

"use client";

import { useState, useEffect } from "react";
import { API_ROUTES } from "@/lib/api-routes";
import { safeFetch } from "@/lib/api/safe-fetch";

interface PublishBatch {
  batch_id: string;
  status: string;
  created_at: string;
  issue_set_id: string;
  session_id: string;
  request_id: string;
  lawbook_version: string;
  total_items: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  error_message: string | null;
  owner: string;
  repo: string;
  result_json: any;
  result_truncated: boolean;
  items?: PublishItem[];
}

interface PublishItem {
  item_id: string;
  batch_id: string;
  status: string;
  created_at: string;
  canonical_id: string;
  owner: string;
  repo: string;
  github_issue_number: number | null;
  github_issue_url: string | null;
  action: string;
  error_message: string | null;
  result_json: any;
  result_truncated: boolean;
}

interface PublishHistoryPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function PublishHistoryPanel({
  sessionId,
  isOpen,
  onClose,
}: PublishHistoryPanelProps) {
  const [batches, setBatches] = useState<PublishBatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && sessionId) {
      fetchBatches();
    }
  }, [isOpen, sessionId]);

  const fetchBatches = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await safeFetch(
        API_ROUTES.intent.sessions.publishBatches(sessionId) + "?limit=50",
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (typeof response === 'object' && response !== null && 'success' in response && 'batches' in response && (response as any).success) {
        setBatches((response as { batches: PublishBatch[] }).batches);
      } else {
        setError("Failed to load publish batches");
      }
    } catch (err) {
      console.error("Error fetching publish batches:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleBatch = async (batchId: string) => {
    const newExpanded = new Set(expandedBatches);
    
    if (newExpanded.has(batchId)) {
      newExpanded.delete(batchId);
    } else {
      newExpanded.add(batchId);
      
      // Fetch items for this batch if not already loaded
      const batch = batches.find(b => b.batch_id === batchId);
      if (batch && !batch.items) {
        try {
          const response = await safeFetch(
            API_ROUTES.intent.sessions.publishBatches(sessionId) + 
            `?limit=1&include_items=true&offset=${batches.indexOf(batch)}`,
            {
              method: "GET",
              credentials: "include",
            }
          );

          if (typeof response === 'object' && response !== null && 'success' in response && 'batches' in response && (response as any).success && Array.isArray((response as any).batches) && (response as any).batches[0]?.items) {
            const updatedBatches = batches.map(b =>
              b.batch_id === batchId
                ? { ...b, items: (response as any).batches[0].items }
                : b
            );
            setBatches(updatedBatches);
          }
        } catch (err) {
          console.error("Error fetching batch items:", err);
        }
      }
    }
    
    setExpandedBatches(newExpanded);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] bg-white dark:bg-gray-900 shadow-xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Publish History
        </h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <p className="mt-2 text-gray-600 dark:text-gray-400">Loading batches...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
            <p className="text-red-700 dark:text-red-400">{error}</p>
            <button
              onClick={fetchBatches}
              className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && batches.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            No publish batches found for this session.
          </div>
        )}

        {!isLoading && !error && batches.length > 0 && (
          <div className="space-y-4">
            {batches.map((batch) => (
              <div
                key={batch.batch_id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
              >
                {/* Batch Header */}
                <div
                  className="bg-gray-50 dark:bg-gray-800 px-4 py-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => toggleBatch(batch.batch_id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {batch.owner}/{batch.repo}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            batch.status === "completed"
                              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                              : batch.status === "failed"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                              : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          }`}
                        >
                          {batch.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(batch.created_at)}
                      </div>
                    </div>
                    <svg
                      className={`w-5 h-5 text-gray-400 transform transition-transform ${
                        expandedBatches.has(batch.batch_id) ? "rotate-180" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Counts */}
                  <div className="mt-2 flex gap-4 text-xs">
                    <span className="text-gray-600 dark:text-gray-400">
                      Total: <span className="font-medium text-gray-900 dark:text-gray-100">{batch.total_items}</span>
                    </span>
                    <span className="text-green-600 dark:text-green-400">
                      Created: <span className="font-medium">{batch.created_count}</span>
                    </span>
                    <span className="text-blue-600 dark:text-blue-400">
                      Updated: <span className="font-medium">{batch.updated_count}</span>
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      Skipped: <span className="font-medium">{batch.skipped_count}</span>
                    </span>
                    {batch.failed_count > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        Failed: <span className="font-medium">{batch.failed_count}</span>
                      </span>
                    )}
                  </div>

                  {/* Copy buttons */}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(batch.request_id, `request-${batch.batch_id}`);
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {copiedText === `request-${batch.batch_id}` ? "✓ Copied" : "Copy Request ID"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(batch.batch_id, `batch-${batch.batch_id}`);
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {copiedText === `batch-${batch.batch_id}` ? "✓ Copied" : "Copy Batch ID"}
                    </button>
                  </div>
                </div>

                {/* Batch Items (expandable) */}
                {expandedBatches.has(batch.batch_id) && (
                  <div className="bg-white dark:bg-gray-900 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                    {batch.items ? (
                      batch.items.length > 0 ? (
                        <div className="space-y-2">
                          {batch.items.map((item) => (
                            <div
                              key={item.item_id}
                              className="p-3 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                    {item.canonical_id}
                                  </div>
                                  {item.github_issue_url && (
                                    <a
                                      href={item.github_issue_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                      #{item.github_issue_number} ↗
                                    </a>
                                  )}
                                  {item.error_message && (
                                    <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                                      Error: {item.error_message}
                                    </div>
                                  )}
                                </div>
                                <span
                                  className={`px-2 py-0.5 text-xs font-medium rounded ${
                                    item.action === "created"
                                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                                      : item.action === "updated"
                                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                                      : item.action === "skipped"
                                      ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400"
                                      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                                  }`}
                                >
                                  {item.action}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                          No items found
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-gray-500 dark:text-gray-400 text-center py-2">
                        <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
                        <span className="ml-2">Loading items...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
