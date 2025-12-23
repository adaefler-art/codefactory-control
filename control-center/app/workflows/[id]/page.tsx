/**
 * Workflow Detail Page
 * 
 * Shows details about a specific workflow including definition,
 * execution history, and manual trigger form
 */

'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface WorkflowDefinition {
  steps: Array<{
    name: string;
    tool: string;
    params: Record<string, any>;
    assign?: string;
    condition?: string;
  }>;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  definition: WorkflowDefinition;
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface Execution {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  triggered_by: string | null;
  total_steps: number;
  completed_steps: number;
  error: string | null;
}

export default function WorkflowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [triggerParams, setTriggerParams] = useState('{}');
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    fetchWorkflow();
    fetchExecutions();
  }, [id]);

  async function fetchWorkflow() {
    try {
      const response = await fetch(`/api/workflows/${id}`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch workflow');
      }
      const data = await response.json();
      setWorkflow(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function fetchExecutions() {
    try {
      const response = await fetch(`/api/workflows/${id}/executions?limit=20`, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch executions');
      }
      const data = await response.json();
      setExecutions(data.executions);
    } catch (err) {
      console.error('Error fetching executions:', err);
    }
  }

  async function handleTrigger() {
    try {
      setTriggering(true);
      const input = JSON.parse(triggerParams);
      
      const response = await fetch(`/api/workflows/${id}/trigger`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          triggeredBy: 'manual',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger workflow');
      }

      alert('Workflow triggered successfully!');
      setShowTriggerForm(false);
      setTriggerParams('{}');
      
      // Refresh executions after a short delay
      setTimeout(fetchExecutions, 1000);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Failed to trigger workflow'}`);
    } finally {
      setTriggering(false);
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleString('de-DE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading workflow...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">Error: {error || 'Workflow not found'}</p>
          </div>
          <Link href="/workflows" className="mt-4 inline-block text-blue-600 hover:text-blue-900">
            ← Back to Workflows
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <Link href="/workflows" className="text-blue-600 hover:text-blue-900 text-sm mb-2 inline-block">
              ← Back to Workflows
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">{workflow.name}</h1>
            {workflow.description && (
              <p className="text-gray-600 mt-2">{workflow.description}</p>
            )}
          </div>
          <button
            onClick={() => setShowTriggerForm(!showTriggerForm)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            disabled={!workflow.enabled}
          >
            {showTriggerForm ? 'Cancel' : 'Trigger Workflow'}
          </button>
        </div>

        {/* Trigger Form */}
        {showTriggerForm && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Trigger Workflow</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Input Parameters (JSON)
                </label>
                <textarea
                  value={triggerParams}
                  onChange={(e) => setTriggerParams(e.target.value)}
                  className="w-full h-32 p-3 border border-gray-300 rounded-lg font-mono text-sm"
                  placeholder='{"repo": {"owner": "user", "name": "repo"}, "issue_number": 123}'
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter parameters as a JSON object. Example: {`{"issue_number": 123}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleTrigger}
                  disabled={triggering}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                  {triggering ? 'Triggering...' : 'Start Execution'}
                </button>
                <button
                  onClick={() => setShowTriggerForm(false)}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Workflow Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Workflow Information</h2>
            <dl className="space-y-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Version</dt>
                <dd className="text-sm text-gray-900">{workflow.version}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="text-sm">
                  <span className={workflow.enabled ? 'text-green-600' : 'text-red-600'}>
                    {workflow.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Steps</dt>
                <dd className="text-sm text-gray-900">{workflow.definition.steps.length}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="text-sm text-gray-900">{formatDate(workflow.created_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Updated</dt>
                <dd className="text-sm text-gray-900">{formatDate(workflow.updated_at)}</dd>
              </div>
            </dl>
          </div>

          {/* Workflow Steps */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Workflow Steps</h2>
            <div className="space-y-3">
              {workflow.definition.steps.map((step, index) => (
                <div key={index} className="border-l-4 border-blue-500 pl-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500">#{index + 1}</span>
                    <span className="font-medium text-sm">{step.name}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Tool: <code className="bg-gray-100 px-1 py-0.5 rounded">{step.tool}</code>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Execution History */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Execution History</h2>
          {executions.length === 0 ? (
            <p className="text-gray-600 text-center py-8">No executions yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Started
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Progress
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Triggered By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {executions.map((execution) => (
                    <tr key={execution.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(execution.status)}`}>
                          {execution.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {formatDate(execution.started_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {execution.completed_steps}/{execution.total_steps} steps
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {execution.triggered_by || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium">
                        <Link
                          href={`/workflows/executions/${execution.id}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          View Details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
