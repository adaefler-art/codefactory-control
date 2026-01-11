"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { safeFetch, formatErrorMessage } from "@/lib/api/safe-fetch";

/**
 * Workflow Runner UI - E84: Post-Publish Workflow Automation
 * 
 * Semi-automated workflow for managing PRs and issues:
 * - View next actionable item (PR/Issue)
 * - Check status (CI, checks, mergeability)
 * - Execute actions (assign, merge, rerun checks)
 * - Audit trail for all actions
 */

interface WorkflowItem {
  type: 'issue' | 'pull_request';
  owner: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  url: string;
}

interface PRStatus {
  pr_state: string;
  pr_mergeable: boolean | null;
  pr_mergeable_state: string;
  pr_draft: boolean;
  checks_status: string | null;
  checks_total: number;
  checks_passed: number;
  checks_failed: number;
  checks_pending: number;
  ci_status: string | null;
  review_decision: string | null;
  last_synced_at: string;
}

interface AuditAction {
  id: number;
  action_type: string;
  action_status: string;
  resource_type: string;
  resource_owner: string;
  resource_repo: string;
  resource_number: number;
  initiated_by: string;
  initiated_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export default function WorkflowRunnerPage() {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<WorkflowItem | null>(null);
  const [prStatus, setPRStatus] = useState<PRStatus | null>(null);
  const [auditLog, setAuditLog] = useState<AuditAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch actionable items (mock data for now)
  useEffect(() => {
    async function fetchItems() {
      try {
        // For now, use mock data - in production, fetch from API
        const mockItems: WorkflowItem[] = [
          {
            type: 'pull_request',
            owner: 'adaefler-art',
            repo: 'codefactory-control',
            number: 1,
            title: 'E82.4: GH Rate-limit & Retry Policy',
            state: 'open',
            url: 'https://github.com/adaefler-art/codefactory-control/pull/1',
          },
        ];
        setItems(mockItems);
      } catch (err) {
        console.error("Error fetching items:", err);
        setError(formatErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    }

    fetchItems();
  }, []);

  // Sync PR status
  const syncPRStatus = async (item: WorkflowItem) => {
    if (item.type !== 'pull_request') {
      return;
    }

    setIsSyncing(true);
    try {
      const { API_ROUTES } = await import('@/lib/api-routes');
      const response = await fetch(API_ROUTES.github.status.sync, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner: item.owner,
          repo: item.repo,
          number: item.number,
          resource_type: item.type,
        }),
      });

      const data = await safeFetch(response);
      setPRStatus(data.data);
    } catch (err) {
      console.error("Error syncing PR status:", err);
      setError(formatErrorMessage(err));
    } finally {
      setIsSyncing(false);
    }
  };

  // Select item and sync status
  const selectItem = (item: WorkflowItem) => {
    setSelectedItem(item);
    setPRStatus(null);
    syncPRStatus(item);
  };

  // Render status badge
  const renderStatusBadge = (status: string | null) => {
    if (!status) return null;

    const colors = {
      success: 'bg-green-600',
      pending: 'bg-yellow-600',
      failure: 'bg-red-600',
      error: 'bg-red-600',
    };

    const color = colors[status as keyof typeof colors] || 'bg-gray-600';

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${color} text-white`}>
        {status.toUpperCase()}
      </span>
    );
  };

  // Check if PR is mergeable
  const isMergeable = (status: PRStatus | null): boolean => {
    if (!status) return false;
    return (
      status.pr_mergeable === true &&
      status.pr_draft === false &&
      (status.checks_status === 'success' || status.checks_status === null) &&
      (status.ci_status === 'success' || status.ci_status === null)
    );
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-gray-200">
      {/* Header */}
      <div className="border-b border-gray-800 bg-[#161b22]">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-semibold text-gray-200">Workflow Runner</h1>
          <p className="text-sm text-gray-400 mt-1">
            Semi-automated PR/Issue workflow automation (E84)
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 p-4 bg-red-900/20 border border-red-800 rounded text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* Left: Actionable Items List */}
          <div className="col-span-1">
            <div className="bg-[#161b22] border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800">
                <h2 className="text-lg font-semibold">Next Items</h2>
              </div>
              
              {isLoading ? (
                <div className="p-4 text-center text-gray-400">
                  Loading...
                </div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-gray-400">
                  No actionable items
                </div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {items.map((item) => (
                    <button
                      key={`${item.type}-${item.number}`}
                      onClick={() => selectItem(item)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-800 transition ${
                        selectedItem?.number === item.number ? 'bg-gray-800' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm font-medium">
                            #{item.number} {item.title}
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            {item.owner}/{item.repo}
                          </div>
                        </div>
                        <span className="text-xs text-gray-500">
                          {item.type === 'pull_request' ? 'PR' : 'Issue'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center: Status View */}
          <div className="col-span-2">
            {!selectedItem ? (
              <div className="bg-[#161b22] border border-gray-800 rounded-lg p-8 text-center text-gray-400">
                Select an item to view status and actions
              </div>
            ) : (
              <div className="space-y-4">
                {/* Item Header */}
                <div className="bg-[#161b22] border border-gray-800 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">
                        #{selectedItem.number} {selectedItem.title}
                      </h2>
                      <div className="text-sm text-gray-400 mt-1">
                        {selectedItem.owner}/{selectedItem.repo}
                      </div>
                    </div>
                    <a
                      href={selectedItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      View on GitHub ↗
                    </a>
                  </div>
                </div>

                {/* Status Panel */}
                {selectedItem.type === 'pull_request' && (
                  <div className="bg-[#161b22] border border-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">PR Status</h3>
                      <button
                        onClick={() => syncPRStatus(selectedItem)}
                        disabled={isSyncing}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-sm rounded transition"
                      >
                        {isSyncing ? 'Syncing...' : 'Refresh'}
                      </button>
                    </div>

                    {!prStatus && !isSyncing && (
                      <div className="text-gray-400 text-sm">
                        Click "Refresh" to sync status from GitHub
                      </div>
                    )}

                    {prStatus && (
                      <div className="space-y-3">
                        {/* Mergeability */}
                        <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded">
                          <span className="text-sm font-medium">Mergeable</span>
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            isMergeable(prStatus) ? 'bg-green-600' : 'bg-red-600'
                          } text-white`}>
                            {isMergeable(prStatus) ? 'YES' : 'NO'}
                          </span>
                        </div>

