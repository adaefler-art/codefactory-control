/**
 * Execution Detail Page
 * 
 * Shows detailed information about a workflow execution,
 * including step-by-step progress and logs
 */

'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

interface WorkflowStep {
  id: string;
  step_name: string;
  step_index: number;
  status: string;
  input: any;
  output: any;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  retry_count: number;
}

interface ExecutionDetails {
  id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  workflow_description: string | null;
  status: string;
  input: any;
  output: any;
  context: any;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  triggered_by: string | null;
  github_run_id: string | null;
  steps: WorkflowStep[];
}

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [execution, setExecution] = useState<ExecutionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchExecution();
    
    // Auto-refresh for running executions
    const interval = setInterval(() => {
      if (execution?.status === 'running') {
        fetchExecution();
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [id, execution?.status]);

  async function fetchExecution() {
    try {
      const response = await fetch(`/api/executions/${id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch execution');
      }
      const data = await response.json();
      setExecution(data);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  }

  function toggleStep(stepId: string) {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
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

  function formatDuration(ms: number | null) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
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
      case 'skipped':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  function getStepIcon(status: string) {
    switch (status) {
      case 'completed':
        return '✓';
      case 'running':
        return '⟳';
      case 'failed':
        return '✗';
      case 'pending':
        return '○';
      case 'skipped':
        return '⊘';
      default:
        return '○';
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading execution...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !execution) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">Error: {error || 'Execution not found'}</p>
          </div>
          <Link href="/workflows" className="mt-4 inline-block text-blue-600 hover:text-blue-900">
            ← Back to Workflows
          </Link>
        </div>
      </div>
    );
  }

  const completedSteps = execution.steps.filter(s => s.status === 'completed').length;
  const totalSteps = execution.steps.length;
  const progressPercentage = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          {execution.workflow_id && (
            <Link 
              href={`/workflows/${execution.workflow_id}`} 
              className="text-blue-600 hover:text-blue-900 text-sm mb-2 inline-block"
            >
              ← Back to Workflow
            </Link>
          )}
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Execution Details
              </h1>
              {execution.workflow_name && (
                <p className="text-gray-600 mt-2">
                  Workflow: <span className="font-medium">{execution.workflow_name}</span>
                </p>
              )}
            </div>
            <span className={`px-4 py-2 text-sm font-semibold rounded-full ${getStatusColor(execution.status)}`}>
              {execution.status}
            </span>
          </div>
        </div>

        {/* Execution Metadata */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Execution Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <dt className="text-sm font-medium text-gray-500">Execution ID</dt>
              <dd className="text-sm text-gray-900 font-mono mt-1">{execution.id}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Started At</dt>
              <dd className="text-sm text-gray-900 mt-1">{formatDate(execution.started_at)}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Completed At</dt>
              <dd className="text-sm text-gray-900 mt-1">
                {execution.completed_at ? formatDate(execution.completed_at) : 'Running...'}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-gray-500">Triggered By</dt>
              <dd className="text-sm text-gray-900 mt-1">{execution.triggered_by || '-'}</dd>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Progress</span>
              <span>{completedSteps}/{totalSteps} steps completed</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Error Display */}
          {execution.error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-red-800 mb-2">Error</h3>
              <pre className="text-xs text-red-700 whitespace-pre-wrap">{execution.error}</pre>
            </div>
          )}
        </div>

        {/* Steps */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Execution Steps</h2>
          <div className="space-y-4">
            {execution.steps.map((step) => (
              <div key={step.id} className="border border-gray-200 rounded-lg">
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleStep(step.id)}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${getStatusColor(step.status)}`}>
                      {getStepIcon(step.status)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-500">#{step.step_index + 1}</span>
                        <span className="font-medium">{step.step_name}</span>
                        {step.retry_count > 0 && (
                          <span className="text-xs text-orange-600">(Retry {step.retry_count})</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">
                        {step.started_at && formatDate(step.started_at)}
                        {step.duration_ms && ` • ${formatDuration(step.duration_ms)}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${getStatusColor(step.status)}`}>
                      {step.status}
                    </span>
                    <span className="text-gray-400">
                      {expandedSteps.has(step.id) ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {expandedSteps.has(step.id) && (
                  <div className="border-t border-gray-200 p-4 bg-gray-50">
                    {/* Input */}
                    {step.input && Object.keys(step.input).length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Input</h4>
                        <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto">
                          {JSON.stringify(step.input, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Output */}
                    {step.output && Object.keys(step.output).length > 0 && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">Output</h4>
                        <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-x-auto">
                          {JSON.stringify(step.output, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Error */}
                    {step.error && (
                      <div className="mb-4">
                        <h4 className="text-sm font-semibold text-red-700 mb-2">Error</h4>
                        <pre className="text-xs bg-red-50 border border-red-200 rounded p-3 overflow-x-auto text-red-700">
                          {step.error}
                        </pre>
                      </div>
                    )}

                    {/* Timing Info */}
                    <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                      <div>
                        <span className="font-medium">Started:</span> {step.started_at ? formatDate(step.started_at) : '-'}
                      </div>
                      <div>
                        <span className="font-medium">Completed:</span> {step.completed_at ? formatDate(step.completed_at) : '-'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