                        {/* Checks */}
                        <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded">
                          <span className="text-sm font-medium">
                            Checks ({prStatus.checks_passed}/{prStatus.checks_total})
                          </span>
                          {renderStatusBadge(prStatus.checks_status)}
                        </div>

                        {/* CI Status */}
                        <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded">
                          <span className="text-sm font-medium">CI Status</span>
                          {renderStatusBadge(prStatus.ci_status)}
                        </div>

                        {/* Review Decision */}
                        <div className="flex items-center justify-between p-3 bg-[#0d1117] rounded">
                          <span className="text-sm font-medium">Review</span>
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            prStatus.review_decision === 'APPROVED' ? 'bg-green-600' :
                            prStatus.review_decision === 'CHANGES_REQUESTED' ? 'bg-red-600' :
                            'bg-gray-600'
                          } text-white`}>
                            {prStatus.review_decision || 'NONE'}
                          </span>
                        </div>

                        {/* Last Synced */}
                        <div className="text-xs text-gray-500 mt-2">
                          Last synced: {new Date(prStatus.last_synced_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions Panel */}
                <div className="bg-[#161b22] border border-gray-800 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-4">Actions</h3>
                  
                  <div className="space-y-2">
                    {selectedItem.type === 'pull_request' && (
                      <>
                        <button
                          disabled={true}
                          title="Action endpoint not implemented - no writes performed"
                          className="w-full px-4 py-2 rounded text-left bg-gray-700 cursor-not-allowed opacity-50"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Merge PR (Not Implemented)</span>
                            <span className="text-xs">Endpoint required</span>
                          </div>
                        </button>

                        <button 
                          disabled={true}
                          title="Action endpoint not implemented - no writes performed"
                          className="w-full px-4 py-2 bg-gray-700 cursor-not-allowed opacity-50 rounded text-left"
                        >
                          Rerun Failed Checks (Not Implemented)
                        </button>

                        <button 
                          disabled={true}
                          title="Action endpoint not implemented - no writes performed"
                          className="w-full px-4 py-2 bg-gray-700 cursor-not-allowed opacity-50 rounded text-left"
                        >
                          Request Review (Not Implemented)
                        </button>
                      </>
                    )}

                    <a
                      href={selectedItem.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-left"
                    >
                      View Details on GitHub ↗
                    </a>
                  </div>

                  <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800 rounded text-xs text-yellow-400">
                    ⚠️ <strong>Guardrails Active:</strong> Write actions disabled until corresponding endpoints are implemented with full gating + audit. 
                    Read-only operations (status sync, view) are available.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Audit Trail */}
        <div className="mt-8">
          <div className="bg-[#161b22] border border-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4">Audit Trail</h3>
            
            {auditLog.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">
                No actions recorded yet
              </div>
            ) : (
              <div className="space-y-2">
                {auditLog.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center justify-between p-3 bg-[#0d1117] rounded text-sm"
                  >
                    <div>
                      <span className="font-medium">{action.action_type}</span>
                      <span className="text-gray-400 mx-2">on</span>
                      <span>
                        {action.resource_owner}/{action.resource_repo}#{action.resource_number}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="text-xs text-gray-500">
                        {new Date(action.initiated_at).toLocaleString()}
                      </span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${
                        action.action_status === 'completed' ? 'bg-green-600' :
                        action.action_status === 'failed' ? 'bg-red-600' :
                        'bg-yellow-600'
                      } text-white`}>
                        {action.action_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
